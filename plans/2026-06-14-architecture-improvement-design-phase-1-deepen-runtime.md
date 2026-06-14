# Phase 1 — Deepen Provider Fetch Runtime

## Goal

Absorb duplicated HTTP/parsing boilerplate from 6 providers into `src/providers/runtime.ts`, giving callers more leverage per import. After this phase, no provider file contains inline AbortController/timeout/signal wiring or inline `res.json().catch(() => undefined)` patterns.

## Verification Command

```bash
pnpm check   # biome lint . && tsc --noEmit && vitest run
```

Run after every commit. All 11 existing test files (109 tests) must continue to pass without modification.

---

## Task 1 — Add `fetchWithTimeout` to runtime.ts

### What

Add a utility that encapsulates the 5-line timeout/signal pattern duplicated in every provider.

### Test first

**File:** `tests/runtime-utilities.test.ts`

```typescript
import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  clampPercent,
  clampPercentRounded,
  fetchWithTimeout,
  readJsonObject,
} from "../src/providers/runtime.ts";

describe("fetchWithTimeout", () => {
  it("returns response on success within timeout", async () => {
    const deps = createDefaultDeps();
    deps.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout(deps, "https://example.com/api", {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("aborts after timeout expires", async () => {
    const deps = createDefaultDeps();
    deps.fetch = vi.fn(async (_url, init) => {
      await new Promise((_, reject) => {
        (init?.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
      return new Response();
    });
    await expect(
      fetchWithTimeout(deps, "https://example.com/slow", {}, 10),
    ).rejects.toThrow();
  });

  it("respects external signal", async () => {
    const deps = createDefaultDeps();
    const external = AbortSignal.abort();
    deps.fetch = vi.fn(async () => new Response());
    await expect(
      fetchWithTimeout(deps, "https://example.com", { signal: external }),
    ).rejects.toThrow();
  });

  it("cleans up timer on success", async () => {
    const deps = createDefaultDeps();
    const clearSpy = vi.spyOn(deps, "clearTimeout");
    deps.fetch = vi.fn(async () => new Response("ok"));
    await fetchWithTimeout(deps, "https://example.com", {});
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
```

### Implementation

**File:** `src/providers/runtime.ts` — add after `parseDurationMs` (line ~153):

```typescript
/**
 * Fetch with a per-request timeout, combining an optional external signal.
 * Replaces the 5-line AbortController/timer/combinedSignal pattern in every provider.
 */
export async function fetchWithTimeout(
  deps: UsageDeps,
  url: string,
  options: RequestInit & { signal?: AbortSignal },
  timeoutMs = 5_000,
): Promise<Response> {
  const timeout = new AbortController();
  const timer = deps.setTimeout(() => timeout.abort(), timeoutMs);
  const combinedSignal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
  try {
    return await deps.fetch(url, { ...options, signal: combinedSignal });
  } finally {
    deps.clearTimeout(timer);
  }
}
```

### Commit

```
feat(runtime): add fetchWithTimeout utility

Encapsulates the AbortController + timer + signal combination pattern
used in all 6 providers into a single reusable function.
```

---

## Task 2 — Add `readJsonObject` to runtime.ts

### What

Replaces the `await res.json().catch(() => undefined)` + typeof-object check pattern.

### Test (append to `tests/runtime-utilities.test.ts`)

```typescript
describe("readJsonObject", () => {
  it("returns parsed object on valid JSON", async () => {
    const res = new Response(JSON.stringify({ foo: 1 }));
    expect(await readJsonObject(res)).toEqual({ foo: 1 });
  });

  it("returns undefined on invalid JSON", async () => {
    const res = new Response("not json");
    expect(await readJsonObject(res)).toBeUndefined();
  });

  it("returns undefined on array JSON", async () => {
    const res = new Response(JSON.stringify([1, 2]));
    expect(await readJsonObject(res)).toBeUndefined();
  });

  it("returns undefined on null JSON", async () => {
    const res = new Response("null");
    expect(await readJsonObject(res)).toBeUndefined();
  });
});
```

### Implementation

**File:** `src/providers/runtime.ts` — add after `fetchWithTimeout`:

```typescript
/**
 * Safely parse a Response body as a JSON object.
 * Returns undefined if parsing fails or the result is not a plain object.
 */
export async function readJsonObject(
  res: Response,
): Promise<Record<string, unknown> | undefined> {
  const data = await res.json().catch(() => undefined);
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}
```

### Commit

```
feat(runtime): add readJsonObject utility

Replaces the inline JSON parsing + type-check pattern used across providers.
```

---

## Task 3 — Add `clampPercent` and `clampPercentRounded` to runtime.ts

### What

Two clamping utilities for different use cases:

- `clampPercent` — clamp to [0, 100] without rounding. Used by opencode-go where fractional percentages are preserved (e.g. `12.4`).
- `clampPercentRounded` — clamp to [0, 100] and round. Used by minimax and stepfun where integer percentages are expected.

### Test (append to `tests/runtime-utilities.test.ts`)

```typescript
describe("clampPercent", () => {
  it("clamps below 0 to 0", () => {
    expect(clampPercent(-5)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(clampPercent(150)).toBe(100);
  });

  it("preserves fractional values", () => {
    expect(clampPercent(42.7)).toBe(42.7);
    expect(clampPercent(12.4)).toBe(12.4);
  });

  it("passes through valid values unchanged", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(100)).toBe(100);
  });
});

describe("clampPercentRounded", () => {
  it("clamps and rounds below 0 to 0", () => {
    expect(clampPercentRounded(-5)).toBe(0);
  });

  it("clamps and rounds above 100 to 100", () => {
    expect(clampPercentRounded(150)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(clampPercentRounded(42.7)).toBe(43);
    expect(clampPercentRounded(42.3)).toBe(42);
  });

  it("passes through integers unchanged", () => {
    expect(clampPercentRounded(0)).toBe(0);
    expect(clampPercentRounded(50)).toBe(50);
    expect(clampPercentRounded(100)).toBe(100);
  });
});
```

### Implementation

**File:** `src/providers/runtime.ts`:

```typescript
/** Clamp a percentage to [0, 100]. Preserves fractional values. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Clamp a percentage to [0, 100] and round to the nearest integer. */
export function clampPercentRounded(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
```

### Why two functions

`opencode-go.ts` uses `clampPct` without rounding — its dashboard scraper returns values like `12.4` that tests assert on. The local estimate path uses `Math.floor(clampPct(...))` deliberately for floor behavior. Conflating these into a single rounded function would break existing tests and change behavior.

`minimax.ts` and `stepfun.ts` both round because they compute percentages from ratios and want integer display values.

### Commit

```
feat(runtime): add clampPercent and clampPercentRounded utilities

clampPercent preserves fractional values (opencode-go dashboard path).
clampPercentRounded provides clamp+round for minimax and stepfun.
```

---

## Task 4 — Migrate openai-codex.ts

### What

Replace the inline timeout pattern with `fetchWithTimeout`. Replace the inline JSON parse with `readJsonObject`.

### Changes

**File:** `src/providers/openai-codex.ts`

1. Add imports:

```typescript
import {
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  readJsonSafe,
  retryAfterMs,
} from "./runtime.ts";
```

2. In `createOpenAICodexProvider`, inside `fetchLive` (lines 182-199), replace:

```typescript
// REMOVE these lines:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
const res = await deps
  .fetch("https://chatgpt.com/backend-api/wham/usage", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
    },
    signal: combinedSignal,
  })
  .finally(() => deps.clearTimeout(timer));
```

With:

```typescript
const res = await fetchWithTimeout(
  deps,
  "https://chatgpt.com/backend-api/wham/usage",
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
    },
    signal,
  },
);
```

Note: The current code uses `.finally()` chaining (not try/catch). If `deps.fetch` throws (network error), the exception propagates up to the `fetchWithLiveRuntime` outer catch which produces `{ kind: "error", message: "Live source unavailable." }`. After this refactor, `fetchWithTimeout` similarly lets exceptions propagate. Behavior is unchanged.

3. Replace JSON parsing:

```typescript
// REMOVE:
const data = (await res.json().catch(() => undefined)) as
  | Record<string, unknown>
  | undefined;
if (!data) { ... }
```

With:

```typescript
const data = await readJsonObject(res);
if (!data) { ... }
```

### Verification

```bash
pnpm check
```

All 11 `provider-openai-codex.test.ts` tests must pass unchanged.

### Commit

```
refactor(openai-codex): use fetchWithTimeout and readJsonObject

Removes inline timeout/signal wiring and JSON parsing boilerplate.
Net -10 lines.
```

---

## Task 5 — Migrate openrouter.ts

### What

Replace timeout patterns in both `fetchCredits` and `fetchKey` helpers.

### Changes

**File:** `src/providers/openrouter.ts`

1. Add imports:

```typescript
import {
  fetchWithLiveRuntime,
  fetchWithTimeout,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. In `fetchCredits` (lines 47-67), replace:

```typescript
// REMOVE:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;

let response: Response;
try {
  response = await deps.fetch(`${baseUrl}/api/v1/credits`, {
    method: "GET",
    headers,
    signal: combinedSignal,
  });
} catch {
  deps.clearTimeout(timer);
  return { kind: "error", message: "OpenRouter credits endpoint unavailable." };
}
deps.clearTimeout(timer);
```

With:

```typescript
let response: Response;
try {
  response = await fetchWithTimeout(deps, `${baseUrl}/api/v1/credits`, {
    method: "GET",
    headers,
    signal,
  });
} catch {
  return { kind: "error", message: "OpenRouter credits endpoint unavailable." };
}
```

3. Same transformation in `fetchKey` (lines 122-139).

4. Replace JSON parsing in both functions:

```typescript
// REMOVE:
const json = await response.json().catch(() => undefined);
if (!json || typeof json !== "object") { ... }
```

With:

```typescript
const json = await readJsonObject(response);
if (!json) { ... }
```

### Verification

```bash
pnpm check
```

All 15 `provider-openrouter.test.ts` tests must pass unchanged.

### Commit

```
refactor(openrouter): use fetchWithTimeout and readJsonObject

Removes timeout/signal boilerplate from fetchCredits and fetchKey helpers.
Net -20 lines.
```

---

## Task 6 — Migrate minimax.ts

### What

Replace timeout pattern, JSON parsing, and local `clampPercent` definition with `clampPercentRounded`.

### Changes

**File:** `src/providers/minimax.ts`

1. Update imports:

```typescript
import {
  clampPercentRounded,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. Delete local `clampPercent` function (lines 34-36).

3. Replace all `clampPercent(...)` calls with `clampPercentRounded(...)`.

4. In `createMiniMaxProvider` fetchLive, replace the `request` helper (lines 365-383) with `fetchWithTimeout`:

```typescript
// REMOVE the local request() helper with its timeout wiring:
const request = async (baseHost: string) => {
  const timeout = new AbortController();
  const timer = deps.setTimeout(() => timeout.abort(), 5_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;
  return deps
    .fetch(`${baseHost}${endpoint}`, {
      method: "GET",
      headers: { ... },
      signal: combinedSignal,
    })
    .finally(() => deps.clearTimeout(timer));
};
```

With:

```typescript
const request = async (baseHost: string) =>
  fetchWithTimeout(deps, `${baseHost}${endpoint}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "MM-API-Source": "pi-coding-agent",
    },
    signal,
  });
```

5. Replace JSON parsing:

```typescript
// REMOVE:
const data = (await res.json().catch(() => undefined)) as
  | Record<string, unknown>
  | undefined;
```

With:

```typescript
const data = await readJsonObject(res);
```

### Verification

```bash
pnpm check
```

All 11 `provider-minimax.test.ts` tests must pass unchanged.

### Commit

```
refactor(minimax): use runtime utilities

Removes local clampPercent, timeout wiring, and JSON parsing boilerplate.
Net -15 lines.
```

---

## Task 7 — Migrate stepfun.ts

### What

Replace timeout pattern, local `clampPercent`, and local `readJsonObject` with shared versions.

### Changes

**File:** `src/providers/stepfun.ts`

1. Update imports:

```typescript
import {
  clampPercentRounded,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. Delete local `clampPercent` (lines 70-72).

3. Replace all `clampPercent(...)` calls with `clampPercentRounded(...)`.

4. Delete local `readJsonObject` (lines 91-98) — it's now imported from runtime.

   Note: stepfun's local `readJsonObject` does not include the `!Array.isArray(data)` check that the shared version does. Its callers always expect objects from the StepFun API, so the stricter shared version is a safe upgrade.

5. Remove the outer timeout from `createStepFunProvider`'s `fetchLive`:

```typescript
// REMOVE:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
// ... and the finally block:
} finally {
  deps.clearTimeout(timer);
}
```

6. In `loginStepFun`, wrap each `deps.fetch(...)` call with `fetchWithTimeout(deps, ...)`:

```typescript
// BEFORE (3 occurrences):
await deps.fetch(url, { ..., signal })

// AFTER:
await fetchWithTimeout(deps, url, { ..., signal })
```

7. In `fetchStepFunUsage`, same transformation for each `deps.fetch(...)` call (2 occurrences).

8. Pass `signal` (not `combinedSignal`) to `loginStepFun` and `fetchStepFunUsage`.

### Timeout semantics change

The outer timeout previously gave a 5s budget for the ENTIRE flow (login + usage fetch = up to 5 sequential network calls). After this refactor, each network call gets its own 5s budget. This is intentionally more generous — it prevents any single slow call from hanging while allowing multi-step flows to complete. Total worst-case time increases from 5s to ~25s (5 calls × 5s each), but in practice all calls are fast or the first slow one triggers a timeout.

### Verification

```bash
pnpm check
```

All 6 `provider-stepfun.test.ts` tests must pass unchanged.

### Commit

```
refactor(stepfun): use runtime utilities

Removes local clampPercent, readJsonObject, and timeout boilerplate.
Each network call now has its own 5s timeout instead of a shared outer timeout.
Net -18 lines.
```

---

## Task 8 — Migrate command-code.ts

### What

Replace the shared timeout across 3 parallel fetches with per-fetch timeouts. Replace JSON parsing with `readJsonObject`.

### Changes

**File:** `src/providers/command-code.ts`

1. Add imports:

```typescript
import {
  fetchWithLiveRuntime,
  fetchWithTimeout,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. Remove the outer timeout wiring:

```typescript
// REMOVE:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
```

3. Replace the `request` helper:

```typescript
// REMOVE:
const request = async (url: string, label: string) => {
  try {
    return await deps.fetch(url, { headers, signal: combinedSignal });
  } catch {
    diagnostics.push(`${label} endpoint unavailable.`);
    return undefined;
  }
};
```

With:

```typescript
const request = async (url: string, label: string) => {
  try {
    return await fetchWithTimeout(deps, url, { headers, signal });
  } catch {
    diagnostics.push(`${label} endpoint unavailable.`);
    return undefined;
  }
};
```

4. Remove the `.finally(() => deps.clearTimeout(timer))` from the `Promise.all`.

5. Replace `readJson` helper's JSON parsing:

```typescript
// In readJson, replace:
const json = await res.json().catch(() => undefined);
if (!json || typeof json !== "object") { ... }

// With:
const json = await readJsonObject(res);
if (!json) { ... }
```

### Timeout semantics change

Previously all 3 parallel fetches shared a single 5s timeout. After: each gets its own 5s budget. Since they run in parallel via `Promise.all`, the effective total wait is still ~5s (the slowest of the three), so practical behavior is unchanged.

### Verification

```bash
pnpm check
```

All 5 `provider-command-code.test.ts` tests must pass unchanged.

### Commit

```
refactor(command-code): use fetchWithTimeout and readJsonObject

Each parallel endpoint now has its own 5s timeout instead of sharing one.
Net -10 lines.
```

---

## Task 9 — Migrate opencode-go.ts

### What

Replace local `clampPct` with imported `clampPercent`. Replace local `toNumber` with imported `toFinite`. Replace local `parseTs` with imported `parseEpochMs`. Replace timeout pattern in `fetchDashboard` with `fetchWithTimeout`.

### Changes

**File:** `src/providers/opencode-go.ts`

1. Update imports:

```typescript
import {
  clampPercent,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  toFinite,
} from "./runtime.ts";
```

2. Delete local `clampPct` (lines 29-31).

3. Delete local `toNumber` (lines 14-21) — `toFinite` from runtime.ts is identical.

4. Delete local `parseTs` (lines 23-27) — `parseEpochMs` from runtime.ts is identical.

5. Replace all `clampPct(...)` calls with `clampPercent(...)`.

6. Replace all `toNumber(...)` calls with `toFinite(...)`.

7. Replace all `parseTs(...)` calls with `parseEpochMs(...)`.

8. In `fetchDashboard`, the redirect-following loop creates a new timeout per iteration. Replace with `fetchWithTimeout`:

```typescript
// REMOVE per-iteration:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combined = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
let res: Response;
try {
  res = await deps.fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      Cookie: cookieHeader,
      "User-Agent": "...",
    },
    signal: combined,
  });
} catch {
  deps.clearTimeout(timer);
  return { diagnostic: "OpenCode Go dashboard network unavailable." };
}
deps.clearTimeout(timer);
```

With:

```typescript
let res: Response;
try {
  res = await fetchWithTimeout(deps, url, {
    method: "GET",
    redirect: "manual",
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137 Safari/537.36",
    },
    signal,
  });
} catch {
  return { diagnostic: "OpenCode Go dashboard network unavailable." };
}
```

### Behavioral preservation notes

- `clampPercent` (no rounding) preserves fractional values like `12.4` from dashboard regex extraction. The test at `provider-opencode-go.test.ts:140` asserts `[12.4, 50, 75]`.
- `Math.floor(clampPercent((used / limit) * 100))` in the `mk` helper (line 499) preserves the existing floor-then-clamp behavior since `clampPercent` doesn't round.

### Verification

```bash
pnpm check
```

All 9 `provider-opencode-go.test.ts` tests must pass unchanged.

### Commit

```
refactor(opencode-go): use runtime utilities

Replaces local clampPct, toNumber, parseTs, and timeout wiring with
shared imports from runtime.ts.
Net -12 lines.
```

---

## Task 10 — Final verification and cleanup

### What

Run full check suite. Verify exit criteria are met.

### Exit Criteria Checklist

- [ ] No provider file contains `new AbortController()` (grep verification)
- [ ] No provider file contains `AbortSignal.any` (grep verification)
- [ ] No provider file contains `.json().catch(() => undefined)` (grep verification)
- [ ] `opencode-go.ts` has no local `toNumber`, `parseTs`, or `clampPct`
- [ ] `minimax.ts` and `stepfun.ts` have no local `clampPercent`
- [ ] `stepfun.ts` has no local `readJsonObject`
- [ ] All 11 test files pass (`pnpm test`)
- [ ] TypeScript compiles (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] New `tests/runtime-utilities.test.ts` passes

### Verification Commands

```bash
pnpm check

# Grep verification (should return 0 matches in providers/ excluding runtime.ts):
grep -r "new AbortController" src/providers/ --include="*.ts" | grep -v runtime.ts
grep -r "AbortSignal.any" src/providers/ --include="*.ts" | grep -v runtime.ts
grep -r "\.json()\.catch" src/providers/ --include="*.ts" | grep -v runtime.ts

# Verify no local function definitions remain (should return 0 matches):
grep -n "^function clampPct\|^function toNumber\|^function parseTs" src/providers/opencode-go.ts
grep -n "^function clampPercent" src/providers/minimax.ts src/providers/stepfun.ts
grep -n "^async function readJsonObject" src/providers/stepfun.ts
```

### Final Commit

```
chore: verify Phase 1 exit criteria

All providers use shared runtime utilities. No inline timeout/signal/JSON
boilerplate remains in provider files.
```

---

## Summary

| Task | File            | Net Lines | Risk |
| ---- | --------------- | --------- | ---- |
| 1    | runtime.ts      | +15       | None |
| 2    | runtime.ts      | +10       | None |
| 3    | runtime.ts      | +8        | None |
| 4    | openai-codex.ts | -10       | Low  |
| 5    | openrouter.ts   | -20       | Low  |
| 6    | minimax.ts      | -15       | Low  |
| 7    | stepfun.ts      | -18       | Low  |
| 8    | command-code.ts | -10       | Low  |
| 9    | opencode-go.ts  | -12       | Low  |
| 10   | Verification    | 0         | None |

**Total net change:** ~-52 lines removed from providers, +33 lines added to runtime.ts and tests.
**New test file:** `tests/runtime-utilities.test.ts` (~90 lines)
