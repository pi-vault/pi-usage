# Command Code Usage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Command Code provider into three focused modules and publish its 5-hour, weekly, and monthly limits through the existing usage dashboard.

**Architecture:** A pure parser converts Command Code JSON payloads into the existing window/balance model. A provider-specific API client owns authentication and endpoint behavior, while a thin directory entrypoint connects both pieces to the existing live cache runtime.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

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

---

### Task 2: Split the API Client and Wire the Provider Adapter

**Files:**

- Create: `src/providers/command-code/api-client.ts`
- Create: `src/providers/command-code/index.ts`
- Delete: `src/providers/command-code.ts`
- Modify: `src/providers/index.ts`
- Modify: `tests/provider-command-code.test.ts`

**Interfaces:**

- Consumes: `CommandCodePayloads` and `parseCommandCodeUsage()` from Task 1; existing `UsageDeps`, `fetchWithTimeout()`, `readJsonObject()`, `retryAfterMs()`, and `fetchWithLiveRuntime()`.
- Produces:

```ts
export interface CommandCodeApiResult {
  payloads: CommandCodePayloads;
  diagnostics: string[];
  primaryResponses: Response[];
}

export function normalizeCommandCodeCookie(
  raw: string | undefined,
): string | undefined;

export function fetchCommandCodeApi(
  deps: UsageDeps,
  cookie: string,
  signal?: AbortSignal,
): Promise<CommandCodeApiResult>;

export function createCommandCodeProvider(
  deps: UsageDeps,
): UsageProviderAdapter;
```

- [ ] **Step 1: Update the integration test to require all three windows**

In the existing `uses cookie auth and parses aggregate usage` test, return rolling limits with the credits payload and make purchased credits nonzero:

```ts
if (url.toString().includes("/billing/credits")) {
  return new Response(
    JSON.stringify({
      credits: { monthlyCredits: 5.7112, purchasedCredits: 5 },
      windowLimits: {
        fiveHour: { cap: 3, used: 0.75, resetAt: 1_780_000_000_000 },
        weekly: { cap: 15, used: 1.5, resetAt: 1_780_100_000_000 },
      },
    }),
    { status: 200 },
  );
}
```

Replace the old current-cycle assertions with:

```ts
expect(snapshot.windows.map((window) => [window.key, window.label])).toEqual([
  ["fiveHour", "5h"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
]);
expect(snapshot.windows[2].limit).toBeCloseTo(10);
expect(snapshot.balances).toContainEqual({
  label: "Purchased remaining",
  remaining: 5,
  unit: "USD",
});
expect(snapshot.planName).toBe("Go");
expect(fetchImpl).toHaveBeenCalledTimes(3);
```

- [ ] **Step 2: Run the focused test and verify the old adapter fails the new expectations**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: FAIL because the old adapter emits only `current-cycle` and includes purchased credits in that limit.

- [ ] **Step 3: Move cookie and HTTP behavior into the API client**

Create `src/providers/command-code/api-client.ts`. Move the existing cookie-name list and normalization behavior unchanged, exporting it as `normalizeCommandCodeCookie()`. Keep the existing headers and URLs, then implement the public result contract as follows:

```ts
import type { UsageDeps } from "../../shared/deps.ts";
import { fetchWithTimeout, readJsonObject } from "../runtime.ts";
import type { CommandCodePayloads } from "./usage-parser.ts";

export interface CommandCodeApiResult {
  payloads: CommandCodePayloads;
  diagnostics: string[];
  primaryResponses: Response[];
}

export function normalizeCommandCodeCookie(
  raw: string | undefined,
): string | undefined {
  const input = raw?.trim();
  if (!input) return undefined;
  const bare = input.replace(/^cookie\s*:\s*/i, "").trim();
  const cookieNames = [
    "__Secure-commandcode_prod_.session_token",
    "__Host-better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
  ];
  const parts = bare
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const name of cookieNames) {
    const found = parts.find((part) => part.startsWith(`${name}=`));
    if (found?.slice(name.length + 1).trim()) return found;
  }
  if (
    parts.length === 1 &&
    !parts[0].includes("=") &&
    !/[\s,]/.test(parts[0])
  ) {
    return `__Secure-commandcode_prod_.session_token=${parts[0]}`;
  }
  return undefined;
}

export async function fetchCommandCodeApi(
  deps: UsageDeps,
  cookie: string,
  signal?: AbortSignal,
): Promise<CommandCodeApiResult> {
  const headers = {
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137 Safari/537.36",
    Origin: "https://commandcode.ai",
    Referer: "https://commandcode.ai/",
  };
  const diagnostics: string[] = [];
  const request = async (url: string, label: string) => {
    try {
      return await fetchWithTimeout(deps, url, { headers, signal });
    } catch {
      diagnostics.push(`${label} endpoint unavailable.`);
      return undefined;
    }
  };
  const [summaryResponse, creditsResponse, subscriptionResponse] =
    await Promise.all([
      request("https://api.commandcode.ai/internal/usage/summary", "Summary"),
      request("https://api.commandcode.ai/internal/billing/credits", "Credits"),
      request(
        "https://api.commandcode.ai/internal/billing/subscriptions",
        "Subscription",
      ),
    ]);

  const readJson = async (response: Response | undefined, label: string) => {
    if (!response) return undefined;
    if (response.status === 401 || response.status === 403) {
      diagnostics.push(`${label} rejected the Command Code session.`);
      return undefined;
    }
    if (response.status === 429) {
      diagnostics.push(`${label} endpoint rate limited.`);
      return undefined;
    }
    if (!response.ok) {
      diagnostics.push(`${label} endpoint unavailable.`);
      return undefined;
    }
    const json = await readJsonObject(response);
    if (!json) diagnostics.push(`${label} response shape unsupported.`);
    return json;
  };

  const [summary, credits, subscription] = await Promise.all([
    readJson(summaryResponse, "Summary"),
    readJson(creditsResponse, "Credits"),
    readJson(subscriptionResponse, "Subscription"),
  ]);
  return {
    payloads: { summary, credits, subscription },
    diagnostics,
    primaryResponses: [summaryResponse, creditsResponse].filter(
      (response): response is Response => Boolean(response),
    ),
  };
}
```

- [ ] **Step 4: Replace the old provider file with the thin directory entrypoint**

Create `src/providers/command-code/index.ts` using the client and parser contracts:

```ts
import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../../shared/constants.ts";
import type { UsageDeps } from "../../shared/deps.ts";
import type { UsageProviderAdapter } from "../../shared/types.ts";
import { fetchWithLiveRuntime, retryAfterMs } from "../runtime.ts";
import {
  fetchCommandCodeApi,
  normalizeCommandCodeCookie,
} from "./api-client.ts";
import { parseCommandCodeUsage } from "./usage-parser.ts";

export function createCommandCodeProvider(
  deps: UsageDeps,
): UsageProviderAdapter {
  return {
    id: "command-code",
    label: PROVIDER_LABELS["command-code"],
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "command-code",
          fetchLive: async ({ now, signal }) => {
            const configuredCookie = deps.env.COMMAND_CODE_COOKIE_HEADER;
            const cookie = normalizeCommandCodeCookie(configuredCookie);
            if (!cookie) {
              return {
                kind: "credentials" as const,
                message: configuredCookie?.trim()
                  ? "Malformed COMMAND_CODE_COOKIE_HEADER."
                  : "Missing COMMAND_CODE_COOKIE_HEADER.",
              };
            }

            const api = await fetchCommandCodeApi(deps, cookie, signal);
            const parsed = parseCommandCodeUsage(api.payloads);
            if (parsed.windows.length === 0 && parsed.balances.length === 0) {
              const rateLimited = api.primaryResponses.find(
                (response) => response.status === 429,
              );
              if (rateLimited) {
                return {
                  kind: "rate-limited" as const,
                  message: "Rate limited.",
                  nextRetryAt: now + retryAfterMs(rateLimited.headers, now),
                };
              }
              if (
                api.primaryResponses.some(
                  (response) =>
                    response.status === 401 || response.status === 403,
                )
              ) {
                return {
                  kind: "credentials" as const,
                  message:
                    "Command Code session expired. Update COMMAND_CODE_COOKIE_HEADER.",
                };
              }
              return {
                kind: "error" as const,
                message: api.diagnostics[0] ?? "Live source unavailable.",
              };
            }

            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "command-code",
                providerLabel: PROVIDER_LABELS["command-code"],
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + PROVIDER_TTLS_MS["command-code"],
                status: "live",
                sourceLabel: "Command Code web usage API",
                sourceKind: "live",
                diagnostics: api.diagnostics,
                ...parsed,
              },
            };
          },
        },
        input,
      ),
  };
}
```

Delete `src/providers/command-code.ts`. In `src/providers/index.ts`, change only the import path:

```ts
import { createCommandCodeProvider } from "./command-code/index.ts";
```

- [ ] **Step 5: Run the focused provider tests**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: PASS. The integration snapshot contains `fiveHour`, `weekly`, and `monthly`; its monthly limit remains approximately 10 despite five purchased credits.

- [ ] **Step 6: Add a partial-failure integration regression**

Add this provider test to `tests/provider-command-code.test.ts`:

```ts
it("keeps rolling limits when summary and subscription fail", async () => {
  const root = mkTmp();
  const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
    if (url.toString().includes("/billing/credits")) {
      return new Response(
        JSON.stringify({
          credits: { monthlyCredits: 6 },
          windowLimits: {
            fiveHour: { cap: 3, used: 1, resetAt: 1_780_000_000_000 },
            weekly: { cap: 15, used: 2, resetAt: 1_780_100_000_000 },
          },
        }),
        { status: 200 },
      );
    }
    throw new Error("endpoint unavailable");
  });

  const snapshot = (
    await commandCodeProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        COMMAND_CODE_COOKIE_HEADER: "abc",
      }),
    ).fetch()
  ).snapshot;
  expect(snapshot.status).toBe("live");
  expect(snapshot.windows.map((window) => window.key)).toEqual([
    "fiveHour",
    "weekly",
    "monthly",
  ]);
  expect(snapshot.windows[2].unavailableReason).toBe(
    "Consumed cost unavailable",
  );
  expect(snapshot.diagnostics).toEqual(
    expect.arrayContaining([
      "Summary endpoint unavailable.",
      "Subscription endpoint unavailable.",
    ]),
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 7: Run focused tests, type checking, and the full project check**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
pnpm typecheck
pnpm check
```

Expected: all commands exit 0. The full check runs Biome lint, TypeScript compilation, and every Vitest suite.

- [ ] **Step 8: Review the final diff for scope and whitespace errors**

Run:

```bash
git diff --check
git status --short
git diff -- src/providers/command-code src/providers/index.ts tests/provider-command-code.test.ts
```

Expected: `git diff --check` exits 0; only the planned provider, registry, test, spec, and plan files are changed or added.

- [ ] **Step 9: Commit the provider split and integration**

```bash
git add src/providers/command-code.ts src/providers/command-code src/providers/index.ts tests/provider-command-code.test.ts docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md
git commit -m "refactor(command-code): expose usage limit windows"
```
