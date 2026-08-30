# Command Code Usage Refactor Phase 1: Usage Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the pure Command Code payload parser that Phase 2 will connect to the live provider.

**Architecture:** Add a provider-local pure parser with no network or cache responsibilities. Direct unit tests define rolling-window, monthly-credit, timestamp, balance, and plan-name behavior while the existing live adapter remains unchanged.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

**Parent Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md`

**Atomic Result:** A tested, reusable `parseCommandCodeUsage()` implementation exists, and the existing Command Code provider test suite still passes.

## Global Constraints

- Change only `pi-usage`; `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/codexbar` are read-only references.
- Keep Node.js support at `>=24.15.0`.
- Add no dependencies, public exports, shared usage types, environment variables, local estimates, or static plan-price catalog.
- Preserve the existing `COMMAND_CODE_COOKIE_HEADER` configuration, provider cache/backoff behavior, request/token balances, and partial-success behavior.
- Purchased credits remain a balance and never increase the monthly included-credit limit.

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

export type ParsedCommandCodeUsage = Pick<
  ProviderUsageSnapshot,
  "windows" | "balances" | "planName"
>;

export function parseCommandCodeUsage(
  payloads: CommandCodePayloads,
): ParsedCommandCodeUsage;
```

- [ ] **Step 1: Add failing tests for root-level rolling windows and monthly usage**

Add this import to `tests/provider-command-code.test.ts`:

```ts
import { parseCommandCodeUsage } from "../src/providers/command-code/usage-parser.ts";
```

Add a parser-focused describe block before the existing provider describe block:

```ts
describe("Command Code usage parser", () => {
  it("parses rolling windows at the response root before monthly usage", () => {
    const parsed = parseCommandCodeUsage({
      summary: { totalCost: 4 },
      credits: {
        credits: { monthlyCredits: 6, purchasedCredits: 5 },
        windowLimits: {
          fiveHour: { cap: 3, used: 0.75, resetAt: 1_780_000_000_000 },
          weekly: { cap: 15, used: 1.5, resetAt: 1_780_100_000_000 },
        },
      },
      subscription: {
        data: {
          planId: "individual-go",
          currentPeriodEnd: "2026-06-01T00:00:00Z",
        },
      },
    });

    expect(parsed.windows.map((window) => [window.key, window.label])).toEqual([
      ["fiveHour", "5h"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
    ]);
    expect(parsed.windows[0]).toMatchObject({
      used: 0.75,
      limit: 3,
      usedPercent: 25,
      unit: "USD",
      resetAt: 1_780_000_000_000,
      windowDurationMins: 300,
    });
    expect(parsed.windows[1]).toMatchObject({
      used: 1.5,
      limit: 15,
      usedPercent: 10,
      windowDurationMins: 10_080,
    });
    expect(parsed.windows[2]).toMatchObject({
      used: 4,
      limit: 10,
      usedPercent: 40,
      resetAt: Date.parse("2026-06-01T00:00:00Z"),
    });
    expect(parsed.balances).toContainEqual({
      label: "Purchased remaining",
      remaining: 5,
      unit: "USD",
    });
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

- [ ] **Step 3: Implement the parser contract and three-window mapping**

Create `src/providers/command-code/usage-parser.ts` with these imports and helpers:

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

export type ParsedCommandCodeUsage = Pick<
  ProviderUsageSnapshot,
  "windows" | "balances" | "planName"
>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  const epoch = parseEpochMs(value);
  if (epoch != null) return epoch;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
};

function parseRateWindow(
  value: unknown,
  key: string,
  label: string,
  windowDurationMins: number,
): LiveUsageWindow | undefined {
  const record = asRecord(value);
  const limit = toFinite(record?.cap);
  if (limit == null || limit <= 0) return undefined;
  const used = toFinite(record?.used) ?? 0;
  return {
    key,
    label,
    used,
    limit,
    unit: "USD",
    usedPercent: clampPercent((used / limit) * 100),
    resetAt: parseTimestamp(record?.resetAt),
    windowDurationMins,
  };
}
```

Implement `parseCommandCodeUsage()` with the exact data rules below:

```ts
export function parseCommandCodeUsage(
  payloads: CommandCodePayloads,
): ParsedCommandCodeUsage {
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

  const totalCost = toFinite(payloads.summary?.totalCost);
  const monthlyCredits = toFinite(credits?.monthlyCredits);
  const purchasedCredits = toFinite(credits?.purchasedCredits) ?? 0;
  const monthlyResetAt = parseTimestamp(subscription?.currentPeriodEnd);

  if (totalCost != null && monthlyCredits != null) {
    const limit = totalCost + monthlyCredits;
    windows.push({
      key: "monthly",
      label: "Monthly",
      used: totalCost,
      limit,
      unit: "USD",
      usedPercent: limit > 0 ? clampPercent((totalCost / limit) * 100) : 0,
      resetAt: monthlyResetAt,
    });
  } else if (totalCost != null) {
    windows.push({
      key: "monthly",
      label: "Monthly",
      used: totalCost,
      unit: "USD",
      usedPercent: 0,
      unavailableReason: "Remaining balance unavailable",
    });
  } else if (monthlyCredits != null) {
    windows.push({
      key: "monthly",
      label: "Monthly",
      unit: "USD",
      usedPercent: 0,
      unavailableReason: "Consumed cost unavailable",
    });
  }

  const balances: ProviderUsageSnapshot["balances"] = [];
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

  const totalCount = toFinite(payloads.summary?.totalCount);
  const totalTokens = toFinite(payloads.summary?.totalTokens);
  const totalTokensIn = toFinite(payloads.summary?.totalTokensIn);
  const totalTokensOut = toFinite(payloads.summary?.totalTokensOut);
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

- [ ] **Step 4: Run the focused parser test and confirm it passes**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: PASS, including the new parser case and all existing provider cases.

- [ ] **Step 5: Add coercion, invalid-cap, and plan-name regression tests**

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
    subscription: { data: { planId: "individual-goat" } },
  });

  expect(
    parsed.windows.slice(0, 2).map((window) => window.usedPercent),
  ).toEqual([25, 20]);
  expect(parsed.windows[0].resetAt).toBe(1_780_200_000_000);
  expect(parsed.windows[1].resetAt).toBe(Date.parse("2026-06-01T00:00:00Z"));
  expect(parsed.planName).toBe("GOAT");
});

it("omits invalid caps, defaults missing usage, and clamps overuse", () => {
  const parsed = parseCommandCodeUsage({
    credits: {
      credits: {},
      windowLimits: {
        fiveHour: { cap: 3 },
        weekly: { cap: 0, used: 2 },
      },
    },
  });
  expect(parsed.windows).toHaveLength(1);
  expect(parsed.windows[0]).toMatchObject({
    key: "fiveHour",
    used: 0,
    usedPercent: 0,
  });

  const overused = parseCommandCodeUsage({
    credits: {
      credits: {},
      windowLimits: { fiveHour: { cap: 3, used: 4 } },
    },
  });
  expect(overused.windows[0].usedPercent).toBe(100);
});

it("maps Pro v1 and preserves unknown plan IDs", () => {
  expect(
    parseCommandCodeUsage({
      subscription: { data: { planId: "individual-pro-v1" } },
    }).planName,
  ).toBe("Pro");
  expect(
    parseCommandCodeUsage({
      subscription: { data: { planId: "team-future" } },
    }).planName,
  ).toBe("team-future");
});
```

- [ ] **Step 6: Run the focused tests again**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: PASS with all parser and existing integration cases green.

- [ ] **Step 7: Commit the pure parser**

```bash
git add src/providers/command-code/usage-parser.ts tests/provider-command-code.test.ts
git commit -m "feat(command-code): parse rolling usage windows"
```
