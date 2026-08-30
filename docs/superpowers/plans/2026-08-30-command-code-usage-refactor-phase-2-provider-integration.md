# Command Code Usage Refactor Phase 2: Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Phase 1 parser to a split Command Code API client and provider adapter, delivering live 5-hour, weekly, and monthly usage windows.

**Architecture:** Move cookie and HTTP concerns into a provider-local API client, then replace the monolithic provider with a thin directory entrypoint that composes the client, parser, and existing live cache runtime. Preserve partial endpoint success and the current rate-limit, credential, and cache behavior.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

**Parent Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-08-30-command-code-usage-refactor-phase-1-usage-parser.md`; `parseCommandCodeUsage()` and its exported payload/result types must exist with Phase 1 tests passing.

**Atomic Result:** The provider registry uses the split Command Code adapter, live snapshots expose all available quota windows, partial failures retain usable data, and the complete project check passes.

## Global Constraints

- Change only `pi-usage`; `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/codexbar` are read-only references.
- Keep Node.js support at `>=24.15.0`.
- Add no dependencies, public exports, shared usage types, environment variables, local estimates, or static plan-price catalog.
- Preserve the existing `COMMAND_CODE_COOKIE_HEADER` configuration, provider cache/backoff behavior, request/token balances, and partial-success behavior.
- Purchased credits remain a balance and never increase the monthly included-credit limit.

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
