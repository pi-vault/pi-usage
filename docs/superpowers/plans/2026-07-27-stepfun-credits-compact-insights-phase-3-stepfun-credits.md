# StepFun Step Plan Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize StepFun monthly subscription and booster Credits into one accurate LiveUsageWindow without displaying false exhaustion.

**Architecture:** Keep the change inside the existing StepFun provider and provider test. Add one strict Credit-plan classifier and one Credit-window builder, reusing the existing runtime numeric, epoch, and percentage helpers. A complete valid bucket set supplies absolute totals; otherwise the provider selects one valid remaining-rate fallback. Legacy five-hour and weekly normalization remains unchanged.

**Tech Stack:** TypeScript 6, Node.js 24.15.0, Vitest 4, pnpm, existing LiveUsageWindow, toFinite, parseEpochMs, and clampPercentRounded helpers.

---

## Scope and file responsibilities

- Modify src/providers/stepfun.ts for Credit classification, bucket arithmetic, fallback selection, and one-time Credit-versus-legacy window selection.
- Modify tests/provider-stepfun.test.ts for Credit arithmetic, classification boundaries, malformed responses, and retained legacy behavior.
- No public type changes, new dependencies, API endpoint changes, UI changes, or documentation changes outside this plan.

The Phase 2 browser-session migration is already committed. This plan is authoritative for Phase 3 and does not require a separate design-spec file.

## Fixed behavior

- A payload is a Credit plan when plan_family parses to 2.
- Without plan_family parsing to 2, it is Credit-only only when plan_credit_rate_limit is a plain object and all four legacy fields are either absent (undefined) or numerically zero. A present malformed value is not absent.
- Bucket arithmetic is allowed only for a non-empty credit_buckets array where every row is an object with finite credit_total greater than zero and finite credit_residual in the inclusive range from zero to credit_total. One invalid row invalidates the whole set.
- The aggregate bucket totals must remain finite and internally bounded. Otherwise use the rate fallback.
- If buckets are unusable, use subscription_credit_left_rate when it is finite and in [0, 1]. Use topup_credit_left_rate only when the subscription rate is absent or outside that range. Never add the two rates.
- resetAt comes only from subscription_credit_reset_time. Ignore expire_at and next_reset_at.
- A classified Credit payload with no usable buckets or rates returns the existing StepFun response-malformed error and no windows.
- A classified Credit payload produces one window with key credits, label Credits, and unit credits. Bucket data also includes used and limit. Rate fallback includes usedPercent only.
- The existing browser-session authentication, plan-status request, non-fatal plan-status failure, and legacy five-hour/weekly windows remain unchanged.

### Task 1: Add failing Credit regression tests

**Files:**

- Modify: tests/provider-stepfun.test.ts

- [ ] **Step 1: Add a reusable Credit response fixture helper**

Add this helper below stepfunProvider. It reuses the existing createLiveDeps and keeps every new test on the same browser-session and endpoint path:

    function creditProvider(
      root: string,
      payload: Record<string, unknown>,
    ) {
      return stepfunProvider(
        createLiveDeps(
          root,
          () => 1_000,
          vi.fn<UsageDeps["fetch"]>(async (url) => {
            const textUrl = String(url);
            if (textUrl.includes("QueryStepPlanRateLimit")) {
              return new Response(
                JSON.stringify({ status: 1, ...payload }),
                { status: 200 },
              );
            }
            if (textUrl.includes("GetStepPlanStatus")) {
              return new Response("boom", { status: 500 });
            }
            throw new Error("unexpected url: " + textUrl);
          }),
          { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
        ),
      );
    }

- [ ] **Step 2: Add the complete-bucket test**

Add this test inside the existing StepFun provider describe block. Include nonzero legacy rates to prove explicit plan_family takes precedence:

    it("combines only a complete valid Credit bucket set", async () => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        plan_family: "2",
        five_hour_usage_left_rate: 0.8,
        weekly_usage_left_rate: 0.9,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.25,
          subscription_credit_reset_time: "1778000000",
          topup_credit_left_rate: 1,
          credit_buckets: [
            { credit_total: "400000000", credit_residual: 100000000 },
            { credit_total: 100000000, credit_residual: "100000000" },
          ],
        },
      });

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

- [ ] **Step 3: Add invalid-bucket and ordered-rate fallback tests**

Add both tests:

    it("falls back to subscription rate when any Credit bucket is invalid", async () => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.8,
          topup_credit_left_rate: 0.5,
          credit_buckets: [
            { credit_total: 100, credit_residual: 50 },
            { credit_total: 0, credit_residual: 0 },
          ],
        },
      });

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

    it("uses top-up rate only when subscription rate is unavailable", async () => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 2,
          topup_credit_left_rate: "0.4",
        },
      });

      expect((await provider.fetch()).snapshot.windows[0]).toEqual(
        expect.objectContaining({
          key: "credits",
          usedPercent: 60,
          resetAt: undefined,
        }),
      );
      rmSync(root, { recursive: true, force: true });
    });

- [ ] **Step 4: Add family-less and strict-classification tests**

Add the family-less Credit-only case and a table covering present nonzero or malformed legacy values:

    it("recognizes Credit-only data without plan_family when legacy fields are zero", async () => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        five_hour_usage_left_rate: 0,
        weekly_usage_left_rate: "0",
        five_hour_usage_reset_time: "0",
        weekly_usage_reset_time: 0,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: "0.75",
          subscription_credit_reset_time: 1778000000,
        },
      });

      expect((await provider.fetch()).snapshot.windows[0]).toEqual(
        expect.objectContaining({
          key: "credits",
          usedPercent: 25,
          resetAt: 1778000000_000,
        }),
      );
      rmSync(root, { recursive: true, force: true });
    });

    it.each([
      {
        name: "nonzero legacy rate",
        legacy: { five_hour_usage_left_rate: 0.5 },
        expected: { key: "fiveHour", usedPercent: 50 },
      },
      {
        name: "malformed legacy rate",
        legacy: { five_hour_usage_left_rate: "not-a-number" },
        expected: undefined,
      },
    ])("does not treat $name as absent for Credit classification", async ({
      legacy,
      expected,
    }) => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        ...legacy,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.75,
        },
      });

      const result = await provider.fetch();
      if (expected) {
        expect(result.snapshot.windows[0]).toEqual(
          expect.objectContaining(expected),
        );
      } else {
        expect(result.snapshot.diagnostic).toBe(
          "StepFun response malformed.",
        );
        expect(result.snapshot.windows).toEqual([]);
      }
      rmSync(root, { recursive: true, force: true });
    });

- [ ] **Step 5: Add malformed explicit Credit coverage**

Add this test:

    it("rejects malformed Credit responses instead of showing exhaustion", async () => {
      const root = mkTmp();
      const provider = creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {},
      });

      const result = await provider.fetch();
      expect(result.snapshot.diagnostic).toBe(
        "StepFun response malformed.",
      );
      expect(result.snapshot.windows).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    });

- [ ] **Step 6: Run the focused tests and confirm the new tests fail**

Run:

    mise exec node@24.15.0 -- pnpm exec vitest run tests/provider-stepfun.test.ts

Expected: the five existing tests pass and the seven new Credit tests fail because the provider still emits legacy windows or rejects the Credit fields as unsupported.

### Task 2: Implement strict Credit classification and normalization

**Files:**

- Modify: src/providers/stepfun.ts

- [ ] **Step 1: Add the provider-local object and classification boundaries**

Add these functions immediately above fetchStepFunUsage. The undefined check is intentional: null, objects, and malformed strings are present values and must not satisfy the legacy-zero heuristic.

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    }

    function zeroOrMissing(value: unknown): boolean {
      return value === undefined || toFinite(value) === 0;
    }

    function isCreditPlanPayload(payload: Record<string, unknown>): boolean {
      if (toFinite(payload.plan_family) === 2) return true;
      if (!objectValue(payload.plan_credit_rate_limit)) return false;
      return [
        payload.five_hour_usage_left_rate,
        payload.weekly_usage_left_rate,
        payload.five_hour_usage_reset_time,
        payload.weekly_usage_reset_time,
      ].every(zeroOrMissing);
    }

- [ ] **Step 2: Add the Credit-window builder**

Add this function immediately after the classifier:

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
        let limit = 0;
        let remaining = 0;
        let valid = true;

        for (const bucket of buckets) {
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
            valid = false;
            break;
          }
          limit += total;
          remaining += residual;
        }

        if (
          valid &&
          Number.isFinite(limit) &&
          Number.isFinite(remaining) &&
          remaining >= 0 &&
          remaining <= limit
        ) {
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

- [ ] **Step 3: Select the Credit or legacy path once**

Replace the current unconditional legacy windows array after payload status validation with:

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
        ].filter(
          (window): window is LiveUsageWindow => window !== undefined,
        );

Keep the existing windows.length === 0 malformed-response return and leave the plan-status request below it unchanged.

- [ ] **Step 4: Run the provider tests and typecheck**

Run:

    mise exec node@24.15.0 -- pnpm exec vitest run tests/provider-stepfun.test.ts
    mise exec node@24.15.0 -- pnpm typecheck

Expected: all StepFun tests pass, including 60% weighted bucket usage, 20% subscription fallback, 60% top-up fallback, strict classification, malformed handling, and retained browser-session behavior. TypeScript reports no diagnostics.

- [ ] **Step 5: Run lint on the changed implementation files**

Run:

    mise exec node@24.15.0 -- pnpm exec biome lint src/providers/stepfun.ts tests/provider-stepfun.test.ts

Expected: no warnings, errors, or requested fixes.

- [ ] **Step 6: Commit the implementation**

Run:

    git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
    git commit -m "feat: track StepFun Step Plan Credits"

Expected: the commit contains only the provider and provider-test changes.

### Task 3: Verify the complete Phase 3 result

**Files:**

- Verify: src/providers/stepfun.ts
- Verify: tests/provider-stepfun.test.ts

- [ ] **Step 1: Run the complete quality gate under the supported runtime**

Run:

    mise exec node@24.15.0 -- pnpm check

Expected: Biome lint, TypeScript, and all 22 test files pass.

- [ ] **Step 2: Check the final diff and worktree**

Run:

    git diff --check
    git status --short
    git log -1 --oneline

Expected: no whitespace errors, no uncommitted implementation files, and the latest commit is feat: track StepFun Step Plan Credits.

Stop here. StepFun browser-session users now receive one valid Credits bar or the preserved legacy windows; Phase 4 can change Insights UI behavior independently.
