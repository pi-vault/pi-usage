# StepFun Credits and Compact Insights Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track StepFun Step Plan Credits through `platform.stepfun.ai` browser-session credentials and keep the all-time Insights overlay within Pi's visible height by showing one category at a time.

**Architecture:** Keep both changes inside the existing provider and dashboard boundaries. The StepFun adapter will resolve one browser-session credential shape, classify Credit payloads with an explicit predicate, and normalize them into the existing `LiveUsageWindow` type. The dashboard will reuse its current tab renderer for available Insight categories and retain the existing overlay and frame components.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest 4, pnpm, `@earendil-works/pi-coding-agent` 0.82.0, and `@earendil-works/pi-tui` 0.82.0.

**Execution prerequisite:** Do not execute this plan until `docs/superpowers/specs/2026-07-27-stepfun-insights-refactor-design.md` has been written, committed, and approved by the user.

---

## File map

- Modify `package.json` and `pnpm-lock.yaml` to update the Pi packages to 0.82.0.
- Modify `src/providers/stepfun.ts` to own StepFun browser-session resolution, `.ai` RPC requests, Credit-plan classification, and Credit-window normalization.
- Modify `tests/provider-stepfun.test.ts` to cover authentication, endpoint selection, Credit arithmetic, legacy windows, and provider errors.
- Modify `src/tui/dashboard.ts` to own available Insight categories, selected-category navigation, and compact category rendering.
- Modify `src/shared/constants.ts` to update the Insights footer shortcut.
- Modify `tests/dashboard.test.ts` and `tests/constants.test.ts` to cover category behavior and the overlay line budget.
- Modify `README.md`, `CHANGELOG.md`, and `docs/assets/insights.png` to document and show the new behavior.

## Fixed behavioral decisions

- A payload is a Credit plan when `plan_family` parses to `2`, or when `plan_credit_rate_limit` is an object and all four legacy rate/reset fields are absent or numerically zero.
- Absolute bucket totals are used only when every bucket is an object with finite `credit_total > 0` and finite `0 <= credit_residual <= credit_total`. One invalid bucket invalidates the entire bucket set.
- If bucket totals cannot be used, select the first valid fraction from `subscription_credit_left_rate`, then `topup_credit_left_rate`. A valid fraction is finite and within `[0, 1]`. Never add the two fractions.
- `subscription_credit_reset_time` is the only Credit reset shown. Bucket `expire_at` and `next_reset_at` are intentionally ignored because a combined bar can contain buckets with different lifecycle events. A top-up-only fallback has no reset unless the subscription reset field is present.
- The exact browser cookie names are `Oasis-Token` and `Oasis-WebId`. The request header remains lowercase `oasis-webid`, because HTTP header names are case-insensitive.
- The minimum supported dashboard terminal for this change is 40 columns by 24 rows. With `width: "92%"` and `maxHeight: "85%"`, Pi renders the component at 36 columns and clips after 20 rows. The compact Insights view must therefore render at most 20 rows at width 36, at most 17 rows at width 73, and at most 17 rows at width 100.

---

### Task 1: Update Pi dependencies to 0.82.0

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Update both Pi development dependencies**

Run:

```sh
pnpm add -D '@earendil-works/pi-coding-agent@0.82.0' '@earendil-works/pi-tui@0.82.0'
```

Expected: `package.json` contains:

```json
"@earendil-works/pi-coding-agent": "^0.82.0",
"@earendil-works/pi-tui": "^0.82.0"
```

Expected: the importer and package snapshots in `pnpm-lock.yaml` resolve both packages to `0.82.0`.

- [ ] **Step 2: Verify the installed versions**

Run:

```sh
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
```

Expected: both direct dependencies report `0.82.0`.

- [ ] **Step 3: Verify existing code against the upgraded Pi types**

Run:

```sh
pnpm typecheck
```

Expected: PASS with no TypeScript diagnostics. Do not add compatibility shims unless this command exposes a concrete 0.82.0 API change.

- [ ] **Step 4: Commit the dependency update**

```sh
git add package.json pnpm-lock.yaml
git commit -m "chore: update Pi dependencies to 0.82.0"
```

---

### Task 2: Replace legacy StepFun login with `.ai` browser-session authentication

**Files:**

- Modify: `tests/provider-stepfun.test.ts`
- Modify: `src/providers/stepfun.ts`

- [ ] **Step 1: Replace password-login tests with failing browser-session tests**

Remove the tests that prefer token over username/password, log in with username/password, and diagnose invalid username/password. Add these tests inside the existing `describe("StepFun provider", ...)` block:

```ts
it("requires both STEPFUN_TOKEN and STEPFUN_WEB_ID", async () => {
  for (const env of [
    { STEPFUN_TOKEN: "token" },
    { STEPFUN_WEB_ID: "web-id" },
  ]) {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>();
    const result = await stepfunProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, env),
    ).fetch();

    expect(result.snapshot.diagnostic).toBe(
      "Missing StepFun browser session. Set STEPFUN_TOKEN and STEPFUN_WEB_ID.",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  }
});

it("uses the .ai dashboard with the matching browser Web ID", async () => {
  const root = mkTmp();
  const calls: string[] = [];
  const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
    const textUrl = String(url);
    calls.push(textUrl);
    const headers = new Headers(init?.headers);
    expect(headers.get("oasis-webid")).toBe("browser-web-id");
    expect(headers.get("cookie")).toBe(
      "Oasis-Token=test-token; Oasis-WebId=browser-web-id",
    );

    if (textUrl.includes("QueryStepPlanRateLimit")) {
      return new Response(
        JSON.stringify({
          status: 1,
          five_hour_usage_left_rate: 0.8,
          weekly_usage_left_rate: 0.5,
          five_hour_usage_reset_time: "1777528800",
          weekly_usage_reset_time: "1778000000",
        }),
        { status: 200 },
      );
    }
    if (textUrl.includes("GetStepPlanStatus")) {
      return new Response(
        JSON.stringify({ status: 1, subscription: { name: "Plus" } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${textUrl}`);
  });

  const result = await stepfunProvider(
    createLiveDeps(root, () => 1_000, fetchImpl, {
      STEPFUN_TOKEN: "Oasis-Token=test-token; Path=/",
      STEPFUN_WEB_ID: "browser-web-id",
    }),
  ).fetch();

  expect(result.snapshot.status).toBe("live");
  expect(result.snapshot.planName).toBe("Plus");
  expect(calls).toHaveLength(2);
  expect(
    calls.every((url) => url.startsWith("https://platform.stepfun.ai")),
  ).toBe(true);
  rmSync(root, { recursive: true, force: true });
});
```

Update every retained StepFun test environment to include `STEPFUN_WEB_ID: "web-id"`. In the retained invalid-token test, replace the old diagnostic assertion with:

```ts
expect(result.snapshot.diagnostic).toBe(
  "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: FAIL because the provider still accepts password auth, does not require `STEPFUN_WEB_ID`, uses `.com`, and sends the hard-coded Web ID.

- [ ] **Step 3: Replace the legacy auth helpers with the browser-session resolver**

In `src/providers/stepfun.ts`, change the base URL and replace `resolveStepFunAuth`, `baseHeaders`, `StepFunCredentialError`, `tokenFromPayload`, `isStepFunCredentialError`, and `loginStepFun` with this credential boundary:

```ts
const STEPFUN_BASE_URL = "https://platform.stepfun.ai";
const STEPFUN_APP_ID = "10300";

interface StepFunBrowserSession {
  token: string;
  webId: string;
}

function resolveStepFunSession(
  env: NodeJS.ProcessEnv,
): StepFunBrowserSession | undefined {
  const token = normalizeStepFunToken(env.STEPFUN_TOKEN);
  const webId = cleanEnvValue(env.STEPFUN_WEB_ID);
  return token && webId ? { token, webId } : undefined;
}

function baseHeaders(webId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "oasis-appid": STEPFUN_APP_ID,
    "oasis-platform": "web",
    "oasis-webid": webId,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147 Safari/537.36",
  };
}
```

Keep `cleanEnvValue` and `normalizeStepFunToken`; they continue to trim quoted and cookie-style environment values.

Change `fetchStepFunUsage` to accept `session: StepFunBrowserSession` instead of a token and build its headers exactly as follows:

```ts
const headers = {
  ...baseHeaders(session.webId),
  Cookie: `Oasis-Token=${session.token}; Oasis-WebId=${session.webId}`,
};
```

Use the same `headers` object for the usage and plan-status requests.

In `createStepFunProvider`, replace the login and retry branches with one session check and one usage call:

```ts
const session = resolveStepFunSession(deps.env);
if (!session) {
  return {
    kind: "credentials" as const,
    message:
      "Missing StepFun browser session. Set STEPFUN_TOKEN and STEPFUN_WEB_ID.",
  };
}

const usage = await fetchStepFunUsage(deps, session, signal);
```

For a `credentials` result, return:

```ts
return {
  kind: "credentials" as const,
  message:
    "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
};
```

Delete all username/password, ingress-cookie, registration, login, and password retry code.

- [ ] **Step 4: Run the provider tests**

Run:

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: PASS for browser-session auth, `.ai` URLs, legacy windows, plan-name failure, invalid sessions, and 429 backoff.

- [ ] **Step 5: Commit the authentication migration**

```sh
git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
git commit -m "fix: migrate StepFun usage to browser sessions"
```

---

### Task 3: Normalize Step Plan Credit payloads without false exhaustion

**Files:**

- Modify: `tests/provider-stepfun.test.ts`
- Modify: `src/providers/stepfun.ts`

- [ ] **Step 1: Add failing weighted-bucket and fallback tests**

Add these tests to `tests/provider-stepfun.test.ts`:

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

  const snapshot = (await provider.fetch()).snapshot;
  expect(snapshot.windows).toEqual([
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
    expect.objectContaining({ usedPercent: 60 }),
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add failing classification and malformed-payload tests**

Add two more tests:

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
    expect.objectContaining({ key: "credits", usedPercent: 25 }),
  );
  rmSync(root, { recursive: true, force: true });
});

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

  expect((await provider.fetch()).snapshot.diagnostic).toBe(
    "StepFun response malformed.",
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the tests and verify Credit cases fail**

Run:

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: FAIL because `src/providers/stepfun.ts` does not classify or normalize `plan_credit_rate_limit`.

- [ ] **Step 4: Add exact Credit classification and normalization helpers**

Add these helpers above `fetchStepFunUsage` in `src/providers/stepfun.ts`:

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
      const remaining = valid.reduce((sum, bucket) => sum + bucket.residual, 0);
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

Do not parse `expire_at` or `next_reset_at` into `resetAt`.

- [ ] **Step 5: Select Credit or legacy normalization explicitly**

In `fetchStepFunUsage`, replace the unconditional legacy `windows` construction with:

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

Keep the existing `windows.length === 0` malformed-response branch and the non-fatal plan-status request.

- [ ] **Step 6: Run focused and full provider checks**

Run:

```sh
pnpm test -- tests/provider-stepfun.test.ts
pnpm typecheck
```

Expected: both commands PASS. The Credit tests must show 60% used for weighted buckets, 20% used for invalid-bucket fallback, 60% used for top-up-only fallback, and a visible malformed-response diagnostic.

- [ ] **Step 7: Commit Credit support**

```sh
git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
git commit -m "feat: track StepFun Step Plan Credits"
```

---

### Task 4: Replace the fake Insights period selector with category navigation

**Files:**

- Modify: `tests/dashboard.test.ts`
- Modify: `tests/constants.test.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Replace period-selection tests with failing category tests**

Remove the test named `has independent period selector for Insights tab`. Add a local helper near the dashboard tests:

```ts
function switchToInsights(component: UsageDashboardComponent): void {
  component.handleInput("\t");
  component.handleInput("\t");
}
```

Add these tests:

```ts
it("shows only populated Insight categories and defaults to the first", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);

  const out = c.render(100).join("\n");
  expect(out).toContain("[Projects]");
  expect(out).toContain("Cost patterns");
  expect(out).not.toContain("Skills");
  expect(out).not.toContain("MCP servers");
  expect(out).toContain("pi-usage");
  expect(out).not.toContain("Large context");
  expect(out).not.toContain("Today");
  expect(out).not.toContain("This Week");
  expect(out).not.toContain("Last Week");
  expect(out).not.toContain("All Time");
});

it("cycles Insight categories without changing the Statistics period", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });

  c.handleInput("\u001b[D");
  switchToInsights(c);
  c.handleInput("\u001b[C");
  let out = c.render(100).join("\n");
  expect(out).toContain("[Cost patterns]");
  expect(out).toContain("Large context");
  expect(out).not.toContain("pi-usage");

  c.handleInput("\t");
  out = c.render(100).join("\n");
  expect(out).toContain("[Last Week]");
});

it("falls back when the selected Insight category disappears", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);
  c.handleInput("\u001b[C");
  expect(c.render(100).join("\n")).toContain("[Cost patterns]");

  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "100.0%" },
  ];
  expect(c.render(100).join("\n")).toContain("[Projects]");
});
```

- [ ] **Step 2: Add failing line-budget and footer tests**

Add this dashboard test:

```ts
it("keeps a maximum Insight category inside the supported overlay height", () => {
  const state = mkState();
  state.insights = [
    ...Array.from({ length: 6 }, (_, index) => ({
      category: "project",
      label: index === 5 ? "+20 more" : `project-${index + 1}`,
      cost: 6 - index,
      detail: `${30 - index * 4}.0%`,
    })),
    { category: "skill", label: "/brainstorming", cost: 1, detail: "5.0%" },
    { category: "mcp", label: "playwright", cost: 1, detail: "5.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "5.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);

  expect(c.render(36).length).toBeLessThanOrEqual(20);
  expect(c.render(73).length).toBeLessThanOrEqual(17);
  expect(c.render(100).length).toBeLessThanOrEqual(17);
});
```

Change the Insights assertion in `renders context-aware footer per tab` to:

```ts
expect(stripped).toContain("[Left/Right] Category");
```

Change `tests/constants.test.ts` to expect:

```ts
expect(UI_STRINGS.dashboardFooters.insights).toBe(
  "[Tab/Shift-Tab] Switch tab • [Left/Right] Category • [q/Esc] Close",
);
```

- [ ] **Step 3: Run the dashboard tests and verify they fail**

Run:

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
```

Expected: FAIL because Insights still renders period tabs, all categories, and the `Period` footer.

- [ ] **Step 4: Define the fixed category order and selected state**

Add these definitions below `DASHBOARD_TABS` in `src/tui/dashboard.ts`:

```ts
const INSIGHT_CATEGORIES = [
  { id: "project", label: "Projects" },
  { id: "skill", label: "Skills" },
  { id: "mcp", label: "MCP servers" },
  { id: "cost", label: "Cost patterns" },
] as const;

type InsightCategoryId = (typeof INSIGHT_CATEGORIES)[number]["id"];

type AvailableInsightCategory = {
  id: InsightCategoryId;
  label: string;
  items: UsageCoreState["insights"];
};
```

Replace:

```ts
private insightsPeriodIndex = DEFAULT_PERIOD_INDEX;
```

with:

```ts
private insightsCategory: InsightCategoryId = "project";
```

- [ ] **Step 5: Replace grouped all-category rendering with selected-category rendering**

Replace `renderInsightsByCategory` with these complete methods:

```ts
private availableInsightCategories(): AvailableInsightCategory[] {
  return INSIGHT_CATEGORIES.map((category) => ({
    ...category,
    items: this.state.insights.filter(
      (item) => (item.category ?? "cost") === category.id,
    ),
  })).filter((category) => category.items.length > 0);
}

private activeInsightCategory(
  categories: AvailableInsightCategory[],
): AvailableInsightCategory | undefined {
  const selected = categories.find(
    (category) => category.id === this.insightsCategory,
  );
  if (selected) return selected;
  const fallback = categories[0];
  if (fallback) this.insightsCategory = fallback.id;
  return fallback;
}

private renderInsightCategory(category: AvailableInsightCategory): string[] {
  const lines: string[] = [];
  if (category.id === "cost") {
    lines.push(this.theme.dim(category.label));
    for (const item of category.items) {
      lines.push(
        this.theme.dim(
          `  - ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
        ),
      );
    }
    return lines;
  }

  const maxLabelLen = Math.max(
    ...category.items.map((item) => item.label.length),
    category.label.length,
  );
  lines.push(
    `  ${padVisible(this.theme.dim(category.label), maxLabelLen + 2, "left")}  ${this.theme.dim("% of usage")}`,
  );
  for (const item of category.items) {
    const label = padVisible(
      this.theme.dim(item.label),
      maxLabelLen + 2,
      "left",
    );
    lines.push(`  ${label}  ${this.theme.dim(item.detail)}`);
  }
  return lines;
}
```

Replace `renderInsightsTab` with:

```ts
private renderInsightsTab(w: number, lines: string[]): void {
  if (this.state.insights.length === 0) {
    lines.push(this.theme.dim("No insights yet."));
    return;
  }

  const categories = this.availableInsightCategories();
  const active = this.activeInsightCategory(categories);
  if (!active) {
    lines.push(this.theme.dim("No insights yet."));
    return;
  }

  lines.push(
    ...this.renderTabs(
      categories.map((category) => category.label),
      categories.findIndex((category) => category.id === active.id),
      w,
    ),
  );
  lines.push("");
  lines.push(...this.renderInsightCategory(active));
}
```

This intentionally removes the unused Insights period selector and its stale period-filter comment.

- [ ] **Step 6: Replace Insights period input with category input**

Replace `handleInsightsInput` with:

```ts
private handleInsightsInput(data: string): void {
  const delta = matchesKey(data, Key.left)
    ? -1
    : matchesKey(data, Key.right)
      ? 1
      : 0;
  if (!delta) return;

  const categories = this.availableInsightCategories();
  const active = this.activeInsightCategory(categories);
  if (!active) return;
  const index = categories.findIndex(
    (category) => category.id === active.id,
  );
  this.insightsCategory =
    categories[(index + delta + categories.length) % categories.length].id;
}
```

Change the Insights footer in `src/shared/constants.ts` to:

```ts
insights: [
  "[Tab/Shift-Tab] Switch tab",
  "[Left/Right] Category",
  "[q/Esc] Close",
].join(" • "),
```

- [ ] **Step 7: Run the focused dashboard checks**

Run:

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
pnpm typecheck
```

Expected: PASS. At width 36 the rendered frame must be at most 20 lines; at widths 73 and 100 it must be at most 17 lines.

- [ ] **Step 8: Commit the compact Insights UI**

```sh
git add src/tui/dashboard.ts src/shared/constants.ts tests/dashboard.test.ts tests/constants.test.ts
git commit -m "fix: keep Insights within the dashboard height"
```

---

### Task 5: Update user documentation and visual evidence

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/assets/insights.png`

- [ ] **Step 1: Replace the StepFun setup instructions**

Replace the current StepFun provider setup block in `README.md` with:

````markdown
#### StepFun

Pi Usage reads Step Plan Credits from your logged-in StepFun Platform browser session.

1. Sign in at [platform.stepfun.ai](https://platform.stepfun.ai/).
2. Open browser DevTools → **Application** → **Storage** → **Cookies** → `https://platform.stepfun.ai`.
3. Copy the `Oasis-Token` and `Oasis-WebId` cookie values.
4. Export them before starting Pi:

```sh
export STEPFUN_TOKEN='your-oasis-token'
export STEPFUN_WEB_ID='your-oasis-web-id'
```

Both values are secrets. Do not commit or share them. When the browser session expires, copy and export fresh cookie values.
````

- [ ] **Step 2: Update the Insights description and keyboard documentation**

Replace the Insights description with text that states:

```markdown
### Insights

![Insights tab](docs/assets/insights.png)

Shows all-time breakdowns from local Pi session history. Left/Right switches between the available `Projects`, `Skills`, `MCP servers`, and `Cost patterns` categories. Only categories with data appear, and each category keeps its capped list plus overflow summary.
```

Change the Insights keyboard shortcut entry to:

```markdown
- `[Left/Right]` switch category.
```

Remove every README statement that describes an independent Insights period selector.

- [ ] **Step 3: Add an Unreleased changelog entry**

Insert this section above `## [0.6.0]` in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Changed

- Updated `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to 0.82.0.
- Migrated StepFun Step Plan tracking to `platform.stepfun.ai` browser-session credentials and monthly Credit usage.
- Replaced the unsupported Insights period selector with compact all-time category navigation.

### Removed

- StepFun username/password login and legacy `.com` dashboard requests.
```

- [ ] **Step 4: Verify the overlay in Pi at the minimum and normal terminal sizes**

Run the extension in a controlled 40×24 terminal:

```sh
tmux new-session -d -s pi-usage-40 -x 40 -y 24
tmux send-keys -t pi-usage-40 "cd $(pwd) && pi -e ." Enter
sleep 3
tmux send-keys -t pi-usage-40 "/usage" Enter
sleep 2
tmux capture-pane -t pi-usage-40 -p
tmux kill-session -t pi-usage-40
```

Expected: the Insights category tabs, selected category rows, and footer are all present without Pi slicing away the bottom frame.

Repeat at 80×24:

```sh
tmux new-session -d -s pi-usage-80 -x 80 -y 24
tmux send-keys -t pi-usage-80 "cd $(pwd) && pi -e ." Enter
sleep 3
tmux send-keys -t pi-usage-80 "/usage" Enter
sleep 2
tmux capture-pane -t pi-usage-80 -p
tmux kill-session -t pi-usage-80
```

Expected: all available category tabs fit, one category renders, and the footer and bottom border remain visible.

- [ ] **Step 5: Verify StepFun with a real redacted browser session**

Start Pi with `STEPFUN_TOKEN` and `STEPFUN_WEB_ID` set locally, run `/usage:refresh`, and inspect Current Usage.

Expected: StepFun shows one `Credits` bar, the correct plan name when available, absolute used/total Credits when all buckets are valid, and no token or Web ID in diagnostics or captured output.

- [ ] **Step 6: Refresh the Insights screenshot**

At a normal terminal size, open `/usage`, switch to Insights, select a representative populated category, and replace `docs/assets/insights.png` with a screenshot showing the category tabs, selected all-time category, footer, and complete frame. Confirm the screenshot contains no credentials, usernames, private project names, or terminal prompts.

- [ ] **Step 7: Commit documentation and visual evidence**

```sh
git add README.md CHANGELOG.md docs/assets/insights.png
git commit -m "docs: update StepFun and Insights guidance"
```

---

### Task 6: Final verification

**Files:**

- Verify all modified files from Tasks 1–5.

- [ ] **Step 1: Run focused regression tests**

```sh
pnpm test -- tests/provider-stepfun.test.ts tests/dashboard.test.ts tests/constants.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 2: Run the complete project check**

```sh
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and the complete Vitest suite all PASS.

- [ ] **Step 3: Verify the published package contents**

```sh
pnpm pack:dry-run
```

Expected: PASS; package contents include `src`, `docs/assets`, `README.md`, `CHANGELOG.md`, and `LICENSE`, with no environment files or credentials.

- [ ] **Step 4: Review the final diff**

```sh
git status --short
git diff --check
git log -5 --oneline
```

Expected: no whitespace errors, no uncommitted implementation files, and separate commits for the dependency update, StepFun auth, StepFun Credits, compact Insights UI, and documentation.

## Research sources

- [Step Plan overview](https://platform.stepfun.ai/docs/en/step-plan/overview)
- [StepFun account API](https://platform.stepfun.ai/docs/en/api-reference/accounts/get)
- [CodexBar StepFun provider notes](https://github.com/steipete/CodexBar/blob/main/docs/stepfun.md)
- [StepFun `.ai` dashboard integration reference](https://github.com/pi-vault/notBlubbll-Stepfun2Opencode/blob/main/AGENTS.md)
- Pi 0.82.0 overlay clipping behavior: `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/tui.ts`
