# Phase 2: StepFun Browser Session Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Replace the legacy StepFun `.com` username/password login with `platform.stepfun.ai` browser-session authentication while preserving legacy 5-hour and weekly usage windows.

**Architecture:** `src/providers/stepfun.ts` will resolve one credential shape—`STEPFUN_TOKEN` plus `STEPFUN_WEB_ID`—and send it to the existing StepFun dashboard RPC paths on the `.ai` host. Credit parsing remains out of scope until Phase 3, so this phase leaves the existing legacy window normalization intact.

**Tech Stack:** TypeScript 6, Vitest 4, Pi 0.82.0, existing provider runtime helpers.

**Phase dependency:** Phase 1 is committed and `pnpm check` passes.

**Usable result:** Users with a `platform.stepfun.ai` browser session can retrieve legacy 5-hour/weekly StepFun usage and plan names. Passwords are no longer accepted or stored.

**Out of scope:** Step Plan Credit payloads, standard API balance, `.com` fallback, Insights UI, documentation, and new dependencies.

**Credential contract:**

- `STEPFUN_TOKEN` may be a bare token or cookie-style text containing `Oasis-Token=<value>`.
- `STEPFUN_WEB_ID` is the raw `Oasis-WebId` cookie value.
- The exact request cookie is `Oasis-Token=<token>; Oasis-WebId=<web-id>`.
- The request header is `oasis-webid: <web-id>`.

---

### Task 1: Specify the browser-session behavior with failing tests

**Files:**
- Modify: `tests/provider-stepfun.test.ts`

- [ ] **Step 1: Remove obsolete password-login coverage**

Delete the tests that:

- prefer `STEPFUN_TOKEN` over username/password,
- log in with username/password,
- diagnose invalid username/password.

Retain the plan-status failure, invalid-session, 429, and legacy-window coverage.

- [ ] **Step 2: Add the missing-variable test**

Add inside `describe("StepFun provider", ...)`:

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
```

- [ ] **Step 3: Add the `.ai` endpoint and cookie test**

```ts
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
  expect(result.snapshot.windows).toEqual([
    expect.objectContaining({ key: "fiveHour", usedPercent: 20 }),
    expect.objectContaining({ key: "weekly", usedPercent: 50 }),
  ]);
  expect(calls).toHaveLength(2);
  expect(calls.every((url) => url.startsWith("https://platform.stepfun.ai"))).toBe(
    true,
  );
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 4: Update retained test credentials and diagnostics**

Add `STEPFUN_WEB_ID: "web-id"` to every retained StepFun test environment. Change the invalid-token assertion to:

```ts
expect(result.snapshot.diagnostic).toBe(
  "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
);
```

- [ ] **Step 5: Run the tests and verify the new contract fails**

```sh
pnpm test -- tests/provider-stepfun.test.ts
```

Expected: FAIL because the provider still accepts password auth, does not require `STEPFUN_WEB_ID`, uses `.com`, and sends a hard-coded Web ID.

---

### Task 2: Implement the minimum browser-session provider

**Files:**
- Modify: `src/providers/stepfun.ts`

- [ ] **Step 1: Replace static host and authentication declarations**

Set:

```ts
const STEPFUN_BASE_URL = "https://platform.stepfun.ai";
const STEPFUN_APP_ID = "10300";

interface StepFunBrowserSession {
  token: string;
  webId: string;
}
```

Delete `STEPFUN_WEB_ID`, `INVALID_STEPFUN_CREDENTIALS`, `StepFunCredentialError`, `tokenFromPayload`, `isStepFunCredentialError`, and `loginStepFun`.

- [ ] **Step 2: Resolve only the two browser-session variables**

Keep `cleanEnvValue` and `normalizeStepFunToken`. Replace `resolveStepFunAuth` with:

```ts
function resolveStepFunSession(
  env: NodeJS.ProcessEnv,
): StepFunBrowserSession | undefined {
  const token = normalizeStepFunToken(env.STEPFUN_TOKEN);
  const webId = cleanEnvValue(env.STEPFUN_WEB_ID);
  return token && webId ? { token, webId } : undefined;
}
```

- [ ] **Step 3: Build headers from the configured Web ID**

Replace `baseHeaders` with:

```ts
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

- [ ] **Step 4: Pass the complete session to both dashboard RPCs**

Change `fetchStepFunUsage` to accept `session: StepFunBrowserSession` and construct:

```ts
const headers = {
  ...baseHeaders(session.webId),
  Cookie: `Oasis-Token=${session.token}; Oasis-WebId=${session.webId}`,
};
```

Use this same `headers` object for `QueryStepPlanRateLimit` and `GetStepPlanStatus`.

- [ ] **Step 5: Delete login and retry orchestration**

At the start of `fetchLive`, resolve the session:

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

Delete username/password login, ingress-cookie acquisition, registration, password retry, and credential-exception branches.

Map a `credentials` result to:

```ts
return {
  kind: "credentials" as const,
  message:
    "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
};
```

Keep the existing rate-limit, error, plan-name, cache, and snapshot behavior.

- [ ] **Step 6: Run focused checks**

```sh
pnpm test -- tests/provider-stepfun.test.ts
pnpm typecheck
```

Expected: PASS. Legacy 5-hour/weekly payloads still render, plan-status failure remains non-fatal, 401/403 produces the browser-session diagnostic, and 429 preserves backoff.

- [ ] **Step 7: Commit the atomic migration**

```sh
git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
git commit -m "fix: migrate StepFun usage to browser sessions"
```

---

### Phase verification

- [ ] Run:

```sh
pnpm check
```

Expected: PASS.

- [ ] Inspect the diff for removed password handling and absence of `.com`:

```sh
git grep -n 'STEPFUN_USERNAME\|STEPFUN_PASSWORD\|platform.stepfun.com' -- src tests || true
git diff --check
git status --short
```

Expected: no matching legacy credentials or host under `src` or `tests`, no whitespace errors, and no uncommitted Phase 2 files.

**Stop here.** The provider is usable for `.ai` browser sessions returning legacy windows. Phase 3 adds Credit-plan payloads without changing this authentication boundary.