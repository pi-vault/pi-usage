# Phase 3: StepFun Step Plan Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Normalize StepFun monthly subscription and booster Credits into one accurate `LiveUsageWindow` without showing false exhaustion.

**Architecture:** Add two small provider-local boundaries: one exact Credit-plan classifier and one Credit-window builder. Valid complete bucket sets provide absolute totals; otherwise independent remaining-rate fields provide a percentage-only fallback. Legacy 5-hour/weekly normalization remains unchanged.

**Tech Stack:** TypeScript 6, Vitest 4, existing `LiveUsageWindow`, `toFinite`, `parseEpochMs`, and `clampPercentRounded` helpers.

**Phase dependency:** Phase 2 is committed and `.ai` browser-session legacy usage passes.

**Usable result:** New Step Plan subscribers see a `Credits` bar, absolute used/total values when available, and the subscription reset. Legacy plans remain usable.

**Out of scope:** Standard API account balance, separate booster bars, bucket-expiry UI, `.com`, password authentication, Insights UI, documentation, and new dependencies.

## Fixed normalization contract

- A payload is a Credit plan when `plan_family` parses to `2`.
- Without `plan_family: 2`, it is Credit-only when `plan_credit_rate_limit` is an object and all four legacy rate/reset fields are absent or numerically zero.
- Use bucket arithmetic only when every bucket is an object with finite `credit_total > 0` and finite `0 <= credit_residual <= credit_total`.
- One invalid bucket discards the entire bucket set.
- Without usable buckets, prefer a valid `subscription_credit_left_rate`; use `topup_credit_left_rate` only when the subscription fraction is absent or outside `[0, 1]`.
- Never add subscription and top-up fractions.
- Use only `subscription_credit_reset_time` for `resetAt`. Do not map `expire_at` or `next_reset_at` into the combined bar.
- A classified Credit payload with no usable buckets or rates is malformed, not 100% used.

---

### Task 1: Specify weighted Credit arithmetic

**Files:**
- Modify: `tests/provider-stepfun.test.ts`

- [ ] **Step 1: Add the complete-bucket test**

```ts
it("combines only a complete valid Credit bucket set", async () => {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response(
            JSON.stringify({
              status: 1,
              plan_family: "2",
              plan_credit_rate_limit: {
                subscription_credit_left_rate: "0.25",
                subscription_credit_reset_time: "1778000000",
                topup_credit_left_rate: 1,
                credit_buckets: [
                  {
                    credit_total: "400000000",
                    credit_residual: 100000000,
                  },
                  {
                    credit_total: 100000000,
                    credit_residual: "100000000",
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (String(url).includes("GetStepPlanStatus")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  expect((await provider.fetch()).snapshot.windows).toEqual([
    {
      key: "credits",
      label: "Credits",
      used: 300_000_000,
      limit: 500_000_000,
      unit: "credits",
      usedPercent: 60,
      resetAt: 1778000000_000,
    },
  ]);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add the all-or-nothing bucket fallback test**

```ts
it("falls back to subscription rate when any Credit bucket is invalid", async () => {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response(
            JSON.stringify({
              status: 1,
              plan_family: 2,
              plan_credit_rate_limit: {
                subscription_credit_left_rate: 0.8,
                topup_credit_left_rate: 0.5,
                credit_buckets: [
                  { credit_total: 100, credit_residual: 50 },
                  { credit_total: 0, credit_residual: 0 },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (String(url).includes("GetStepPlanStatus")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  expect((await provider.fetch()).snapshot.windows).toEqual([
    {
      key: "credits",
      label: "Credits",
      unit: "credits",
      usedPercent: 20,
      resetAt: undefined,
    },
  ]);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 3: Add the ordered-rate fallback test**

```ts
it("uses top-up rate only when subscription rate is unavailable", async () => {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response(
            JSON.stringify({
              status: 1,
              plan_family: 2,
              plan_credit_rate_limit: {
                subscription_credit_left_rate: 2,
                topup_credit_left_rate: "0.4",
              },
            }),
            { status: 200 },
          );
        }
        if (String(url).includes("GetStepPlanStatus")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  expect((await provider.fetch()).snapshot.windows[0]).toEqual(
    expect.objectContaining({
      key: "credits",
      usedPercent: 60,
      resetAt: undefined,
    }),
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run the focused tests and confirm failure**

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: FAIL because `plan_credit_rate_limit` is not normalized.

---

### Task 2: Specify Credit classification and malformed behavior

**Files:**
- Modify: `tests/provider-stepfun.test.ts`

- [ ] **Step 1: Add Credit-only classification without `plan_family`**

```ts
it("recognizes a Credit-only response without plan_family", async () => {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response(
            JSON.stringify({
              status: 1,
              five_hour_usage_left_rate: 0,
              weekly_usage_left_rate: "0",
              five_hour_usage_reset_time: "0",
              weekly_usage_reset_time: 0,
              plan_credit_rate_limit: {
                subscription_credit_left_rate: "0.75",
                subscription_credit_reset_time: 1778000000,
              },
            }),
            { status: 200 },
          );
        }
        if (String(url).includes("GetStepPlanStatus")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  expect((await provider.fetch()).snapshot.windows[0]).toEqual(
    expect.objectContaining({
      key: "credits",
      usedPercent: 25,
      resetAt: 1778000000_000,
    }),
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add malformed Credit-only rejection**

```ts
it("rejects malformed Credit-only responses instead of showing exhaustion", async () => {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response(
            JSON.stringify({
              status: 1,
              plan_family: 2,
              plan_credit_rate_limit: {},
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  const result = await provider.fetch();
  expect(result.snapshot.diagnostic).toBe("StepFun response malformed.");
  expect(result.snapshot.windows).toEqual([]);
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 3: Verify classification tests fail for the intended reason**

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: FAIL because zero legacy windows are still rendered as exhausted and malformed Credit data is not rejected through a Credit-specific path.

---

### Task 3: Implement exact Credit classification and normalization

**Files:**
- Modify: `src/providers/stepfun.ts`

- [ ] **Step 1: Add the object and zero-value boundaries**

```ts
function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function zeroOrMissing(value: unknown): boolean {
  const number = toFinite(value);
  return number === undefined || number === 0;
}
```

- [ ] **Step 2: Add the exact classifier**

```ts
function isCreditPlanPayload(payload: Record<string, unknown>): boolean {
  if (toFinite(payload.plan_family) === 2) return true;
  if (!objectValue(payload.plan_credit_rate_limit)) return false;
  return (
    zeroOrMissing(payload.five_hour_usage_left_rate) &&
    zeroOrMissing(payload.weekly_usage_left_rate) &&
    zeroOrMissing(payload.five_hour_usage_reset_time) &&
    zeroOrMissing(payload.weekly_usage_reset_time)
  );
}
```

- [ ] **Step 3: Add the complete Credit-window builder**

```ts
function buildCreditWindow(
  payload: Record<string, unknown>,
): LiveUsageWindow | undefined {
  const credit = objectValue(payload.plan_credit_rate_limit);
  if (!credit) return undefined;

  const resetAt = parseEpochMs(credit.subscription_credit_reset_time);
  const buckets = Array.isArray(credit.credit_buckets)
    ? credit.credit_buckets
    : undefined;

  if (buckets && buckets.length > 0) {
    const parsed = buckets.map((bucket) => {
      const row = objectValue(bucket);
      const total = toFinite(row?.credit_total);
      const residual = toFinite(row?.credit_residual);
      if (
        total === undefined ||
        residual === undefined ||
        total <= 0 ||
        residual < 0 ||
        residual > total
      ) {
        return undefined;
      }
      return { total, residual };
    });
    const valid = parsed.filter(
      (bucket): bucket is { total: number; residual: number } =>
        bucket !== undefined,
    );
    if (valid.length === buckets.length) {
      const limit = valid.reduce((sum, bucket) => sum + bucket.total, 0);
      const remaining = valid.reduce(
        (sum, bucket) => sum + bucket.residual,
        0,
      );
      const used = limit - remaining;
      return {
        key: "credits",
        label: "Credits",
        used,
        limit,
        unit: "credits",
        usedPercent: clampPercentRounded((used / limit) * 100),
        resetAt,
      };
    }
  }

  const leftRate = [
    credit.subscription_credit_left_rate,
    credit.topup_credit_left_rate,
  ]
    .map(toFinite)
    .find((rate) => rate !== undefined && rate >= 0 && rate <= 1);
  if (leftRate === undefined) return undefined;

  return {
    key: "credits",
    label: "Credits",
    unit: "credits",
    usedPercent: clampPercentRounded((1 - leftRate) * 100),
    resetAt,
  };
}
```

- [ ] **Step 4: Select Credit or legacy windows once**

In `fetchStepFunUsage`, replace the unconditional legacy window array with:

```ts
const windows = isCreditPlanPayload(payload)
  ? [buildCreditWindow(payload)].filter(
      (window): window is LiveUsageWindow => window !== undefined,
    )
  : [
      buildWindow(
        "fiveHour",
        "5h",
        payload.five_hour_usage_left_rate,
        payload.five_hour_usage_reset_time,
      ),
      buildWindow(
        "weekly",
        "Weekly",
        payload.weekly_usage_left_rate,
        payload.weekly_usage_reset_time,
      ),
    ].filter((window): window is LiveUsageWindow => window !== undefined);
```

Keep the existing `windows.length === 0` malformed-response branch and non-fatal plan-status request.

- [ ] **Step 5: Run focused and type checks**

```sh
pnpm test -- tests/provider-stepfun.test.ts
pnpm typecheck
```

Expected: PASS. Weighted buckets show 60% used and 300M/500M credits; any invalid bucket falls back to the 20% subscription usage; top-up-only fallback shows 60%; malformed Credit-only data returns no windows.

- [ ] **Step 6: Commit the atomic Credit feature**

```sh
git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
git commit -m "feat: track StepFun Step Plan Credits"
```

---

### Phase verification

- [ ] Run:

```sh
pnpm check
```

Expected: PASS, including retained legacy StepFun tests.

- [ ] Review provider scope:

```sh
git diff --check
git status --short
git log -1 --oneline
```

Expected: no whitespace errors, no uncommitted Phase 3 files, and the latest commit is `feat: track StepFun Step Plan Credits`.

**Stop here.** StepFun browser-session users now receive either a valid Credit bar or preserved legacy windows. Phase 4 changes only Insights UI behavior.