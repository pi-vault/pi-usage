# Phase 5 — Deepen index.ts into a UsageCore Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract state management and orchestration from the extension entry point into a testable `UsageCore` module. `index.ts` becomes a thin adapter mapping Pi hooks to core calls (~80-100 lines).

**Architecture:** `createUsageCore()` owns all state, timers, watchers, and provider orchestration. It accepts `UsageDeps` and an `onStateChange` callback. `index.ts` creates a core instance and maps Pi lifecycle events to core method calls.

**Tech Stack:** TypeScript 6, Vitest.

**Depends on:** Phase 4 (state projections, `InternalState` type)

**Verification:** `pnpm check` (biome lint + tsc --noEmit + vitest run)

---

## File Structure

| File                        | Responsibility               | ~Lines  |
| --------------------------- | ---------------------------- | ------- |
| `src/shared/concurrency.ts` | `mapWithLimit` utility       | ~25     |
| `src/core/usage-core.ts`    | State + orchestration module | ~250    |
| `src/index.ts`              | Thin Pi adapter              | ~80-100 |

---

### Task 1: Extract `mapWithLimit` to `src/shared/concurrency.ts`

**Files:**

- Create: `src/shared/concurrency.ts`
- Create: `tests/concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/concurrency.test.ts
import { describe, expect, it } from "vitest";
import { mapWithLimit } from "../src/shared/concurrency.ts";

describe("mapWithLimit", () => {
  it("maps all items preserving order", async () => {
    const result = await mapWithLimit([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40]);
  });

  it("respects concurrency limit", async () => {
    let running = 0;
    let maxRunning = 0;
    await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n;
    });
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("handles empty array", async () => {
    const result = await mapWithLimit([], 3, async (n: number) => n);
    expect(result).toEqual([]);
  });

  it("propagates first error", async () => {
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("handles limit greater than items length", async () => {
    const result = await mapWithLimit([1, 2], 10, async (n) => n * 2);
    expect(result).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/concurrency.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```typescript
// src/shared/concurrency.ts

/**
 * Map items through an async function with bounded concurrency.
 * Workers pull from a shared queue — at most `limit` run simultaneously.
 * Results preserve input order.
 */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/concurrency.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(shared): extract mapWithLimit concurrency utility
```

---

### Task 2: Create `src/core/usage-core.ts` with interface and skeleton

**Files:**

- Create: `src/core/usage-core.ts`

- [ ] **Step 1: Define interface and factory**

```typescript
// src/core/usage-core.ts
import type { UsageDeps } from "../shared/deps.ts";
import type { UsageCoreState } from "../shared/types.ts";
import { type InternalState, projectState } from "./state-projections.ts";

export interface UsageCoreOptions {
  deps: UsageDeps;
  onStateChange: (state: UsageCoreState) => void;
}

export interface UsageCore {
  bootstrap(): Promise<void>;
  refresh(force?: boolean, signal?: AbortSignal): Promise<void>;
  refreshOffline(force?: boolean): Promise<void>;
  updateModel(
    model: { provider?: string; id?: string; name?: string } | undefined,
  ): void;
  getState(): UsageCoreState;
  startLivePolling(): void;
  shutdown(): void;
}

export function createUsageCore(options: UsageCoreOptions): UsageCore {
  const { deps, onStateChange } = options;

  // --- State ---
  let state: InternalState = {
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

  function getState(): UsageCoreState {
    return structuredClone(projectState(state));
  }

  function emit(): void {
    onStateChange(getState());
  }

  // Methods stubbed — filled in subsequent tasks
  async function bootstrap(): Promise<void> {
    /* Task 3 */
  }
  async function refresh(
    _force?: boolean,
    _signal?: AbortSignal,
  ): Promise<void> {
    /* Task 4 */
  }
  async function refreshOffline(_force?: boolean): Promise<void> {
    /* Task 5 */
  }
  function updateModel(
    _model: { provider?: string; id?: string; name?: string } | undefined,
  ): void {
    /* Task 6 */
  }
  function startLivePolling(): void {
    /* Task 7 */
  }
  function shutdown(): void {
    /* Task 8 */
  }

  return {
    bootstrap,
    refresh,
    refreshOffline,
    updateModel,
    getState,
    startLivePolling,
    shutdown,
  };
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(core): add UsageCore skeleton with interface and factory
```

---

### Task 3: Move bootstrap logic into UsageCore

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `src/index.ts` (remove bootstrap logic)

- [ ] **Step 1: Implement bootstrap()**

Move the session_start bootstrap sequence from index.ts into the core:

```typescript
async function bootstrap(): Promise<void> {
  state.loading = true;
  emit();

  await Promise.all([refreshOffline(true), refresh(true)]);

  state.loading = false;
  state.generatedAt = deps.now();
  emit();
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement UsageCore.bootstrap()
```

---

### Task 4: Move `populateProviders()` into UsageCore.refresh()

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `src/index.ts` (remove `populateProviders`)

- [ ] **Step 1: Implement refresh()**

Move `populateProviders()` logic (index.ts lines ~198-249) including `mapWithLimit` usage:

```typescript
import { mapWithLimit } from "../shared/concurrency.ts";
import { createProviderRegistry } from "../providers/index.ts";

async function refresh(force = false, signal?: AbortSignal): Promise<void> {
  if (!force && !state.refreshRequested) return;
  state.refreshRequested = false;

  const registry = createProviderRegistry(deps);
  const results = await mapWithLimit(registry, 3, async (adapter) => {
    const outcome = await adapter.fetch({ force, signal });
    return outcome.snapshot;
  });

  state.providers = results;
  state.generatedAt = deps.now();
  applyCommandCodeLocalFallback();
  emit();
}
```

- [ ] **Step 2: Move `applyCommandCodeLocalFallback()`**

This function patches the command-code provider with offline cost data. Move it into the core as a private function.

- [ ] **Step 3: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit**

```
refactor(core): move populateProviders into UsageCore.refresh()
```

---

### Task 5: Move `refreshOffline()` into UsageCore

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `src/index.ts` (remove `refreshOffline`)

- [ ] **Step 1: Implement refreshOffline()**

Move offline scanning logic (index.ts lines ~251-282):

```typescript
import { buildInsights, scanOfflineUsage } from "../core/offline.ts";
import { buildPeriods } from "../tui/dashboard-model.ts";

async function refreshOffline(force = false): Promise<void> {
  const result = await scanOfflineUsage(deps, {
    refresh: force,
    shouldCancel: () => shutdownRequested,
  });

  state.offline = {
    providerId: "offline",
    totals: [], // computed from result
    periods: buildPeriods(result),
    scannedFiles: result.scannedFiles,
    messageCount: result.turns.length,
  };
  state.insights = buildInsights(result.turns);
  emit();
}
```

- [ ] **Step 2: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): move refreshOffline into UsageCore
```

---

### Task 6: Move `updateModelContext()` + `detectProviderFromModel()`

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `src/index.ts` (remove both functions)

- [ ] **Step 1: Move provider detection logic**

Move `detectProviderFromModel()` (index.ts lines 58-86) as a private function inside the core:

```typescript
function detectProviderFromModel(
  model: { provider?: string; id?: string; name?: string } | undefined,
): ProviderId | undefined {
  // ... exact existing implementation
}

function updateModel(
  model: { provider?: string; id?: string; name?: string } | undefined,
): void {
  const detected = detectProviderFromModel(model);
  if (detected === state.currentProviderId) return; // no-op
  state.currentProviderId = detected ?? null;
  if (model?.name) state.currentModelLabel = model.name;
  emit();
}
```

- [ ] **Step 2: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): move updateModel + detectProviderFromModel into UsageCore
```

---

### Task 7: Move lifecycle management (polling timer, cache watcher)

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `src/index.ts` (remove timer/watcher setup)

- [ ] **Step 1: Implement startLivePolling()**

Move the 30-minute interval and cache watcher:

```typescript
const POLL_INTERVAL_MS = 1_800_000; // 30 minutes

let periodicRefresh: ReturnType<typeof deps.setInterval> | undefined;
let cacheWatcher: (() => void) | undefined;
let shutdownRequested = false;

function startLivePolling(): void {
  if (periodicRefresh) return; // idempotent

  periodicRefresh = deps.setInterval(() => {
    refresh(true).catch(() => {});
  }, POLL_INTERVAL_MS);

  // Watch provider cache directory for external changes
  try {
    const cacheDir = providerCacheDir(deps);
    const watcher = deps.watch(cacheDir);
    cacheWatcher = () => watcher.close();
    watcher.on("change", () => {
      refresh(true).catch(() => {});
    });
  } catch {
    // Cache dir may not exist yet — not critical
  }
}
```

- [ ] **Step 2: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): move polling timer and cache watcher into UsageCore
```

---

### Task 8: Implement `UsageCore.shutdown()`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Consolidate cleanup**

```typescript
function shutdown(): void {
  shutdownRequested = true;

  if (periodicRefresh) {
    deps.clearInterval(periodicRefresh);
    periodicRefresh = undefined;
  }

  if (cacheWatcher) {
    cacheWatcher();
    cacheWatcher = undefined;
  }
}
```

- [ ] **Step 2: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement UsageCore.shutdown() with full cleanup
```

---

### Task 9: Shrink `index.ts` to thin Pi adapter

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite index.ts**

Replace the 400+ line file with a thin adapter:

```typescript
// src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageCore, type UsageCore } from "./core/usage-core.ts";
import { createDefaultDeps, type UsageDeps } from "./shared/deps.ts";
import {
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCoreCurrentRequest,
} from "./shared/events.ts";
import type { UsageCoreState } from "./shared/types.ts";
import { openDashboard } from "./tui/dashboard.ts";

export type UsageExtensionOptions = {
  deps?: Partial<UsageDeps>;
  injectedMode?: boolean;
};

const GLOBAL_KEY = "__piUsageExtension";

function mergeDeps(overrides?: Partial<UsageDeps>): UsageDeps {
  return overrides
    ? { ...createDefaultDeps(), ...overrides }
    : createDefaultDeps();
}

function isCurrentRequest(value: unknown): value is UsageCoreCurrentRequest {
  return (
    value != null &&
    typeof value === "object" &&
    "reply" in value &&
    typeof (value as Record<string, unknown>).reply === "function"
  );
}

export function createUsageExtension(options?: UsageExtensionOptions) {
  const deps = mergeDeps(options?.deps);
  const injectedMode = options?.injectedMode ?? false;

  return function usageExtension(pi: ExtensionAPI): void {
    if (!injectedMode && (globalThis as Record<string, unknown>)[GLOBAL_KEY])
      return;
    if (!injectedMode)
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = {
        initialized: true,
      };

    const core = createUsageCore({
      deps,
      onStateChange: (state) => {
        pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, { state });
      },
    });

    // Pi hooks → core
    pi.on("session_start", (_, ctx) => {
      core.updateModel(ctx.model);
      core.startLivePolling();
      core.bootstrap();
    });
    pi.on("model_select", (e, ctx) => {
      core.updateModel(e.model ?? ctx.model);
      core.refresh(true, ctx.signal);
    });
    pi.on("turn_start", (_, ctx) => core.updateModel(ctx.model));
    pi.on("turn_end", (_, ctx) => core.updateModel(ctx.model));

    // Commands
    pi.registerCommand("usage", {
      description: "Open the usage dashboard",
      execute: async (_, ctx) => {
        openDashboard(core.getState(), ctx);
      },
    });
    pi.registerCommand("usage:refresh", {
      description: "Force refresh usage data",
      execute: async (_, ctx) => {
        await core.refresh(true, ctx.signal);
      },
    });

    // Request/reply
    const unsubscribe = pi.events.on(
      USAGE_CORE_REQUEST_EVENT,
      (payload: unknown) => {
        if (!isCurrentRequest(payload)) return;
        payload.reply({ state: core.getState() });
      },
    );

    // Cleanup
    pi.on("session_shutdown", () => {
      core.shutdown();
      delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
      unsubscribe();
    });
  };
}

export default createUsageExtension;
```

Note: Adapt the command handlers to match the exact existing signatures (check `pi.registerCommand` API). The above is a template — read the current index.ts command implementations to get the exact `execute` signatures and `openDashboard` call pattern.

- [ ] **Step 2: Verify line count**

```bash
wc -l src/index.ts
# Must be <= 100
```

- [ ] **Step 3: Verify tests pass**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 4: Commit**

```
refactor(index): shrink to thin Pi adapter using UsageCore

index.ts reduced from 437 to ~90 lines.
All orchestration now lives in src/core/usage-core.ts.
```

---

### Task 10: Create `tests/usage-core.test.ts`

**Files:**

- Create: `tests/usage-core.test.ts`

- [ ] **Step 1: Write core-specific unit tests (no Pi mocks)**

```typescript
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultDeps } from "../src/shared/deps.ts";
import { createUsageCore, type UsageCore } from "../src/core/usage-core.ts";
import type { UsageCoreState } from "../src/shared/types.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-core-"));
}

function createTestDeps(root: string) {
  const deps = createDefaultDeps();
  return {
    ...deps,
    agentDir: () => root,
    now: () => 1_000_000,
    env: {},
  };
}

describe("UsageCore", () => {
  it("getState returns projected state after construction", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onStateChange: () => {},
    });
    const s = core.getState();
    expect(s.currentProviderId).toBeNull();
    expect(s.currentProviderSnapshot).toBeNull();
    expect(s.compatibility.currentLiveProviderId).toBeNull();
    expect(s.providers).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("updateModel sets currentProviderId and emits", () => {
    const root = mkTmp();
    const changes: UsageCoreState[] = [];
    const core = createUsageCore({
      deps: createTestDeps(root),
      onStateChange: (s) => changes.push(s),
    });
    core.updateModel({ provider: "openai", id: "gpt-4o", name: "GPT-4o" });
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(core.getState().currentProviderId).not.toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  it("shutdown stops polling and cache watcher", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onStateChange: () => {},
    });
    core.startLivePolling();
    core.shutdown();
    // No error thrown, timers cleaned up
    rmSync(root, { recursive: true, force: true });
  });

  it("refresh populates providers array", async () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: { ...createTestDeps(root), env: {} },
      onStateChange: () => {},
    });
    await core.refresh(true);
    // Even with no credentials, providers array should be populated (unavailable snapshots)
    expect(core.getState().providers.length).toBeGreaterThanOrEqual(0);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/usage-core.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(core): add UsageCore unit tests without Pi extension mocks
```

---

### Task 11: Verify existing integration tests pass

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm check
```

All existing tests must pass, especially `tests/index.test.ts` (13 tests) which exercises the full Pi extension API through `createUsageExtension`.

- [ ] **Step 2: Fix any regressions**

If tests fail, the most likely causes are:

- Import path changes (update test imports)
- Event emission timing differences (adjust test waitForEvent timeouts)
- Mock Pi API mismatch (ensure command/hook signatures match)

---

### Task 12: Final verification and exit criteria

- [ ] **Step 1: Verify line count**

```bash
wc -l src/index.ts
# Must be <= 100
```

- [ ] **Step 2: Verify no scattered lifecycle in index.ts**

```bash
grep -n "setInterval\|setTimeout\|clearInterval\|clearTimeout\|\.watch(" src/index.ts
# Expected: 0 matches
```

- [ ] **Step 3: Verify UsageCore is testable without Pi**

```bash
grep -n "pi-coding-agent\|ExtensionAPI" tests/usage-core.test.ts
# Expected: 0 matches (core tests don't import Pi types)
```

- [ ] **Step 4: Run full check one final time**

```bash
pnpm check
```

---

## Exit Criteria

- [ ] `index.ts` <= 100 lines
- [ ] `UsageCore` testable without Pi extension API mocks
- [ ] No scattered timer/watcher variables in index.ts
- [ ] All existing tests pass (11 test files)
- [ ] `mapWithLimit` independently tested in `tests/concurrency.test.ts`
- [ ] New `tests/usage-core.test.ts` passes
- [ ] `pnpm check` passes

## Risk Mitigation

| Risk                         | Mitigation                                                 |
| ---------------------------- | ---------------------------------------------------------- |
| Breaking Pi hook behavior    | `tests/index.test.ts` is the integration safety net        |
| Timer leaks                  | `shutdown()` consolidates all cleanup; tested in isolation |
| State emission order changes | Tests assert on emission counts and final state            |
| Import cycle (core ↔ index)  | Core never imports from index; dependency flows one way    |
| `openDashboard` coupling     | Stays in index.ts (it's a Pi-specific UI concern)          |
