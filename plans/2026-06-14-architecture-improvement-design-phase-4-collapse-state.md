# Phase 4 — Collapse Derived State in UsageCoreState

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 5 stored derived fields from the runtime state object, computing them at emission time via a pure `projectState()` function. Eliminates `syncCompatibility()` and its missed-call bug surface.

**Architecture:** Introduce an `InternalState` type (not exported) without derived fields. A pure `projectState(internal) → UsageCoreState` function computes all derived fields on demand. The `emit()` function calls `projectState` before cloning and emitting.

**Tech Stack:** TypeScript 6, Vitest.

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

`syncCompatibility()` (index.ts lines 131-163) mutates 5 derived fields:

1. `state.currentProviderSnapshot` — found from `state.providers[]`
2. `state.compatibility.currentLiveProviderId` — copy of `state.currentProviderId`
3. `state.compatibility.currentLiveProviderSnapshot` — same as #1
4. `state.provider` — the provider label string
5. `state.usage` — `CurrentUsageCompatibility` with windows mapped to `RateWindow[]`

It's called from 5 sites. A missed call = stale derived fields reaching consumers.

---

### Task 1: Create `src/core/state-projections.ts`

**Files:**

- Create: `src/core/state-projections.ts`

- [ ] **Step 1: Create the projection module**

```typescript
// src/core/state-projections.ts
import type {
  ProviderId,
  ProviderUsageSnapshot,
  UsageCoreState,
} from "../shared/types.ts";

/**
 * Internal state shape — source-of-truth fields only.
 * Not exported from the package.
 */
export type InternalState = {
  refreshRequested: boolean;
  generatedAt: number;
  loading: boolean;
  offline: UsageCoreState["offline"];
  insights: UsageCoreState["insights"];
  currentProviderId: ProviderId | null;
  currentModelLabel?: string;
  providers: ProviderUsageSnapshot[];
  diagnostics: string[];
};

/**
 * Compute the full UsageCoreState (with all derived fields) from internal state.
 * Pure function — no side effects.
 */
export function projectState(state: InternalState): UsageCoreState {
  const snapshot = state.currentProviderId
    ? (state.providers.find((p) => p.providerId === state.currentProviderId) ??
      null)
    : null;

  return {
    ...state,
    currentProviderSnapshot: snapshot,
    provider: snapshot?.providerLabel,
    usage: snapshot ? buildUsageCompat(snapshot) : undefined,
    compatibility: {
      currentLiveProviderId: state.currentProviderId,
      currentLiveProviderSnapshot: snapshot,
    },
  };
}

function buildUsageCompat(
  snapshot: ProviderUsageSnapshot,
): UsageCoreState["usage"] {
  return {
    provider: snapshot.providerId,
    displayName: snapshot.providerLabel,
    windows: snapshot.windows.map((w) => ({
      key: w.key,
      label: w.label,
      usedPercent: w.usedPercent,
      used: w.used,
      limit: w.limit,
      unit: w.unit,
      resetAt: w.resetAt,
      windowDurationMins: w.windowDurationMins,
      unavailableReason: w.unavailableReason,
    })),
  };
}
```

Note: The exact shape of `buildUsageCompat` must match what `syncCompatibility()` currently produces. Read `syncCompatibility()` (index.ts lines 131-163) to verify the field mapping before implementing.

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
  });

  it("returns correct snapshot when provider matches", () => {
    const snapshot = makeSnapshot({ providerId: "openai-codex" });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot, makeSnapshot({ providerId: "minimax" })],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    expect(result.provider).toBe("OpenAI/Codex");
    expect(result.compatibility.currentLiveProviderId).toBe("openai-codex");
    expect(result.compatibility.currentLiveProviderSnapshot).toEqual(snapshot);
  });

  it("builds usage compatibility with windows", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        {
          key: "primary",
          label: "Primary",
          usedPercent: 42,
          used: 420,
          limit: 1000,
          unit: "requests",
          resetAt: 99999,
        },
        {
          key: "secondary",
          label: "Secondary",
          usedPercent: 10,
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
    expect(result.usage).toBeDefined();
    expect(result.usage!.provider).toBe("openai-codex");
    expect(result.usage!.displayName).toBe("OpenAI/Codex");
    expect(result.usage!.windows).toHaveLength(2);
    expect(result.usage!.windows[0].key).toBe("primary");
    expect(result.usage!.windows[0].usedPercent).toBe(42);
    expect(result.usage!.windows[1].unavailableReason).toBe(
      "Rate limit exceeded",
    );
  });

  it("handles provider with empty windows", () => {
    const snapshot = makeSnapshot({ windows: [] });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.usage!.windows).toEqual([]);
  });

  it("preserves all source-of-truth fields", () => {
    const state = makeInternalState({
      refreshRequested: true,
      generatedAt: 12345,
      loading: true,
      diagnostics: ["test diagnostic"],
    });
    const result = projectState(state);
    expect(result.refreshRequested).toBe(true);
    expect(result.generatedAt).toBe(12345);
    expect(result.loading).toBe(true);
    expect(result.diagnostics).toEqual(["test diagnostic"]);
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

- [ ] **Step 1: Import projectState**

```typescript
import { projectState, type InternalState } from "./core/state-projections.ts";
```

- [ ] **Step 2: Change state variable type**

```typescript
// Before:
const state: UsageCoreState = createInitialState();

// After:
const state: InternalState = createInitialState();
```

Update `createInitialState()` to return `InternalState` (remove derived fields from initial value):

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

- [ ] **Step 3: Update emit() to project state**

```typescript
// Before:
const emit = (name: string) => {
  const payload: UsageCorePayload = { state: cloneState(state) };
  pi.events.emit(name, payload);
};

// After:
const emit = (name: string) => {
  const projected = projectState(state);
  const payload: UsageCorePayload = { state: structuredClone(projected) };
  pi.events.emit(name, payload);
};
```

- [ ] **Step 4: Update request handler**

```typescript
// Before:
payload.reply({ state: cloneState(state) });

// After:
payload.reply({ state: structuredClone(projectState(state)) });
```

- [ ] **Step 5: Verify compiles (will have errors from syncCompatibility calls)**

Run: `pnpm typecheck`
Expected: Errors about `state.currentProviderSnapshot` etc. (fixed in Task 4)

- [ ] **Step 6: Commit** (WIP — will fix in next task)

```
refactor(index): wire projectState into emit and request handler
```

---

### Task 4: Delete `syncCompatibility()` and all call sites

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Delete the function**

Remove the entire `syncCompatibility()` function (lines ~131-163).

- [ ] **Step 2: Remove all call sites**

Search for `syncCompatibility()` in index.ts and delete each call. There are 5 sites:

1. After `populateProviders()` completes
2. After `applyCommandCodeLocalFallback()`
3. After `updateModelContext()` changes `currentProviderId`
4. After loading state from cache on bootstrap
5. After any provider snapshot update

- [ ] **Step 3: Remove direct mutations to derived fields**

Delete any lines that directly set:

- `state.currentProviderSnapshot = ...`
- `state.compatibility.currentLiveProviderId = ...`
- `state.compatibility.currentLiveProviderSnapshot = ...`
- `state.provider = ...`
- `state.usage = ...`

These no longer exist on `InternalState`.

- [ ] **Step 4: Fix remaining type errors**

Any code that reads derived fields from `state` must be changed to either:

- Call `projectState(state)` if it needs the full projected view
- Or access source-of-truth fields directly (e.g., `state.currentProviderId`)

- [ ] **Step 5: Verify compiles and tests pass**

Run: `pnpm check`
Expected: PASS — all 11 test files green

- [ ] **Step 6: Commit**

```
refactor(index): delete syncCompatibility and all derived state mutations

Derived fields now computed solely by projectState() at emission time.
Eliminates missed-call bug surface entirely.
```

---

### Task 5: Verify event payload shape is identical

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm check
```

The existing tests in `tests/index.test.ts` assert on emitted event payloads including `state.compatibility.currentLiveProviderSnapshot`. If these pass, the payload shape is preserved.

- [ ] **Step 2: Grep for any remaining syncCompatibility references**

```bash
grep -rn "syncCompatibility" src/ tests/
# Expected: 0 results
```

- [ ] **Step 3: Verify no derived field mutations remain**

```bash
grep -n "state\.currentProviderSnapshot\|state\.compatibility\.\|state\.provider\s*=\|state\.usage\s*=" src/index.ts
# Expected: 0 results (these fields no longer exist on InternalState)
```

---

## Exit Criteria

- [ ] No `syncCompatibility` function exists
- [ ] No direct mutations to derived fields in index.ts
- [ ] Derived fields computed only at emission time via `projectState()`
- [ ] `projectState` is pure (no side effects, tested independently)
- [ ] Event payload shape unchanged (verified by existing `tests/index.test.ts`)
- [ ] Exported `UsageCoreState` type in `src/shared/types.ts` unchanged
- [ ] `pnpm check` passes

## Risk Mitigation

| Risk                                                | Mitigation                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Missed emission site that bypasses `projectState`   | Grep for all `pi.events.emit` calls; ensure all go through `emit()` helper |
| Performance of `providers.find()` on each emit      | Providers array is small (2-6 items); negligible cost                      |
| `buildUsageCompat` doesn't match old output exactly | Diff test output before/after; existing tests catch any mismatch           |
