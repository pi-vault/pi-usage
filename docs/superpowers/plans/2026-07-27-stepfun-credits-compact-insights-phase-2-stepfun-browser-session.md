# StepFun Browser Session Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Replace StepFun `.com` username/password login with `platform.stepfun.ai` browser-session authentication while preserving legacy 5-hour and weekly usage windows.

**Architecture:** Keep the change inside the existing StepFun provider and provider test. The provider resolves one local browser-session type containing a normalized token and raw Web ID, then sends that session to the existing dashboard RPCs. Credit payloads remain Phase 3; no Pi-side abstraction is needed because the Pi 0.82.0 reference repository has no StepFun dashboard implementation.

**Tech Stack:** TypeScript 6, Vitest 4, Pi 0.82.0, existing provider runtime helpers.

---

**Phase dependency:** Phase 1 is committed and the current repository passes `pnpm check`.

**Usable result:** Users with a `platform.stepfun.ai` browser session can retrieve legacy 5-hour/weekly usage and plan names. Passwords are neither accepted nor stored.

**Out of scope:** Step Plan Credit payloads, standard API balance, `.com` fallback, Insights UI, documentation, new dependencies, and Pi package changes.

**Credential contract:**

- `STEPFUN_TOKEN` accepts a bare token or cookie-style text containing `Oasis-Token=<value>`.
- `STEPFUN_WEB_ID` is the raw `Oasis-WebId` cookie value.
- Every dashboard request sends `Oasis-Token=<token>; Oasis-WebId=<web-id>`.
- Every dashboard request sends `oasis-webid: <web-id>`.
- Missing or partial sessions make no network request.

### Task 1: Specify the browser-session contract with failing tests

**Files:**

- Modify: `tests/provider-stepfun.test.ts`

- [x] **Step 1: Remove obsolete authentication tests**

Delete the tests covering token precedence over username/password, username/password login, and invalid username/password. Keep the plan-status failure, invalid-session, 429, and legacy-window coverage as the behavior that must survive the migration.

- [x] **Step 2: Add the complete missing-session table test**

Add this test inside `describe("StepFun provider", ...)`:

```ts
it("requires a complete StepFun browser session", async () => {
  for (const env of [
    {},
    { STEPFUN_TOKEN: "token" },
    { STEPFUN_WEB_ID: "web-id" },
    { STEPFUN_USERNAME: "user@example.com", STEPFUN_PASSWORD: "secret" },
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

- [x] **Step 3: Add the exact `.ai` request test**

Add this complete test:

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
  expect(
    calls.every((url) => url.startsWith("https://platform.stepfun.ai")),
  ).toBe(true);
  rmSync(root, { recursive: true, force: true });
});
```

- [x] **Step 4: Update retained test environments**

Add `STEPFUN_WEB_ID: "web-id"` to every retained test environment that supplies `STEPFUN_TOKEN`. Update the invalid-session diagnostic to:

```ts
expect(result.snapshot.diagnostic).toBe(
  "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
);
```

Replace the invalid-session test with this table-driven form:

```ts
for (const status of [401, 403]) {
  const root = mkTmp();
  const provider = stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response("denied", { status });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "bad-token", STEPFUN_WEB_ID: "web-id" },
    ),
  );

  const result = await provider.fetch();
  expect(result.snapshot.diagnostic).toBe(
    "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
  );
  rmSync(root, { recursive: true, force: true });
}
```

- [x] **Step 5: Run the provider tests and confirm the contract fails**

Run:

```sh
pnpm test tests/provider-stepfun.test.ts
```

Expected: FAIL because the provider still accepts password credentials, does not require `STEPFUN_WEB_ID`, uses `.com`, and sends a hard-coded Web ID. This command runs only the provider test file; `pnpm test -- tests/provider-stepfun.test.ts` incorrectly runs the full suite in this repository.

### Task 2: Implement the minimum browser-session provider

**Files:**

- Modify: `src/providers/stepfun.ts`

- [x] **Step 1: Replace host and authentication declarations**

Set the provider constants and local session type:

```ts
const STEPFUN_BASE_URL = "https://platform.stepfun.ai";
const STEPFUN_APP_ID = "10300";

interface StepFunBrowserSession {
  token: string;
  webId: string;
}
```

Delete `STEPFUN_WEB_ID`, `INVALID_STEPFUN_CREDENTIALS`, `StepFunCredentialError`, `tokenFromPayload`, `isStepFunCredentialError`, and `loginStepFun`.

- [x] **Step 2: Resolve only the browser-session variables**

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

- [x] **Step 3: Build request headers from the session Web ID**

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

- [x] **Step 4: Send the same session to both dashboard RPCs**

Change `fetchStepFunUsage` to accept `session: StepFunBrowserSession` and build one shared header object:

```ts
const headers = {
  ...baseHeaders(session.webId),
  Cookie: `Oasis-Token=${session.token}; Oasis-WebId=${session.webId}`,
};
```

Pass this object to both `QueryStepPlanRateLimit` and `GetStepPlanStatus`.

- [x] **Step 5: Remove login and retry orchestration**

At the start of `fetchLive`, resolve the session and return the missing-session result before any fetch:

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

Delete username/password login, ingress-cookie acquisition, registration, password retry, and credential-exception branches. Map every `usage.kind === "credentials"` result to:

```ts
return {
  kind: "credentials" as const,
  message:
    "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
};
```

Leave the existing rate-limit, error, plan-name, cache, and snapshot behavior unchanged.

- [x] **Step 6: Run focused implementation checks**

Run:

```sh
pnpm test tests/provider-stepfun.test.ts
pnpm typecheck
```

Expected: PASS. Legacy windows render, plan-status failure remains non-fatal, both 401 and 403 produce the browser-session diagnostic, and 429 preserves backoff.

- [x] **Step 7: Commit the atomic migration**

Run:

```sh
git add src/providers/stepfun.ts tests/provider-stepfun.test.ts
git commit -m "fix: migrate StepFun usage to browser sessions"
```

### Task 3: Verify the repository and live session boundary

**Files:**

- Verify: `src/providers/stepfun.ts`
- Verify: `tests/provider-stepfun.test.ts`

- [x] **Step 1: Run the full repository check**

Run:

```sh
pnpm check
```

Expected: Biome lint, TypeScript checking, and the complete Vitest suite pass.

- [x] **Step 2: Inspect the migration diff**

Run:

```sh
git grep -n -E 'STEPFUN_USERNAME|STEPFUN_PASSWORD' -- src || true
git grep -n 'platform\.stepfun\.com' -- src tests || true
git diff --check
git status --short
```

Expected: no legacy runtime credentials in `src`, no `.com` host under `src` or `tests`, no whitespace errors, and a clean worktree after the commit. The test file may retain legacy variable names only to prove password-only input is rejected.

- [ ] **Step 3: Perform one transient live-session smoke test**

Using a disposable browser session, set `STEPFUN_TOKEN` and `STEPFUN_WEB_ID` only in the process environment and run the provider through the normal extension path. Confirm that it reports `live`, reaches `.ai`, returns the legacy windows, and tolerates a failed plan-status request. Do not print, log, or commit either credential.

If no disposable session is available, record live verification as unverified; do not claim production readiness from mocks alone.

**Stop here.** Phase 3 adds Credit-plan payload normalization without changing this authentication boundary.
