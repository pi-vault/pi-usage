# Command Code Usage Refactor Phase 1: Usage Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the pure Command Code payload parser that Phase 2 will connect to the live provider.

**Architecture:** Add one provider-local pure parser with no network or cache responsibilities. It emits only reliable 5-hour and weekly percentages/reset timing, preserves existing balances and plan names, and deliberately does not synthesize a monthly window from unrelated API values. The existing live adapter remains unchanged in this phase.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

**Parent Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md`

**Atomic Result:** A tested, reusable `parseCommandCodeUsage()` implementation exists, and the existing Command Code provider test suite still passes.

## Global Constraints

- Change only `pi-usage`; `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/codexbar` are read-only references.
- Keep Node.js support at `>=24.15.0`.
- Add no dependencies, public exports, shared usage types, environment variables, local estimates, or static plan-price catalog.
- Preserve the existing monthly and purchased USD balances, request/token balances, and plan-name behavior.
- Do not synthesize a monthly window from `summary.totalCost` and `credits.monthlyCredits`.
- Rolling windows expose percentage and reset timing only; do not expose raw `used`, `limit`, or `unit` fields.
- Do not modify the live provider or registry in Phase 1.

---

### Task 1: Build the Pure Command Code Usage Parser

**Files:**

- Create: `src/providers/command-code/usage-parser.ts`
- Modify: `tests/provider-command-code.test.ts`

**Interfaces:**

- Consumes: `LiveUsageWindow`, `ProviderUsageSnapshot`, `clampPercent()`, `parseEpochMs()`, and `toFinite()` from the existing shared/provider runtime.
- Produces:

```ts
export interface CommandCodePayloads {
  summary?: Record<string, unknown>;
  credits?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

export function parseCommandCodeUsage(
  payloads: CommandCodePayloads,
): Pick<ProviderUsageSnapshot, "windows" | "balances" | "planName">;
```

- [ ] **Step 1: Add the failing root-payload parser test**

Add this import to `tests/provider-command-code.test.ts`:

```ts
import { parseCommandCodeUsage } from "../src/providers/command-code/usage-parser.ts";
```

Add this block before the existing provider tests:

```ts
describe("Command Code usage parser", () => {
  it("parses root rolling windows and preserves balances without a monthly window", () => {
    const parsed = parseCommandCodeUsage({
      summary: { totalCost: 4, totalCount: 42, totalTokens: 1_234 },
      credits: {
        credits: { monthlyCredits: 6, purchasedCredits: 5 },
        windowLimits: {
          fiveHour: { cap: 3, used: 0.75, resetAt: 1_780_000_000_000 },
          weekly: { cap: 15, used: 1.5, resetAt: 1_780_100_000_000 },
        },
      },
      subscription: { data: { planId: "individual-go" } },
    });

    expect(parsed.windows).toEqual([
      {
        key: "fiveHour",
        label: "5h",
        usedPercent: 25,
        resetAt: 1_780_000_000_000,
        windowDurationMins: 300,
      },
      {
        key: "weekly",
        label: "Weekly",
        usedPercent: 10,
        resetAt: 1_780_100_000_000,
        windowDurationMins: 10_080,
      },
    ]);
    expect(parsed.balances).toEqual([
      { label: "Monthly remaining", remaining: 6, unit: "USD" },
      { label: "Purchased remaining", remaining: 5, unit: "USD" },
      { label: "Requests", remaining: 42, unit: "count" },
      { label: "Tokens", remaining: 1_234, unit: "tok" },
    ]);
    expect(parsed.planName).toBe("Go");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the parser is missing**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: FAIL because `src/providers/command-code/usage-parser.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `src/providers/command-code/usage-parser.ts` with this complete implementation:

```ts
import type {
  LiveUsageWindow,
  ProviderUsageSnapshot,
} from "../../shared/types.ts";
import { clampPercent, parseEpochMs, toFinite } from "../runtime.ts";

export interface CommandCodePayloads {
  summary?: Record<string, unknown>;
  credits?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strictFinite(value: unknown): number | undefined {
  return typeof value === "string" && !value.trim() ? undefined : toFinite(value);
}

function parseTimestamp(value: unknown): number | undefined {
  const numeric = strictFinite(value);
  if (numeric != null) return numeric > 0 ? parseEpochMs(numeric) : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRateWindow(
  value: unknown,
  key: string,
  label: string,
  windowDurationMins: number,
): LiveUsageWindow | undefined {
  const record = asRecord(value);
  const limit = strictFinite(record?.cap);
  if (limit == null || limit <= 0) return undefined;
  const used = strictFinite(record?.used) ?? 0;
  return {
    key,
    label,
    usedPercent: clampPercent((used / limit) * 100),
    resetAt: parseTimestamp(record?.resetAt),
    windowDurationMins,
  };
}

export function parseCommandCodeUsage(
  payloads: CommandCodePayloads,
): Pick<ProviderUsageSnapshot, "windows" | "balances" | "planName"> {
  const credits = asRecord(payloads.credits?.credits);
  const windowLimits =
    asRecord(payloads.credits?.windowLimits) ?? asRecord(credits?.windowLimits);
  const subscription = asRecord(payloads.subscription?.data);

  const windows: LiveUsageWindow[] = [];
  const fiveHour = parseRateWindow(
    windowLimits?.fiveHour,
    "fiveHour",
    "5h",
    5 * 60,
  );
  const weekly = parseRateWindow(
    windowLimits?.weekly,
    "weekly",
    "Weekly",
    7 * 24 * 60,
  );
  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  const balances: ProviderUsageSnapshot["balances"] = [];
  const monthlyCredits = strictFinite(credits?.monthlyCredits);
  const purchasedCredits = strictFinite(credits?.purchasedCredits) ?? 0;
  if (monthlyCredits != null) {
    balances.push({
      label: "Monthly remaining",
      remaining: monthlyCredits,
      unit: "USD",
    });
  }
  if (purchasedCredits > 0) {
    balances.push({
      label: "Purchased remaining",
      remaining: purchasedCredits,
      unit: "USD",
    });
  }

  const totalCount = strictFinite(payloads.summary?.totalCount);
  const totalTokens = strictFinite(payloads.summary?.totalTokens);
  const totalTokensIn = strictFinite(payloads.summary?.totalTokensIn);
  const totalTokensOut = strictFinite(payloads.summary?.totalTokensOut);
  if (totalCount != null) {
    balances.push({ label: "Requests", remaining: totalCount, unit: "count" });
  }
  if (totalTokens != null) {
    balances.push({ label: "Tokens", remaining: totalTokens, unit: "tok" });
  } else {
    if (totalTokensIn != null) {
      balances.push({
        label: "Tokens in",
        remaining: totalTokensIn,
        unit: "tok",
      });
    }
    if (totalTokensOut != null) {
      balances.push({
        label: "Tokens out",
        remaining: totalTokensOut,
        unit: "tok",
      });
    }
  }

  const planId =
    typeof subscription?.planId === "string" ? subscription.planId : undefined;
  return {
    windows,
    balances,
    planName: planId ? (PLAN_NAMES[planId.toLowerCase()] ?? planId) : undefined,
  };
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: PASS, including the new parser case and all existing provider cases.

- [ ] **Step 5: Add nested payload, coercion, cap, token, and plan regressions**

Add these tests inside `describe("Command Code usage parser", ...)`:

```ts
it("parses nested string windows and supported reset formats", () => {
  const parsed = parseCommandCodeUsage({
    credits: {
      credits: {
        monthlyCredits: "7.25",
        windowLimits: {
          fiveHour: { cap: "4", used: "1", resetAt: "1780200000" },
          weekly: {
            cap: "20",
            used: "4",
            resetAt: "2026-06-01T00:00:00Z",
          },
        },
      },
    },
  });

  expect(parsed.windows.map((window) => window.usedPercent)).toEqual([25, 20]);
  expect(parsed.windows[0].resetAt).toBe(1_780_200_000_000);
  expect(parsed.windows[1].resetAt).toBe(Date.parse("2026-06-01T00:00:00Z"));
  expect(parsed.balances).toContainEqual({
    label: "Monthly remaining",
    remaining: 7.25,
    unit: "USD",
  });
});

it.each(["0", 0, "-1", -1])(
  "rejects non-positive numeric reset sentinel %j",
  (resetAt) => {
    const parsed = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { cap: 1, resetAt } },
      },
    });

    expect(parsed.windows[0].resetAt).toBeUndefined();
  },
);

it("omits invalid caps, defaults missing usage, and clamps overuse", () => {
  const parsed = parseCommandCodeUsage({
    credits: {
      windowLimits: {
        fiveHour: { cap: 3 },
        weekly: { cap: 0, used: 2 },
      },
    },
  });
  expect(parsed.windows).toEqual([
    {
      key: "fiveHour",
      label: "5h",
      usedPercent: 0,
      resetAt: undefined,
      windowDurationMins: 300,
    },
  ]);

  const overused = parseCommandCodeUsage({
    credits: {
      windowLimits: { fiveHour: { cap: 3, used: 4 } },
    },
  });
  expect(overused.windows[0].usedPercent).toBe(100);

  const fractional = parseCommandCodeUsage({
    credits: {
      windowLimits: { fiveHour: { cap: 3, used: 1 } },
    },
  });
  expect(fractional.windows[0].usedPercent).toBeCloseTo(100 / 3);

  const negative = parseCommandCodeUsage({
    credits: {
      windowLimits: { fiveHour: { cap: 3, used: -1 } },
    },
  });
  expect(negative.windows[0].usedPercent).toBe(0);
});

it("uses combined tokens before separate input and output totals", () => {
  expect(
    parseCommandCodeUsage({
      summary: { totalTokens: 30, totalTokensIn: 10, totalTokensOut: 20 },
    }).balances,
  ).toEqual([{ label: "Tokens", remaining: 30, unit: "tok" }]);
  expect(
    parseCommandCodeUsage({
      summary: { totalTokensIn: 10, totalTokensOut: 20 },
    }).balances,
  ).toEqual([
    { label: "Tokens in", remaining: 10, unit: "tok" },
    { label: "Tokens out", remaining: 20, unit: "tok" },
  ]);
});

it("ignores blank numeric fields and retains separate token totals", () => {
  const parsed = parseCommandCodeUsage({
    summary: {
      totalCount: " ",
      totalTokens: "",
      totalTokensIn: 10,
      totalTokensOut: 20,
    },
    credits: {
      credits: { monthlyCredits: "", purchasedCredits: " " },
    },
  });

  expect(parsed.balances).toEqual([
    { label: "Tokens in", remaining: 10, unit: "tok" },
    { label: "Tokens out", remaining: 20, unit: "tok" },
  ]);
});

it.each([
  ["individual-go", "Go"],
  ["individual-goat", "GOAT"],
  ["individual-pro", "Pro"],
  ["individual-pro-v1", "Pro"],
  ["individual-max", "Max"],
  ["individual-ultra", "Ultra"],
  ["team-future", "team-future"],
])("maps plan %s to %s", (planId, expected) => {
  expect(
    parseCommandCodeUsage({ subscription: { data: { planId } } }).planName,
  ).toBe(expected);
});
```

- [ ] **Step 6: Run focused tests, type checking, and the full project check**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
pnpm typecheck
pnpm check
```

Expected: all commands exit 0 on Node.js `>=24.15.0`. The full check runs Biome lint, TypeScript compilation, and every Vitest suite.

- [ ] **Step 7: Review the Phase 1 diff**

Run:

```bash
git diff --check
git status --short
git diff -- src/providers/command-code/usage-parser.ts tests/provider-command-code.test.ts
```

Expected: `git diff --check` exits 0; Phase 1 changes only the parser and Command Code test file, in addition to the already-updated planning documents.

- [ ] **Step 8: Commit the pure parser**

```bash
git add src/providers/command-code/usage-parser.ts tests/provider-command-code.test.ts docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md docs/superpowers/plans/2026-08-30-command-code-usage-refactor-phase-1-usage-parser.md docs/superpowers/plans/2026-08-30-command-code-usage-refactor-phase-2-provider-integration.md
git commit -m "feat(command-code): parse rolling usage windows"
```
