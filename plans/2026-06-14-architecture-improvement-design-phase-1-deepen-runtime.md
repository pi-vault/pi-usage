# Phase 1 — Deepen Provider Fetch Runtime

## Goal

Absorb duplicated HTTP/parsing boilerplate from 6 providers into `src/providers/runtime.ts`, giving callers more leverage per import. After this phase, no provider file contains inline AbortController/timeout/signal wiring or inline `res.json().catch(() => undefined)` patterns.

## Verification Command

```bash
pnpm check   # biome lint . && tsc --noEmit && vitest run
```

Run after every commit. All 11 existing test files must continue to pass without modification.

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
  extractCookieValue,
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

## Task 3 — Add `clampPercent` to runtime.ts

### What

Unifies `clampPct` (opencode-go) and `clampPercent` (minimax, stepfun) into a single export.

### Test (append to `tests/runtime-utilities.test.ts`)

```typescript
describe("clampPercent", () => {
  it("clamps below 0 to 0", () => {
    expect(clampPercent(-5)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(clampPercent(150)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(clampPercent(42.7)).toBe(43);
    expect(clampPercent(42.3)).toBe(42);
  });

  it("passes through valid values unchanged", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(100)).toBe(100);
  });
});
```

### Implementation

**File:** `src/providers/runtime.ts`:

```typescript
/** Clamp a percentage to [0, 100] and round to the nearest integer. */
export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
```

### Note on opencode-go

`opencode-go.ts` uses `clampPct` without `Math.round`. Its values are already integers (parsed from regex `([\d.]+)`). After switching to `clampPercent` (with round), behavior is identical for integer inputs. For edge cases like `99.6`, rounding to `100` is correct.

### Commit

```
feat(runtime): add clampPercent utility

Unifies the 3 local clampPct/clampPercent definitions into one shared export.
```

---

## Task 4 — Add `extractCookieValue` to runtime.ts

### What

Extracts named cookie values from a semicolon-delimited cookie header string. Used by opencode-go (`filterCookieHeader`) and stepfun (`normalizeStepFunToken`).

### Test (append to `tests/runtime-utilities.test.ts`)

```typescript
describe("extractCookieValue", () => {
  it("extracts a named cookie value", () => {
    expect(extractCookieValue("auth=abc123; other=x", ["auth"])).toBe("abc123");
  });

  it("returns first matching name", () => {
    expect(
      extractCookieValue("__Host-auth=def; auth=abc", ["auth", "__Host-auth"]),
    ).toBe("abc");
  });

  it("returns undefined when no match", () => {
    expect(extractCookieValue("session=xyz", ["auth"])).toBeUndefined();
  });

  it("handles empty cookie header", () => {
    expect(extractCookieValue("", ["auth"])).toBeUndefined();
  });

  it("handles bare values without =", () => {
    expect(extractCookieValue("baretoken; auth=val", ["auth"])).toBe("val");
  });

  it("trims whitespace", () => {
    expect(extractCookieValue(" auth = spaced ", ["auth"])).toBe("spaced");
  });
});
```

### Implementation

**File:** `src/providers/runtime.ts`:

```typescript
/**
 * Extract the value of the first matching cookie name from a semicolon-delimited header.
 * Returns undefined if no matching name is found.
 */
export function extractCookieValue(
  cookieHeader: string,
  names: string[],
): string | undefined {
  const parts = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const name of names) {
    for (const part of parts) {
      const eqIdx = part.indexOf("=");
      if (eqIdx < 1) continue;
      const key = part.slice(0, eqIdx).trim();
      if (key === name) {
        const value = part.slice(eqIdx + 1).trim();
        if (value) return value;
      }
    }
  }
  return undefined;
}
```

### Commit

```
feat(runtime): add extractCookieValue utility

Shared cookie parsing for providers that authenticate via cookie headers.
```

---

## Task 5 — Migrate openai-codex.ts

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

2. In `createOpenAICodexProvider`, inside `fetchLive` (around lines 182-220), replace:

```typescript
// REMOVE these lines:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;

let res: Response;
try {
  res = await deps.fetch(url, {
    method: "GET",
    headers,
    signal: combinedSignal,
  });
} catch {
  deps.clearTimeout(timer);
  return {
    kind: "error" as const,
    message: "OpenAI rate-limit endpoint unavailable.",
  };
}
deps.clearTimeout(timer);
```

With:

```typescript
let res: Response;
try {
  res = await fetchWithTimeout(deps, url, { method: "GET", headers, signal });
} catch {
  return {
    kind: "error" as const,
    message: "OpenAI rate-limit endpoint unavailable.",
  };
}
```

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

All `provider-openai-codex.test.ts` tests must pass unchanged.

### Commit

```
refactor(openai-codex): use fetchWithTimeout and readJsonObject

Removes inline timeout/signal wiring and JSON parsing boilerplate.
Net -12 lines.
```

---

## Task 6 — Migrate openrouter.ts

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

All 16 `provider-openrouter.test.ts` tests must pass unchanged.

### Commit

```
refactor(openrouter): use fetchWithTimeout and readJsonObject

Removes timeout/signal boilerplate from fetchCredits and fetchKey helpers.
Net -20 lines.
```

---

## Task 7 — Migrate minimax.ts

### What

Replace timeout pattern, JSON parsing, and local `clampPercent` definition.

### Changes

**File:** `src/providers/minimax.ts`

1. Update imports:

```typescript
import {
  clampPercent,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. Delete local `clampPercent` function (lines 34-36).

3. In `createMiniMaxProvider` fetchLive, replace the timeout pattern (lines 366-370) and the `request` helper with `fetchWithTimeout`:

```typescript
// REMOVE the local request() helper with its timeout wiring.
// Replace each fetch call:
const res = await fetchWithTimeout(deps, url, {
  method: "GET",
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  signal,
});
```

4. Replace JSON parsing:

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

All 12 `provider-minimax.test.ts` tests must pass unchanged.

### Commit

```
refactor(minimax): use runtime utilities

Removes local clampPercent, timeout wiring, and JSON parsing boilerplate.
Net -15 lines.
```

---

## Task 8 — Migrate stepfun.ts

### What

Replace timeout pattern, local `clampPercent`, and local `readJsonObject` with shared versions.

### Changes

**File:** `src/providers/stepfun.ts`

1. Update imports:

```typescript
import {
  clampPercent,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";
```

2. Delete local `clampPercent` (lines 70-72).

3. Delete local `readJsonObject` (lines 91-98) — it's now imported.

4. In `createStepFunProvider` fetchLive, replace timeout pattern with `fetchWithTimeout`:

```typescript
// REMOVE:
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
```

5. Pass `signal` directly (not `combinedSignal`) to `loginStepFun` and `fetchStepFunUsage`, since those helpers internally call `fetchWithTimeout` for each individual fetch.

   Wait — stepfun uses a single timeout wrapping the entire flow (login + usage fetch). Converting to per-call timeouts means each network call gets its own 5s budget. This is actually more generous (total possible time = 5s \* N calls instead of 5s total). This is acceptable — individual call timeouts prevent any single slow call from hanging, and the overall flow is bounded by the number of sequential calls.

   In `loginStepFun`, replace each `deps.fetch(url, { ..., signal })` with `fetchWithTimeout(deps, url, { ..., signal })` (no explicit signal parameter on options since `fetchWithTimeout` handles it).

   In `fetchStepFunUsage`, same transformation for each fetch call.

6. Remove the outer timeout entirely from `createStepFunProvider`'s fetchLive.

### Verification

```bash
pnpm check
```

All 5 `provider-stepfun.test.ts` tests must pass unchanged.

### Commit

```
refactor(stepfun): use runtime utilities

Removes local clampPercent, readJsonObject, and timeout boilerplate.
Each network call now has its own 5s timeout instead of a shared outer timeout.
Net -18 lines.
```

---

## Task 9 — Migrate command-code.ts

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

### Verification

```bash
pnpm check
```

All 6 `provider-command-code.test.ts` tests must pass unchanged.

### Commit

```
refactor(command-code): use fetchWithTimeout and readJsonObject

Each parallel endpoint now has its own 5s timeout instead of sharing one.
Net -10 lines.
```

---

## Task 10 — Migrate opencode-go.ts

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
const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
let res: Response;
try {
  res = await deps.fetch(url, { ..., signal: combined });
} catch {
  deps.clearTimeout(timer);
  return { diagnostic: "..." };
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
    headers: { Cookie: cookieHeader, "User-Agent": "..." },
    signal,
  });
} catch {
  return { diagnostic: "OpenCode Go dashboard network unavailable." };
}
```

### Verification

```bash
pnpm check
```

All 10 `provider-opencode-go.test.ts` tests must pass unchanged.

### Commit

```
refactor(opencode-go): use runtime utilities

Replaces local clampPct and timeout wiring with shared imports.
Net -12 lines.
```

---

## Task 11 — Final verification and cleanup

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
grep -r "clampPct\|clampPercent" src/providers/opencode-go.ts
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
| 3    | runtime.ts      | +4        | None |
| 4    | runtime.ts      | +18       | None |
| 5    | openai-codex.ts | -12       | Low  |
| 6    | openrouter.ts   | -20       | Low  |
| 7    | minimax.ts      | -15       | Low  |
| 8    | stepfun.ts      | -18       | Low  |
| 9    | command-code.ts | -10       | Low  |
| 10   | opencode-go.ts  | -12       | Low  |
| 11   | Verification    | 0         | None |

**Total net change:** ~-40 lines removed from providers, +47 lines added to runtime.ts and tests.
**New test file:** `tests/runtime-utilities.test.ts` (~80 lines)
