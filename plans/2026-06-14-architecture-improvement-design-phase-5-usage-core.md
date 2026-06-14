# Phase 5 — Deepen index.ts into a UsageCore Module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract state management and orchestration from the extension entry point into a testable `UsageCore` module. `index.ts` becomes a thin adapter mapping Pi hooks to core calls (~80-100 lines).

**Architecture:** `createUsageCore()` owns all state, timers, watchers, provider lifecycle, and the `providerRefresh` mutex. It accepts `UsageDeps` and an `onEmit` callback for event forwarding. `index.ts` creates a core instance and maps Pi lifecycle events (`session_start`, `model_select`, `turn_start`, `turn_end`, `session_shutdown`) to core method calls, registers commands, and wires the request/reply event handler.

**Tech Stack:** TypeScript 6, Vitest.

**Depends on:** Phase 4 (state projections, `InternalState` type)

**Verification:** `pnpm check` (biome lint + tsc --noEmit + vitest run)

---

## File Structure

| File | Responsibility | ~Lines |
| --- | --- | --- |
| `src/shared/concurrency.ts` | `mapWithLimit` utility | ~25 |
| `src/shared/provider-detection.ts` | `detectProviderFromModel` pure function | ~35 |
| `src/core/usage-core.ts` | State + orchestration module | ~280 |
| `src/index.ts` | Thin Pi adapter | ~80-100 |

---

## Key Design Decisions

1. **Provider registry created once** at core construction, reused across all `populateProviders` calls (adapters are stateful with internal cache).
2. **`detectProviderFromModel`** extracted to `src/shared/provider-detection.ts` and re-exported from `index.ts` for backward compatibility (consumed by `tests/provider-registry.test.ts`).
3. **`onEmit(eventName, payload)` callback** — core creates the structuredClone payload; adapter just forwards to `pi.events.emit`.
4. **`providerRefresh` mutex** — the queue-if-busy pattern is preserved exactly (prevents duplicate parallel fetches).
5. **`ScanToken`** — per-scan cancellation tokens stay as-is; no module-level `shutdownRequested` flag.
6. **`dashboardBus` / `__piUsageBus`** — stays in index.ts (Pi-specific adapter concern).

---

### Task 1: Extract `mapWithLimit` to `src/shared/concurrency.ts`

**Files:**

- Create: `src/shared/concurrency.ts`
- Create: `tests/concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/concurrency.test.ts`:

```typescript
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

Create `src/shared/concurrency.ts`:

```typescript
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

### Task 2: Extract `detectProviderFromModel` to `src/shared/provider-detection.ts`

**Files:**

- Create: `src/shared/provider-detection.ts`
- Modify: `src/index.ts` (replace function body with re-export)
- Verify: `tests/provider-registry.test.ts` still passes (imports from `../src/index.ts`)

- [ ] **Step 1: Create `src/shared/provider-detection.ts`**

Copy the function verbatim from `src/index.ts` lines 56-84:

```typescript
export function detectProviderFromModel(
  model: { provider?: string; id?: string; name?: string } | undefined,
):
  | "openai-codex"
  | "minimax"
  | "stepfun"
  | "opencode-go"
  | "command-code"
  | "openrouter"
  | undefined {
  if (!model) return undefined;
  const p = (model.provider ?? "").trim().toLowerCase();
  if (p === "openai-codex") return "openai-codex";
  if (p === "minimax") return "minimax";
  if (p === "stepfun") return "stepfun";
  if (p === "opencode-go") return "opencode-go";
  if (p === "command-code" || p === "commandcode") return "command-code";
  if (p === "openrouter") return "openrouter";
  if (p) return undefined;
  const n = (model.id ?? model.name ?? "").toLowerCase();
  if (n.includes("codex")) return "openai-codex";
  if (n.includes("minimax")) return "minimax";
  if (n.includes("stepfun")) return "stepfun";
  if (n.includes("opencode-go")) return "opencode-go";
  if (n.includes("command-code") || n.includes("commandcode")) {
    return "command-code";
  }
  return undefined;
}
```

- [ ] **Step 2: Update `src/index.ts`**

Replace the `detectProviderFromModel` function definition (lines 56-84) with a re-export:

```typescript
export { detectProviderFromModel } from "./shared/provider-detection.ts";
```

Update internal usage (line 259) to import from the shared module instead (or use the re-exported name — since it's in the same file scope via re-export, just add the import at the top):

```typescript
import { detectProviderFromModel } from "./shared/provider-detection.ts";
```

And remove the `export` from the re-export line since we now import it. Actually, keep it simple: just re-export it so the public API doesn't change, and import it separately for internal use:

At top of `src/index.ts`, add:
```typescript
import { detectProviderFromModel } from "./shared/provider-detection.ts";
```

Replace the function definition with:
```typescript
export { detectProviderFromModel } from "./shared/provider-detection.ts";
```

- [ ] **Step 3: Verify tests pass**

Run: `pnpm vitest run tests/provider-registry.test.ts`
Expected: PASS (import from `../src/index.ts` still works via re-export)

- [ ] **Step 4: Run full check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor(shared): extract detectProviderFromModel to dedicated module
```

---

### Task 3: Create `src/core/usage-core.ts` — interface and factory skeleton

**Files:**

- Create: `src/core/usage-core.ts`

- [ ] **Step 1: Define interface and factory**

```typescript
import type { UsageDeps } from "../shared/deps.ts";
import type {
  ProviderId,
  ProviderUsageSnapshot,
  UsageCoreState,
  UsageProviderAdapter,
} from "../shared/types.ts";
import type { UsageCorePayload } from "../shared/events.ts";
import {
  type InternalState,
  projectState,
} from "./state-projections.ts";
import { createProviderRegistry, providerCacheDir } from "../providers/index.ts";
import { detectProviderFromModel } from "../shared/provider-detection.ts";
import { mapWithLimit } from "../shared/concurrency.ts";
import { buildInsights, scanOfflineUsage } from "./offline.ts";
import { buildPeriods } from "../tui/dashboard-model.ts";

export type ScanToken = { cancelled: boolean };

export interface UsageCoreOptions {
  deps: UsageDeps;
  onEmit: (eventName: string, payload: UsageCorePayload) => void;
}

export interface UsageCore {
  bootstrap(): Promise<void>;
  populateProviders(force?: boolean, signal?: AbortSignal): Promise<void>;
  refreshOffline(refresh: boolean, token?: ScanToken): Promise<void>;
  prepareUsageDashboard(refresh: boolean): Promise<{
    cancelScan: () => void;
    scan: Promise<void> | undefined;
  }>;
  updateModel(
    model: { provider?: string; id?: string; name?: string } | undefined,
  ): void;
  emitProviderUpdate(force?: boolean, signal?: AbortSignal): Promise<void>;
  getState(): UsageCoreState;
  isLiveProvider(id: ProviderId | null): boolean;
  startLiveRuntime(): void;
  shutdown(): void;
}

export function createUsageCore(options: UsageCoreOptions): UsageCore {
  const { deps, onEmit } = options;

  // --- Provider registry (created once, reused) ---
  const providers = createProviderRegistry(deps);
  const liveProviderIds = new Set(
    providers
      .filter((p) => p.strategy === "api")
      .map((p) => p.id),
  );
  const liveProviderSnapshotFiles = new Set(
    [...liveProviderIds].map((id) => `${id}.json`),
  );

  // --- State ---
  const state: InternalState = {
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

  // --- Helpers ---
  function emit(eventName: string): void {
    onEmit(eventName, { state: structuredClone(projectState(state)) });
  }

  function getState(): UsageCoreState {
    return structuredClone(projectState(state));
  }

  function isLiveProvider(id: ProviderId | null): boolean {
    return id !== null && liveProviderIds.has(id);
  }

  // --- Stubs (filled in subsequent tasks) ---
  let providerRefresh: Promise<void> | null = null;
  let providerForcePending = false;
  let periodicRefresh: NodeJS.Timeout | undefined;
  let cacheWatcher: { close: () => void } | undefined;
  let localCommandCodeCost = 0;

  function applyCommandCodeLocalFallback(): void { /* Task 4 */ }
  async function populateProviders(_force?: boolean, _signal?: AbortSignal): Promise<void> { /* Task 5 */ }
  async function refreshOffline(_refresh: boolean, _token?: ScanToken): Promise<void> { /* Task 6 */ }
  async function bootstrap(): Promise<void> { /* Task 7 */ }
  function updateModel(_model: { provider?: string; id?: string; name?: string } | undefined): void { /* Task 8 */ }
  async function emitProviderUpdate(_force?: boolean, _signal?: AbortSignal): Promise<void> { /* Task 9 */ }
  async function prepareUsageDashboard(_refresh: boolean): Promise<{ cancelScan: () => void; scan: Promise<void> | undefined }> { /* Task 10 */ }
  function startLiveRuntime(): void { /* Task 11 */ }
  function shutdown(): void { /* Task 12 */ }

  return {
    bootstrap,
    populateProviders,
    refreshOffline,
    prepareUsageDashboard,
    updateModel,
    emitProviderUpdate,
    getState,
    isLiveProvider,
    startLiveRuntime,
    shutdown,
  };
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS (stubs are typed correctly even if empty)

- [ ] **Step 3: Commit**

```
feat(core): add UsageCore skeleton with interface and factory
```

---

### Task 4: Implement `applyCommandCodeLocalFallback`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `applyCommandCodeLocalFallback` stub with the actual implementation from index.ts lines 127-158:

```typescript
  function applyCommandCodeLocalFallback(): void {
    const ccIndex = state.providers.findIndex(
      (p) => p.providerId === "command-code",
    );
    if (
      ccIndex < 0 ||
      localCommandCodeCost <= 0 ||
      state.providers[ccIndex].available
    ) {
      return;
    }
    state.providers[ccIndex] = {
      ...state.providers[ccIndex],
      available: true,
      status: "local",
      sourceKind: "local",
      sourceLabel: "Local Pi sessions",
      diagnostic: "Live unavailable; showing local Pi session history.",
      diagnostics: [
        "Snapshot reflects only local Pi session history.",
        ...state.providers[ccIndex].diagnostics,
      ],
      windows: [],
      balances: [
        {
          label: "Local Pi session total",
          remaining: localCommandCodeCost,
          unit: "USD",
        },
      ],
    };
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement applyCommandCodeLocalFallback in UsageCore
```

---

### Task 5: Implement `populateProviders` with mutex

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `populateProviders` stub. This preserves the exact concurrency control from index.ts lines 160-210:

```typescript
  async function populateProviders(force = false, signal?: AbortSignal): Promise<void> {
    if (providerRefresh) {
      if (force) providerForcePending = true;
      await providerRefresh;
      if (force && providerForcePending) {
        providerForcePending = false;
        await populateProviders(true, signal);
      }
      return;
    }

    providerRefresh = mapWithLimit(
      providers,
      3,
      async (provider) =>
        (
          await provider.fetch({
            force,
            signal,
          })
        ).snapshot,
    )
      .then((snapshots) => {
        state.providers = snapshots;
        applyCommandCodeLocalFallback();
      })
      .finally(() => {
        providerRefresh = null;
      });
    return providerRefresh;
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement populateProviders with mutex in UsageCore
```

---

### Task 6: Implement `refreshOffline`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `refreshOffline` stub. This is index.ts lines 212-242 verbatim:

```typescript
  async function refreshOffline(refresh: boolean, token?: ScanToken): Promise<void> {
    state.loading = true;
    emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    const result = await scanOfflineUsage(deps, {
      refresh,
      shouldCancel: () => token?.cancelled === true,
    });
    if (token?.cancelled) {
      state.loading = false;
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
      return;
    }
    state.offline.periods = buildPeriods(result);
    state.offline.scannedFiles = result.scannedFiles;
    state.offline.messageCount = result.turns.length;
    state.insights = buildInsights(result.turns);
    localCommandCodeCost = result.turns
      .filter(
        (turn) =>
          (turn.provider === "command-code" ||
            turn.provider === "commandcode") &&
          turn.cost > 0,
      )
      .reduce((sum, turn) => sum + turn.cost, 0);

    applyCommandCodeLocalFallback();

    state.generatedAt = deps.now();
    state.loading = false;
    emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
  }
```

Also add the import for `USAGE_CORE_UPDATE_CURRENT_EVENT` and `USAGE_CORE_READY_EVENT` at the top of the file:

```typescript
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCorePayload,
} from "../shared/events.ts";
```

(Update the existing import from `../shared/events.ts` to include the event name constants.)

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement refreshOffline in UsageCore
```

---

### Task 7: Implement `bootstrap`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `bootstrap` stub. From index.ts lines 244-248:

```typescript
  async function bootstrap(): Promise<void> {
    await Promise.all([populateProviders(false), refreshOffline(false)]);
    state.diagnostics = ["live runtime ready"];
    emit(USAGE_CORE_READY_EVENT);
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement bootstrap in UsageCore
```

---

### Task 8: Implement `updateModel`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `updateModel` stub. From index.ts lines 250-261:

```typescript
  function updateModel(
    model: { provider?: string; id?: string; name?: string } | undefined,
  ): void {
    state.currentProviderId = detectProviderFromModel(model) ?? null;
    state.currentModelLabel = model?.id ?? model?.name;
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement updateModel in UsageCore
```

---

### Task 9: Implement `emitProviderUpdate`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `emitProviderUpdate` stub. From index.ts lines 263-266:

```typescript
  async function emitProviderUpdate(force = false, signal?: AbortSignal): Promise<void> {
    await populateProviders(force, signal);
    emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement emitProviderUpdate in UsageCore
```

---

### Task 10: Implement `prepareUsageDashboard`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `prepareUsageDashboard` stub. From index.ts lines 330-348:

```typescript
  async function prepareUsageDashboard(refresh: boolean): Promise<{
    cancelScan: () => void;
    scan: Promise<void> | undefined;
  }> {
    if (refresh) {
      state.refreshRequested = true;
      state.diagnostics = [...state.diagnostics, "refresh requested"];
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    }

    await populateProviders(refresh);
    const scanToken: ScanToken = { cancelled: false };
    const shouldScan =
      refresh || (state.offline.periods.length === 0 && !state.loading);
    const scan = shouldScan ? refreshOffline(refresh, scanToken) : undefined;
    return {
      cancelScan: () => {
        scanToken.cancelled = true;
      },
      scan,
    };
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement prepareUsageDashboard in UsageCore
```

---

### Task 11: Implement `startLiveRuntime`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `startLiveRuntime` stub. From index.ts lines 268-286:

```typescript
  function startLiveRuntime(): void {
    if (!periodicRefresh) {
      periodicRefresh = deps.setInterval(() => {
        void emitProviderUpdate(false).catch(() => undefined);
      }, 1_800_000);
      deps.unrefTimer(periodicRefresh);
    }
    if (!cacheWatcher) {
      void deps
        .mkdir(providerCacheDir(deps), { recursive: true })
        .then(() => {
          cacheWatcher = deps.watch(providerCacheDir(deps), (filename) => {
            if (!filename || !liveProviderSnapshotFiles.has(filename)) return;
            void emitProviderUpdate(false).catch(() => undefined);
          });
        })
        .catch(() => undefined);
    }
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement startLiveRuntime with polling and cache watcher
```

---

### Task 12: Implement `shutdown`

**Files:**

- Modify: `src/core/usage-core.ts`

- [ ] **Step 1: Replace the stub**

Replace the `shutdown` stub. From index.ts lines 385-388:

```typescript
  function shutdown(): void {
    if (periodicRefresh) deps.clearInterval(periodicRefresh);
    periodicRefresh = undefined;
    cacheWatcher?.close();
    cacheWatcher = undefined;
  }
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(core): implement shutdown in UsageCore
```

---

### Task 13: Rewrite `src/index.ts` as thin Pi adapter

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/index.ts` with:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageCore, type UsageCore } from "./core/usage-core.ts";
import { createDefaultDeps, type UsageDeps } from "./shared/deps.ts";
import {
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCoreCurrentRequest,
} from "./shared/events.ts";
import { projectState } from "./core/state-projections.ts";
import { openDashboard } from "./tui/dashboard.ts";

export { detectProviderFromModel } from "./shared/provider-detection.ts";

const GLOBAL_KEY = "__piUsage" as const;

type GlobalUsageState = { initialized: true };

declare global {
  // eslint-disable-next-line no-var
  var __piUsage: GlobalUsageState | undefined;
}

export interface UsageExtensionOptions {
  deps?: Partial<UsageDeps>;
}

function mergeDeps(overrides?: Partial<UsageDeps>): UsageDeps {
  return { ...createDefaultDeps(), ...overrides };
}

function isCurrentRequest(value: unknown): value is UsageCoreCurrentRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "current" &&
    typeof (value as { reply?: unknown }).reply === "function"
  );
}

export function createUsageExtension(options?: UsageExtensionOptions) {
  const deps = mergeDeps(options?.deps);
  const injectedMode = Boolean(options?.deps);

  return function usageExtension(pi: ExtensionAPI): void {
    if (!injectedMode && globalThis[GLOBAL_KEY]) return;
    if (!injectedMode) globalThis[GLOBAL_KEY] = { initialized: true };

    const core = createUsageCore({
      deps,
      onEmit: (name, payload) => pi.events.emit(name, payload),
    });

    const dashboardBus = {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        pi.events.on(event, handler as (...args: unknown[]) => void),
    };
    (globalThis as { __piUsageBus?: unknown }).__piUsageBus = dashboardBus;

    // Pi hooks -> core
    pi.on("session_start", (_event, ctx) => {
      core.updateModel(ctx.model);
      core.startLiveRuntime();
      void core.bootstrap();
    });

    pi.on("model_select", (event, ctx) => {
      core.updateModel(event.model ?? ctx.model);
      if (core.isLiveProvider(core.getState().currentProviderId)) {
        void core.emitProviderUpdate(true, ctx.signal).catch(() => undefined);
      } else {
        pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
          state: core.getState(),
        });
      }
    });

    pi.on("turn_start", (_event, ctx) => {
      core.updateModel(ctx.model);
      pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
        state: core.getState(),
      });
    });

    pi.on("turn_end", (_event, ctx) => {
      core.updateModel(ctx.model);
      pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, {
        state: core.getState(),
      });
    });

    const rejectArgs = (args: string) => args.trim() !== "";

    pi.registerCommand("usage", {
      description: "Open the usage dashboard",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        if (rejectArgs(args)) {
          ctx.ui.notify(
            "Unknown /usage arguments. Use /usage with no args, or /usage:refresh to force a refresh.",
            "warning",
          );
          return;
        }
        const { cancelScan, scan } = await core.prepareUsageDashboard(false);
        await openDashboard(ctx, core.getState(), cancelScan);
        await scan;
      },
    });

    pi.registerCommand("usage:refresh", {
      description: "Refresh provider usage and open the usage dashboard",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        if (rejectArgs(args)) {
          ctx.ui.notify(
            "Unknown /usage:refresh arguments. /usage:refresh does not take any arguments.",
            "warning",
          );
          return;
        }
        const { cancelScan, scan } = await core.prepareUsageDashboard(true);
        await openDashboard(ctx, core.getState(), cancelScan);
        await scan;
      },
    });

    const unsubscribeRequestCurrent = pi.events.on(
      USAGE_CORE_REQUEST_EVENT,
      (payload: unknown) => {
        if (!isCurrentRequest(payload)) return;
        payload.reply({ state: core.getState() });
      },
    );

    pi.on("session_shutdown", () => {
      core.shutdown();
      unsubscribeRequestCurrent();
      delete globalThis[GLOBAL_KEY];
      delete (globalThis as { __piUsageBus?: unknown }).__piUsageBus;
    });
  };
}

export default createUsageExtension();
```

- [ ] **Step 2: Verify line count**

```bash
wc -l src/index.ts
```

Expected: ~120 lines (slightly above the 100-line target due to command handlers, but all orchestration is gone).

Note: If the line count is slightly above 100, that's acceptable — the goal is that no state management, timers, or orchestration logic lives in this file.

- [ ] **Step 3: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
refactor(index): shrink to thin Pi adapter using UsageCore

All state management, timers, provider orchestration, and offline
scanning now live in src/core/usage-core.ts. index.ts only maps
Pi lifecycle hooks to core method calls.
```

---

### Task 14: Fix behavioral difference — `model_select` emit uses `structuredClone`

**Files:**

- Modify: `src/index.ts`

After Task 13, the `model_select`, `turn_start`, and `turn_end` handlers that emit directly (not through core) use `core.getState()` which already returns a `structuredClone`. Verify this is consistent.

- [ ] **Step 1: Verify `getState()` returns a clone**

In `src/core/usage-core.ts`, the `getState()` function is:
```typescript
function getState(): UsageCoreState {
  return structuredClone(projectState(state));
}
```

This means the `pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, { state: core.getState() })` calls in index.ts produce structuredClone'd payloads — matching the original behavior.

- [ ] **Step 2: Run full test suite**

Run: `pnpm check`
Expected: PASS

If there's a test failure related to the `model_select` emit not going through `onEmit`, it's because the original code calls `emit(USAGE_CORE_UPDATE_CURRENT_EVENT)` which does `structuredClone(projectState(state))`. The new code calls `core.getState()` which does the same thing. Both produce `{ state: UsageCoreState }` payloads. Confirmed correct.

- [ ] **Step 3: Commit (only if changes were needed)**

```
fix(index): ensure model_select/turn emit payloads match original behavior
```

---

### Task 15: Create `tests/usage-core.test.ts`

**Files:**

- Create: `tests/usage-core.test.ts`

- [ ] **Step 1: Write core-specific unit tests (no Pi mocks)**

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createUsageCore, type UsageCore } from "../src/core/usage-core.ts";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCorePayload,
} from "../src/shared/events.ts";
import type { UsageCoreState } from "../src/shared/types.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-core-"));
}

function createTestDeps(root: string, overrides?: Partial<ReturnType<typeof createDefaultDeps>>) {
  return {
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-06-01T12:00:00Z"),
    fetch: vi.fn(async () => {
      throw new Error("network unavailable");
    }) as never,
    ...overrides,
  };
}

describe("UsageCore", () => {
  it("getState returns projected state after construction", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    const s = core.getState();
    expect(s.currentProviderId).toBeNull();
    expect(s.currentProviderSnapshot).toBeNull();
    expect(s.compatibility.currentLiveProviderId).toBeNull();
    expect(s.providers).toEqual([]);
    expect(s.loading).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("updateModel sets currentProviderId", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    core.updateModel({ provider: "openai-codex", id: "gpt-5" });
    expect(core.getState().currentProviderId).toBe("openai-codex");
    rmSync(root, { recursive: true, force: true });
  });

  it("updateModel sets currentModelLabel from id", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    core.updateModel({ provider: "minimax", id: "minimax-pro" });
    expect(core.getState().currentModelLabel).toBe("minimax-pro");
    rmSync(root, { recursive: true, force: true });
  });

  it("isLiveProvider returns true for api-strategy providers", () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    expect(core.isLiveProvider("openai-codex")).toBe(true);
    expect(core.isLiveProvider("minimax")).toBe(true);
    expect(core.isLiveProvider("offline")).toBe(false);
    expect(core.isLiveProvider(null)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("bootstrap emits READY event with providers populated", async () => {
    const root = mkTmp();
    mkdirSync(join(root, "sessions"), { recursive: true });
    const emitted: Array<{ name: string }> = [];
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: (name) => emitted.push({ name }),
    });
    await core.bootstrap();
    expect(emitted.some((e) => e.name === USAGE_CORE_READY_EVENT)).toBe(true);
    expect(core.getState().diagnostics).toContain("live runtime ready");
    rmSync(root, { recursive: true, force: true });
  });

  it("refreshOffline scans sessions and emits state updates", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-06-01T11:00:00Z",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5-codex",
          usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
        },
      })}\n`,
    );
    const emitted: string[] = [];
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: (name) => emitted.push(name),
    });
    await core.refreshOffline(true);
    expect(core.getState().offline.messageCount).toBe(1);
    expect(core.getState().offline.periods.length).toBeGreaterThan(0);
    expect(core.getState().loading).toBe(false);
    expect(emitted.filter((e) => e === USAGE_CORE_UPDATE_CURRENT_EVENT).length).toBeGreaterThanOrEqual(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("refreshOffline respects scan token cancellation", async () => {
    const root = mkTmp();
    mkdirSync(join(root, "sessions"), { recursive: true });
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    const token = { cancelled: true };
    await core.refreshOffline(true, token);
    expect(core.getState().offline.messageCount).toBe(0);
    expect(core.getState().loading).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("shutdown stops polling timer", () => {
    const root = mkTmp();
    const clearInterval = vi.fn();
    const core = createUsageCore({
      deps: createTestDeps(root, {
        setInterval: vi.fn(() => ({}) as unknown as NodeJS.Timeout),
        clearInterval,
        unrefTimer: vi.fn(),
        mkdir: vi.fn(async () => undefined) as never,
        watch: vi.fn(() => ({ close() {} })),
      }),
      onEmit: () => {},
    });
    core.startLiveRuntime();
    core.shutdown();
    expect(clearInterval).toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("populateProviders populates state.providers", async () => {
    const root = mkTmp();
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    await core.populateProviders(true);
    // Even with no credentials, every provider returns an unavailable snapshot
    expect(core.getState().providers.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("prepareUsageDashboard with refresh sets refreshRequested", async () => {
    const root = mkTmp();
    mkdirSync(join(root, "sessions"), { recursive: true });
    const emitted: string[] = [];
    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: (name) => emitted.push(name),
    });
    const { cancelScan, scan } = await core.prepareUsageDashboard(true);
    expect(core.getState().refreshRequested).toBe(true);
    expect(core.getState().diagnostics).toContain("refresh requested");
    cancelScan();
    if (scan) await scan;
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

### Task 16: Verify existing integration tests pass

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
pnpm check
```

All existing tests must pass, especially:
- `tests/index.test.ts` (13 tests) — exercises the full Pi extension API
- `tests/provider-registry.test.ts` — imports `detectProviderFromModel` from `../src/index.ts`

- [ ] **Step 2: Fix any regressions**

Most likely causes of failure:

1. **Import path changes** — `tests/provider-registry.test.ts` imports `detectProviderFromModel` from `../src/index.ts`. The re-export in Task 2 should handle this. If not, check the export statement.

2. **`projectState` import in index.ts** — The new index.ts imports `projectState` for the unused `import` reference. Remove if not needed (only needed if you call `projectState` directly in index.ts — check if the `turn_start`/`turn_end` handlers need it). Actually they use `core.getState()` which already calls `projectState` internally. Remove the `projectState` import from index.ts if the linter complains about unused imports.

3. **Event emission timing** — The `model_select` handler in index.ts now calls `core.emitProviderUpdate(true, ctx.signal)` when a live provider is selected. The old code called `emitProviderUpdate(true, ctx.signal)`. These should behave identically. If a test times out, increase the `waitForCondition` retry count.

4. **`structuredClone` on turn events** — Old code: `emit(USAGE_CORE_UPDATE_CURRENT_EVENT)` → `{ state: structuredClone(projectState(state)) }`. New code: `{ state: core.getState() }` → `structuredClone(projectState(state))`. Identical result.

- [ ] **Step 3: Commit (only if fixes were needed)**

```
fix: resolve integration test regressions from UsageCore extraction
```

---

### Task 17: Final verification and exit criteria

- [ ] **Step 1: Verify no orchestration logic in index.ts**

```bash
grep -n "setInterval\|setTimeout\|clearInterval\|clearTimeout\|\.watch(" src/index.ts
```

Expected: 0 matches

```bash
grep -n "scanOfflineUsage\|buildInsights\|buildPeriods\|mapWithLimit" src/index.ts
```

Expected: 0 matches

```bash
grep -n "providerRefresh\|providerForcePending\|localCommandCodeCost" src/index.ts
```

Expected: 0 matches

- [ ] **Step 2: Verify UsageCore is testable without Pi**

```bash
grep -n "pi-coding-agent\|ExtensionAPI" tests/usage-core.test.ts
```

Expected: 0 matches

- [ ] **Step 3: Verify detectProviderFromModel is still exported**

```bash
grep -n "detectProviderFromModel" src/index.ts
```

Expected: 1 match (the re-export line)

- [ ] **Step 4: Run full check one final time**

```bash
pnpm check
```

Expected: All tests pass, no lint errors, no type errors.

---

## Exit Criteria

- [ ] `index.ts` contains no state management, timers, or orchestration logic
- [ ] `UsageCore` testable without Pi extension API mocks
- [ ] No scattered timer/watcher variables in index.ts
- [ ] All existing tests pass (17 test files + new `usage-core.test.ts`)
- [ ] `mapWithLimit` independently tested in `tests/concurrency.test.ts`
- [ ] `detectProviderFromModel` still exported from package entry point
- [ ] `providerRefresh` mutex pattern preserved in core
- [ ] `pnpm check` passes

## Risk Mitigation

| Risk | Mitigation |
| --- | --- |
| Breaking Pi hook behavior | `tests/index.test.ts` is the integration safety net — all 13 tests must pass |
| Timer leaks | `shutdown()` consolidates cleanup; tested in `usage-core.test.ts` |
| State emission order changes | Tests assert on emission counts and final state values |
| Import cycle (core <-> index) | Core never imports from index; dependency flows one way |
| `detectProviderFromModel` breakage | Re-exported from index.ts; `tests/provider-registry.test.ts` verifies |
| `providerRefresh` race conditions | Mutex pattern copied verbatim from working code |
| `openDashboard` signature mismatch | Uses `(ctx, state, cancelScan)` — verified against `src/tui/dashboard.ts` |
| `model_select` conditional logic | `core.isLiveProvider()` replaces inline `liveProviderIds.has()` check |
