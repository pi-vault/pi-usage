# Command Code Usage Refactor Phase 2: Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 1 parser into the existing Command Code provider so live snapshots expose 5-hour and weekly windows with all existing balances.

**Architecture:** Keep `src/providers/command-code.ts` as the provider entrypoint and `src/providers/command-code/usage-parser.ts` as the pure parser. Replace the provider's duplicate payload interpretation with `parseCommandCodeUsage()`, extend its accepted cookie aliases, and preserve its current requests, diagnostics, cache runtime, and failure priority.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

**Parent Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor.md`

**Prerequisite:** Phase 1 is complete: `parseCommandCodeUsage()` and `CommandCodePayloads` exist and `pnpm exec vitest run tests/provider-command-code.test.ts` passes.

## Global Constraints

- Change only `pi-usage`; `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/codexbar` are read-only references.
- Keep Node.js support at `>=24.15.0`.
- Add no files, dependencies, public exports, shared usage types, environment variables, local estimates, or static plan-price catalog.
- Preserve `COMMAND_CODE_COOKIE_HEADER`, all three current endpoint requests, provider cache/backoff behavior, request/token balances, and partial-success behavior.
- Preserve monthly and purchased credits as balances; do not synthesize a monthly usage window.
- Rolling windows expose percentages and reset timing, not currency-valued ratios.
- Keep the provider registry import unchanged.

## Reference Findings

- Command Code documents 5-hour and weekly rolling caps over included monthly credits; purchased credits bypass both limits: <https://commandcode.ai/docs/resources/usage-limits>.
- Current CodexBar reads both rolling windows from `/internal/billing/credits`, accepts root and nested `windowLimits`, and supports `commandcode_prod_.session_token` plus `__Host-commandcode_prod_.session_token`.
- Pi has no Command Code usage-limit integration to reuse or modify.

---

### Task 2: Wire the Parser into the Existing Provider

**Files:**

- Modify: `src/providers/command-code.ts`
- Modify: `tests/provider-command-code.test.ts`

**Interfaces:**

- Consumes: `parseCommandCodeUsage(payloads: CommandCodePayloads): Pick<ProviderUsageSnapshot, "windows" | "balances" | "planName">` from Phase 1; existing `fetchWithTimeout()`, `readJsonObject()`, `retryAfterMs()`, and `fetchWithLiveRuntime()`.
- Produces: unchanged `createCommandCodeProvider(deps: UsageDeps): UsageProviderAdapter` behavior with rolling windows supplied by the parser.

- [ ] **Step 1: Confirm the supported runtime and clean starting state**

Run:

```bash
node --version
git status --short
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: Node.js is `v24.15.0` or newer, `git status --short` is empty, and all focused tests pass. If Node.js is older, switch to a supported runtime before using later test results as completion evidence.

- [ ] **Step 2: Update provider integration coverage**

In `tests/provider-command-code.test.ts`, rename `uses cookie auth and parses aggregate usage` to `uses cookie auth and exposes rolling usage with balances`. Change its credits response to:

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

Replace its current-cycle assertions with:

```ts
expect(snapshot.status).toBe("live");
expect(snapshot.windows.map((window) => [window.key, window.label])).toEqual([
  ["fiveHour", "5h"],
  ["weekly", "Weekly"],
]);
expect(snapshot.balances).toEqual(
  expect.arrayContaining([
    { label: "Monthly remaining", remaining: 5.7112, unit: "USD" },
    { label: "Purchased remaining", remaining: 5, unit: "USD" },
    { label: "Requests", remaining: 42, unit: "count" },
    { label: "Tokens", remaining: 1_234, unit: "tok" },
  ]),
);
expect(snapshot.planName).toBe("Go");
expect(snapshot.sourceLabel).toContain("Command Code");
expect(fetchImpl).toHaveBeenCalledTimes(3);
```

Replace `keeps aggregate usage when subscription enrichment fails` with this stronger partial-success regression:

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
  ]);
  expect(snapshot.balances).toContainEqual({
    label: "Monthly remaining",
    remaining: 6,
    unit: "USD",
  });
  expect(snapshot.diagnostics).toEqual(
    expect.arrayContaining([
      "Summary endpoint unavailable.",
      "Subscription endpoint unavailable.",
    ]),
  );
  rmSync(root, { recursive: true, force: true });
});
```

Add cookie-alias coverage:

```ts
it.each([
  "commandcode_prod_.session_token",
  "__Host-commandcode_prod_.session_token",
])("accepts current Command Code cookie alias %s", async (cookieName) => {
  const root = mkTmp();
  const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
    expect(new Headers(init?.headers).get("cookie")).toBe(
      `${cookieName}=token`,
    );
    if (url.toString().includes("/billing/credits")) {
      return new Response(
        JSON.stringify({ credits: { monthlyCredits: 0 } }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });

  const snapshot = (
    await commandCodeProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        COMMAND_CODE_COOKIE_HEADER: `${cookieName}=token`,
      }),
    ).fetch()
  ).snapshot;
  expect(snapshot.status).toBe("live");
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  rmSync(root, { recursive: true, force: true });
});
```

Add compact status-classification coverage:

```ts
it.each([
  { status: 429, diagnostic: "Rate limited.", hasRetry: true },
  { status: 401, diagnostic: "session expired", hasRetry: false },
])(
  "classifies primary $status responses",
  async ({ status, diagnostic, hasRetry }) => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async () =>
      new Response("{}", { status }),
    );
    const outcome = await commandCodeProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        COMMAND_CODE_COOKIE_HEADER: "abc",
      }),
    ).fetch();

    expect(outcome.snapshot.available).toBe(false);
    expect(outcome.snapshot.diagnostics.join(" ")).toContain(diagnostic);
    expect(Boolean(outcome.nextRetryAt)).toBe(hasRetry);
    rmSync(root, { recursive: true, force: true });
  },
);
```

- [ ] **Step 3: Run the focused test and verify the old provider fails the new expectations**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: FAIL because the existing provider still emits `current-cycle` and rejects the two newly covered cookie aliases.

- [ ] **Step 4: Replace duplicate provider parsing with the Phase 1 parser**

In `src/providers/command-code.ts`, reduce the type import to `UsageProviderAdapter`, remove `toFinite` from the runtime import, remove the local `asRecord()` helper, and add:

```ts
import { parseCommandCodeUsage } from "./command-code/usage-parser.ts";
```

Extend the existing `cookieNames` array without changing its current entries or bare-token default:

```ts
const cookieNames = [
  "__Secure-commandcode_prod_.session_token",
  "commandcode_prod_.session_token",
  "__Host-commandcode_prod_.session_token",
  "__Host-better-auth.session_token",
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
];
```

After decoding the three endpoint responses, replace the local cost, window, balance, and plan parsing block with:

```ts
const summary = await readJson(summaryRes, "Summary");
const credits = await readJson(creditsRes, "Credits");
const subscription = await readJson(subsRes, "Subscription");
const parsed = parseCommandCodeUsage({ summary, credits, subscription });
```

Change the empty-result check to:

```ts
if (parsed.windows.length === 0 && parsed.balances.length === 0) {
```

Keep the existing primary-response status classification unchanged. In the successful snapshot, remove the old `balances`, `windows`, and `planName` fields and spread the parser result after diagnostics:

```ts
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
  diagnostics,
  ...parsed,
},
```

- [ ] **Step 5: Run the focused provider suite**

Run:

```bash
pnpm exec vitest run tests/provider-command-code.test.ts
```

Expected: PASS. The provider emits only `fiveHour` and `weekly` windows, retains all balances, accepts all covered cookies, preserves partial success, and classifies primary 429/401 responses.

- [ ] **Step 6: Run type checking and the complete project check**

Run under Node.js `>=24.15.0`:

```bash
pnpm typecheck
pnpm check
```

Expected: both commands exit 0. `pnpm check` runs Biome lint, TypeScript compilation, and every Vitest suite without an unsupported-engine warning.

- [ ] **Step 7: Review scope and commit the integration**

Run:

```bash
git diff --check
git status --short
git diff -- src/providers/command-code.ts tests/provider-command-code.test.ts
```

Expected: `git diff --check` exits 0 and implementation changes are limited to the provider and its test.

Commit:

```bash
git add src/providers/command-code.ts tests/provider-command-code.test.ts
git commit -m "refactor(command-code): expose usage limit windows"
```
