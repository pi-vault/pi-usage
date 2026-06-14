# Phase 4 — Collapse Derived State in UsageCoreState

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 5 stored derived fields from the runtime state object, computing them at emission time via a pure `projectState()` function. Eliminates `syncCompatibility()` and its missed-call bug surface.

**Architecture:** Introduce an `InternalState` type (not exported) without derived fields. A pure `projectState(internal) → UsageCoreState` function computes all derived fields on demand. The `emit()` function calls `projectState` before cloning and emitting.

**Tech Stack:** TypeScript, Vitest.

**Depends on:** None (but Phase 5 benefits from this being done first)

**Verification:** `pnpm check` (biome lint + tsc --noEmit + vitest run)

---

## Critical Constraint

`@pi-vault/pi-status` imports from `@pi-vault/pi-usage/types` and accesses:

- `state.compatibility.currentLiveProviderSnapshot.windows`
- `state.compatibility.currentLiveProviderSnapshot.windows[].key`
- `state.compatibility.currentLiveProviderSnapshot.windows[].usedPercent`
- `state.compatibility.currentLiveProviderSnapshot.windows[].unavailableReason`

The **exported** TypeScript type `UsageCoreState` in `src/shared/types.ts` **must NOT change**. The emitted event payloads must include all derived fields exactly as before.

---

## Current State Problem

`syncCompatibility()` (src/index.ts lines 131-163) mutates 5 derived fields:

1. `state.currentProviderSnapshot` — found from `state.providers[]`
2. `state.compatibility.currentLiveProviderId` — provider ID, but ONLY if it has valid "fiveHour" or "weekly" windows
3. `state.compatibility.currentLiveProviderSnapshot` — the snapshot, but ONLY when #2 is set
4. `state.provider` — the provider label string, ONLY when #2 is set
5. `state.usage` — `CurrentUsageCompatibility` with windows filtered to "fiveHour"/"weekly" only

It's called from 3 sites (lines 243, 277, 301). A missed call = stale derived fields reaching consumers.

### Key Compatibility Logic

The function does NOT simply mirror `currentProviderId` into `compatibility.currentLiveProviderId`. It applies a **filter gate**:

```typescript
const hasCompatibilityWindows = Boolean(
  current?.windows.some(
    (window) =>
      (window.key === "fiveHour" || window.key === "weekly") &&
      !window.unavailableReason,
  ),
);
```

Only if this passes are `compatibility.*`, `provider`, and `usage` populated. Otherwise they are `null`/`undefined`.

Additionally, `usage.windows` maps `LiveUsageWindow[]` → `RateWindow[]` with:
- Only "fiveHour"/"weekly" windows included
- Only windows without `unavailableReason`
- Mapped to `{ label, usedPercent }` (the `RateWindow` shape)

---

### Task 1: Create `src/core/state-projections.ts`

**Files:**

- Create: `src/core/state-projections.ts`

- [ ] **Step 1: Create the projection module**

```typescript
// src/core/state-projections.ts
import type {
  CurrentUsageCompatibility,
  ProviderId,
  ProviderUsageSnapshot,
  UsageCoreState,
} from "../shared/types.ts";

/**
 * Internal state shape — source-of-truth fields only.
 * Not exported from the package.
 */
export interface InternalState {
  refreshRequested: boolean;
  generatedAt: number;
  loading: boolean;
  offline: UsageCoreState["offline"];
  insights: UsageCoreState["insights"];
  currentProviderId: ProviderId | null;
  currentModelLabel?: string;
  providers: ProviderUsageSnapshot[];
  diagnostics: string[];
}

/**
 * Compute the full UsageCoreState (with all derived fields) from internal state.
 * Pure function — no side effects.
 *
 * Replicates the logic of the former syncCompatibility() function:
 * - currentProviderSnapshot: lookup from providers[]
 * - compatibility.currentLiveProviderId: only set if provider has valid
 *   "fiveHour" or "weekly" windows without unavailableReason
 * - compatibility.currentLiveProviderSnapshot: only set when above is set
 * - provider: label string, only when compatibility is set
 * - usage: CurrentUsageCompatibility with filtered windows, only when compatibility is set
 */
export function projectState(state: InternalState): UsageCoreState {
  const currentSnapshot =
    state.providers.find((p) => p.providerId === state.currentProviderId) ??
    null;

  const hasCompatibilityWindows = Boolean(
    currentSnapshot?.windows.some(
      (w) =>
        (w.key === "fiveHour" || w.key === "weekly") && !w.unavailableReason,
    ),
  );

  const compatProviderId =
    hasCompatibilityWindows && currentSnapshot
      ? currentSnapshot.providerId
      : null;

  const compatSnapshot = compatProviderId ? currentSnapshot : null;

  return {
    refreshRequested: state.refreshRequested,
    generatedAt: state.generatedAt,
    loading: state.loading,
    offline: state.offline,
    insights: state.insights,
    currentProviderId: state.currentProviderId,
    currentModelLabel: state.currentModelLabel,
    currentProviderSnapshot: currentSnapshot,
    providers: state.providers,
    diagnostics: state.diagnostics,
    provider: compatSnapshot ? compatSnapshot.providerLabel : undefined,
    usage: compatSnapshot ? buildUsageCompat(compatSnapshot) : undefined,
    compatibility: {
      currentLiveProviderId: compatProviderId,
      currentLiveProviderSnapshot: compatSnapshot,
    },
  };
}

function buildUsageCompat(
  snapshot: ProviderUsageSnapshot,
): CurrentUsageCompatibility {
  return {
    provider: snapshot.providerId,
    displayName: snapshot.providerLabel,
    windows: snapshot.windows
      .filter((w) => w.key === "fiveHour" || w.key === "weekly")
      .filter((w) => !w.unavailableReason)
      .map((w) => ({ label: w.label, usedPercent: w.usedPercent })),
  };
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(core): add pure state projection functions
```

---

### Task 2: Create `tests/state-projections.test.ts`

**Files:**

- Create: `tests/state-projections.test.ts`

- [ ] **Step 1: Write comprehensive tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  projectState,
  type InternalState,
} from "../src/core/state-projections.ts";
import type { ProviderUsageSnapshot } from "../src/shared/types.ts";

function makeSnapshot(
  overrides: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerId: "openai-codex",
    providerLabel: "OpenAI/Codex",
    available: true,
    diagnostic: "",
    fetchedAt: 1000,
    balances: [],
    status: "live",
    sourceLabel: "OpenAI rate-limit API",
    sourceKind: "live",
    windows: [],
    diagnostics: [],
    ...overrides,
  };
}

function makeInternalState(
  overrides: Partial<InternalState> = {},
): InternalState {
  return {
    refreshRequested: false,
    generatedAt: 0,
    loading: false,
    offline: {
      providerId: "offline",
      totals: [],
      periods: [],
      scannedFiles: 0,
      messageCount: 0,
    },
    insights: [],
    currentProviderId: null,
    providers: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("projectState", () => {
  it("returns null snapshot when currentProviderId is null", () => {
    const result = projectState(makeInternalState({ currentProviderId: null }));
    expect(result.currentProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
  });

  it("returns null snapshot when provider not found in providers[]", () => {
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [makeSnapshot({ providerId: "minimax" })],
      }),
    );
    expect(result.currentProviderSnapshot).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("returns currentProviderSnapshot but NOT compatibility when no valid compat windows", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "daily", label: "Daily", usedPercent: 50 },
        {
          key: "fiveHour",
          label: "5h",
          usedPercent: 20,
          unavailableReason: "Rate limit exceeded",
        },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    // currentProviderSnapshot is always set when provider matches
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    // but compatibility gate fails: no valid fiveHour/weekly without unavailableReason
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("populates compatibility when provider has valid fiveHour window", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "fiveHour", label: "5-hour", usedPercent: 42 },
        { key: "daily", label: "Daily", usedPercent: 10 },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    expect(result.compatibility.currentLiveProviderId).toBe("openai-codex");
    expect(result.compatibility.currentLiveProviderSnapshot).toEqual(snapshot);
    expect(result.provider).toBe("OpenAI/Codex");
    expect(result.usage).toBeDefined();
    expect(result.usage!.provider).toBe("openai-codex");
    expect(result.usage!.displayName).toBe("OpenAI/Codex");
    // Only fiveHour window (daily excluded from usage.windows)
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({ label: "5-hour", usedPercent: 42 });
  });

  it("populates compatibility when provider has valid weekly window", () => {
    const snapshot = makeSnapshot({
      providerId: "minimax",
      providerLabel: "MiniMax",
      windows: [{ key: "weekly", label: "Weekly", usedPercent: 75 }],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "minimax",
        providers: [snapshot],
      }),
    );
    expect(result.compatibility.currentLiveProviderId).toBe("minimax");
    expect(result.provider).toBe("MiniMax");
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({ label: "Weekly", usedPercent: 75 });
  });

  it("filters unavailable windows from usage.windows", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "fiveHour", label: "5h", usedPercent: 30 },
        {
          key: "weekly",
          label: "Weekly",
          usedPercent: 0,
          unavailableReason: "No data",
        },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    // Gate passes because fiveHour is valid
    expect(result.compatibility.currentLiveProviderId).toBe("openai-codex");
    // usage.windows only includes the fiveHour (weekly filtered out due to unavailableReason)
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({ label: "5h", usedPercent: 30 });
  });

  it("handles provider with empty windows (gate fails)", () => {
    const snapshot = makeSnapshot({ windows: [] });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    // No valid compat windows → gate fails
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("preserves all source-of-truth fields", () => {
    const state = makeInternalState({
      refreshRequested: true,
      generatedAt: 12345,
      loading: true,
      currentModelLabel: "codex-mini-latest",
      diagnostics: ["test diagnostic"],
    });
    const result = projectState(state);
    expect(result.refreshRequested).toBe(true);
    expect(result.generatedAt).toBe(12345);
    expect(result.loading).toBe(true);
    expect(result.currentModelLabel).toBe("codex-mini-latest");
    expect(result.diagnostics).toEqual(["test diagnostic"]);
  });

  it("selects correct provider from multiple providers", () => {
    const codex = makeSnapshot({ providerId: "openai-codex", windows: [{ key: "fiveHour", label: "5h", usedPercent: 10 }] });
    const minimax = makeSnapshot({ providerId: "minimax", providerLabel: "MiniMax", windows: [{ key: "weekly", label: "Weekly", usedPercent: 90 }] });
    const result = projectState(
      makeInternalState({
        currentProviderId: "minimax",
        providers: [codex, minimax],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(minimax);
    expect(result.compatibility.currentLiveProviderId).toBe("minimax");
    expect(result.provider).toBe("MiniMax");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/state-projections.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(core): add unit tests for state projection
```

---

### Task 3: Wire `projectState` into `emit()` and request handler

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Import projectState and InternalState**

Add to the imports at the top of `src/index.ts`:

```typescript
import { projectState, type InternalState } from "./core/state-projections.ts";
```

- [ ] **Step 2: Change `createInitialState()` return type and remove derived fields**

Replace the existing `createInitialState()` function (lines 34-56) with:

```typescript
function createInitialState(): InternalState {
  return {
    refreshRequested: false,
    generatedAt: 0,
    loading: false,
    offline: {
      providerId: "offline",
      totals: [],
      periods: [],
      scannedFiles: 0,
      messageCount: 0,
    },
    insights: [],
    currentProviderId: null,
    providers: [],
    diagnostics: [],
  };
}
```

- [ ] **Step 3: Delete the `cloneState` helper**

Remove this function (lines 88-90):
```typescript
function cloneState(state: UsageCoreState): UsageCoreState {
  return JSON.parse(JSON.stringify(state)) as UsageCoreState;
}
```

- [ ] **Step 4: Update `emit()` to project and clone**

Replace the existing `emit` function (lines 120-123) with:

```typescript
const emit = (name: string) => {
  const payload: UsageCorePayload = {
    state: structuredClone(projectState(state)),
  };
  pi.events.emit(name, payload);
};
```

- [ ] **Step 5: Update request handler**

Replace (line 333):
```typescript
payload.reply({ state: cloneState(state) });
```

With:
```typescript
payload.reply({ state: structuredClone(projectState(state)) });
```

- [ ] **Step 6: Remove unused `UsageCoreState` import if no longer needed**

After removing `cloneState`, the `UsageCoreState` import from `"./shared/types.ts"` (line 12) may only be used indirectly via `InternalState`. Check if it's still needed (it is still used via `UsageCorePayload` in events.ts, so it likely can be removed from the direct import in index.ts). Let the type checker guide you — remove if unused.

- [ ] **Step 7: Verify — expect type errors from syncCompatibility**

Run: `pnpm typecheck`
Expected: Errors about `syncCompatibility` trying to assign derived fields to `InternalState`. This is correct — we fix it in Task 4.

- [ ] **Step 8: Commit (WIP)**

```
refactor(index): wire projectState into emit and request handler [WIP]
```

---

### Task 4: Delete `syncCompatibility()` and all call sites

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Delete the `syncCompatibility` function**

Remove the entire function body (lines 131-163):
```typescript
const syncCompatibility = () => {
  // ... entire function ...
};
```

- [ ] **Step 2: Remove all 3 call sites**

1. Line 243 — inside `populateProviders` `.then()` callback:
   ```typescript
   // Remove: syncCompatibility();
   // Keep: state.providers = snapshots; applyCommandCodeLocalFallback();
   ```

2. Line 277 — inside `refreshOffline`:
   ```typescript
   // Remove: syncCompatibility();
   // Keep: applyCommandCodeLocalFallback();
   ```

3. Line 301 — inside `updateModelContext`:
   ```typescript
   // Remove: syncCompatibility();
   // Keep: state.currentProviderId = ...; state.currentModelLabel = ...;
   ```

- [ ] **Step 3: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS — `InternalState` has no derived fields, so no assignment errors remain.

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS — all test files green.

- [ ] **Step 5: Commit**

```
refactor(index): delete syncCompatibility and all derived state mutations

Derived fields now computed solely by projectState() at emission time.
Eliminates missed-call bug surface entirely.
```

---

### Task 5: Add regression tests for derived field emission

The existing `tests/index.test.ts` has **no assertions** on `state.compatibility`, `state.provider`, or `state.usage`. We need regression coverage to ensure the projection produces the correct emitted shape.

**Files:**

- Modify: `tests/index.test.ts`

- [ ] **Step 1: Identify the test setup pattern**

Read the existing test file's helper setup (how it creates a mock `pi` object, triggers `session_start`, etc.) and the provider mock data. The new test will follow the same patterns.

- [ ] **Step 2: Add a test that verifies emitted compatibility fields**

Add a new test case in the "usage extension" describe block. The test should:

1. Set up a provider mock that returns a snapshot with "fiveHour" and "weekly" windows
2. Trigger bootstrap / session_start
3. Capture the emitted payload
4. Assert on:
   - `state.currentProviderSnapshot` matches the expected snapshot
   - `state.compatibility.currentLiveProviderId` equals the provider ID
   - `state.compatibility.currentLiveProviderSnapshot` equals the snapshot
   - `state.provider` equals the provider label
   - `state.usage.provider` equals the provider ID
   - `state.usage.displayName` equals the provider label
   - `state.usage.windows` is the filtered/mapped array (RateWindow shape: `{ label, usedPercent }`)

Follow the existing test patterns in the file for mock setup. The exact code depends on what helpers already exist in the test file — adapt accordingly.

- [ ] **Step 3: Add a test for the gate-fails case**

Add another test where the provider has NO "fiveHour"/"weekly" windows (e.g., only "daily"). Assert:
- `state.currentProviderSnapshot` is still populated (lookup always works)
- `state.compatibility.currentLiveProviderId` is `null`
- `state.compatibility.currentLiveProviderSnapshot` is `null`
- `state.provider` is `undefined`
- `state.usage` is `undefined`

- [ ] **Step 4: Run tests**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```
test(index): add regression coverage for derived compatibility fields
```

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full check**

```bash
pnpm check
```

Expected: PASS (biome lint + tsc --noEmit + vitest run)

- [ ] **Step 2: Grep for any remaining syncCompatibility references**

```bash
grep -rn "syncCompatibility" src/ tests/
```

Expected: 0 results

- [ ] **Step 3: Verify no derived field mutations remain**

```bash
grep -n "state\.currentProviderSnapshot\|state\.compatibility\.\|state\.provider\s*=\|state\.usage\s*=" src/index.ts
```

Expected: 0 results (these fields no longer exist on `InternalState`)

- [ ] **Step 4: Verify all emissions go through projectState**

```bash
grep -n "pi\.events\.emit\|payload\.reply" src/index.ts
```

Expected: Only 2 matches — the `emit()` helper body and the `payload.reply` call, both of which call `projectState`.

- [ ] **Step 5: Squash the WIP commit from Task 3**

Squash the Task 3 WIP commit into the Task 4 commit (they're logically one atomic change):

```bash
git rebase -i HEAD~3
# Mark the Task 3 commit as "fixup" into the Task 4 commit
```

Alternatively, if the agent doesn't support interactive rebase, this can be skipped — the commits are still correct individually.

---

## Exit Criteria

- [ ] No `syncCompatibility` function exists
- [ ] No direct mutations to derived fields in index.ts
- [ ] Derived fields computed only at emission time via `projectState()`
- [ ] `projectState` is pure (no side effects, tested independently)
- [ ] Event payload shape unchanged — verified by new regression tests in Task 5
- [ ] Exported `UsageCoreState` type in `src/shared/types.ts` unchanged
- [ ] `pnpm check` passes

## Risk Mitigation

| Risk | Mitigation |
| --- | --- |
| Projection doesn't match old `syncCompatibility` logic | Task 2 tests cover the compatibility gate explicitly; Task 5 adds integration-level regression tests |
| Missed emission site that bypasses `projectState` | Task 6 step 4 greps for all `pi.events.emit` / `payload.reply` calls |
| Performance of `providers.find()` on each emit | Providers array is small (2-6 items); negligible cost |
| No existing tests cover `compatibility` fields | Task 5 adds dedicated regression tests before claiming done |
| `structuredClone` vs `JSON.parse(JSON.stringify())` semantics | Both produce deep clones of plain objects. `structuredClone` is strictly better (handles `undefined` fields, no prototype issues). State contains only JSON-safe primitives, arrays, and plain objects. |
