# Architecture Improvement — Design Spec

## Summary

Five incremental refactors that deepen shallow modules, eliminate duplication, and improve testability across the pi-usage codebase. Each phase ships as its own PR, ordered bottom-up from safe mechanical changes to structural reorganization.

## Constraint

`@pi-vault/pi-status` imports from `@pi-vault/pi-usage/events` and `@pi-vault/pi-usage/types`. It accesses `state.compatibility.currentLiveProviderSnapshot.windows` (specifically `window.key`, `window.usedPercent`, `window.unavailableReason`). The emitted event payload shape must remain stable across all phases.

## Phase Ordering

```
Phase 1: Deepen provider fetch runtime (mechanical, low risk)
Phase 2: Split OpenCode Go provider (mechanical, uses Phase 1 utilities)
Phase 3: Extract dashboard formatting + table layout (independent)
Phase 4: Collapse derived state in UsageCoreState (medium risk, pi-status compat)
Phase 5: Deepen index.ts into UsageCore module (medium risk, largest change)
```

Dependencies:
- Phase 2 depends on Phase 1 (uses new runtime utilities)
- Phase 5 benefits from Phase 4 (smaller state object to manage)
- Phase 3 is independent, can run any time after Phase 1

---

## Phase 1 — Deepen the Provider Fetch Runtime

**Goal:** Absorb duplicated HTTP/parsing boilerplate from 6 providers into `runtime.ts`, giving callers more leverage per import.

### Scope

**Files modified:**
- `src/providers/runtime.ts` — add 4 shared utilities
- `src/providers/openai-codex.ts` — remove timeout/signal/JSON boilerplate
- `src/providers/minimax.ts` — remove timeout/signal/JSON/clampPercent boilerplate
- `src/providers/stepfun.ts` — remove timeout/signal/JSON/clampPercent boilerplate
- `src/providers/opencode-go.ts` — remove local `toNumber`, `parseTs`, `clampPct`; import from runtime
- `src/providers/command-code.ts` — remove timeout/signal/JSON/cookie boilerplate
- `src/providers/openrouter.ts` — remove timeout/signal/JSON boilerplate

**Tests added:**
- Unit tests for `fetchWithTimeout`, `readJsonObject`, `clampPercent`, `extractCookieValue`

### New Runtime Functions

```typescript
// Replaces ~15 lines of timeout/signal wiring duplicated in every provider
export async function fetchWithTimeout(
  deps: UsageDeps,
  url: string,
  options: RequestInit & { signal?: AbortSignal },
  timeoutMs?: number,
): Promise<Response>

// Replaces JSON.parse + typeof check pattern
export async function readJsonObject(
  res: Response,
): Promise<Record<string, unknown> | undefined>

// Replaces local clampPercent/clampPct definitions
export function clampPercent(value: number): number

// Replaces cookie parsing logic in opencode-go, command-code, stepfun
export function extractCookieValue(
  cookieHeader: string,
  names: string[],
): string | undefined
```

### Approach

Each provider's `fetchLive` function currently contains this pattern:

```typescript
const timeout = new AbortController();
const timer = deps.setTimeout(() => timeout.abort(), 5_000);
const combinedSignal = signal
  ? AbortSignal.any([signal, timeout.signal])
  : timeout.signal;
const res = await deps.fetch(url, { ..., signal: combinedSignal })
  .finally(() => deps.clearTimeout(timer));
```

After: providers call `fetchWithTimeout(deps, url, opts)` and get a `Response` back.

Similarly, this JSON-parse pattern appears in 5 providers:

```typescript
const data = await res.json().catch(() => undefined) as Record<string, unknown> | undefined;
if (!data) return { kind: "error", message: "..." };
```

After: providers call `readJsonObject(res)` and get `Record<string, unknown> | undefined`.

### Exit Criteria

- No provider file contains inline AbortController/timeout/signal wiring
- No provider file contains inline `res.json().catch(() => undefined)` + type check
- `opencode-go.ts` has no local `toNumber`, `parseTs`, or `clampPct`
- All existing provider tests pass unchanged

---

## Phase 2 — Split the OpenCode Go Provider

**Goal:** Decompose the largest provider (558 lines, 5 concerns) into focused internal modules, each independently testable.

### Scope

**Files created:**
- `src/providers/opencode-go/dashboard-scraper.ts` — HTML fetching, regex extraction, redirect following
- `src/providers/opencode-go/sqlite-reader.ts` — schema detection, cost row aggregation
- `src/providers/opencode-go/window-calculator.ts` — rolling 5h, weekly, monthly window computation

**Files modified:**
- `src/providers/opencode-go.ts` → moves to `src/providers/opencode-go/index.ts` (orchestrator)
- `src/providers/index.ts` — update import path if needed
- `tests/provider-opencode-go.test.ts` — update import paths

**Tests added:**
- Unit tests for dashboard-scraper (mock fetch, verify regex extraction)
- Unit tests for sqlite-reader (mock deps.openReadonlySqlite, verify cost aggregation)
- Unit tests for window-calculator (pure function tests with cost row arrays)

### Module Responsibilities

| Module | Input | Output | Lines (approx) |
|--------|-------|--------|-----------------|
| `dashboard-scraper.ts` | deps, cookie, workspaceId | `CostRow[]` or error | ~120 |
| `sqlite-reader.ts` | deps, dbPath | `CostRow[]` or error | ~130 |
| `window-calculator.ts` | `CostRow[]`, now, limits | `LiveUsageWindow[]` | ~100 |
| `index.ts` (orchestrator) | deps, input | `ProviderFetchOutcome` | ~120 |

### Approach

The orchestrator's `fetchLive` function becomes:

1. Try dashboard scraper → get cost rows
2. If dashboard unavailable, try SQLite reader → get cost rows
3. If both unavailable, try Pi offline scan → get cost rows
4. Pass cost rows to window calculator → get windows
5. Build snapshot

Each internal module has its own seam: the orchestrator can call any combination of sources and the window calculator doesn't know where data came from.

### Exit Criteria

- `src/providers/opencode-go/index.ts` ≤ 150 lines
- Each internal module is independently testable with its own fixtures
- Existing `provider-opencode-go.test.ts` passes unchanged
- `normalizeWorkspaceId` and `filterCookieHeader` remain public exports

---

## Phase 3 — Extract Dashboard Formatting + Table Layout

**Goal:** Pull formatting functions and table rendering logic out of `dashboard.ts` (768 lines) into independently testable modules.

### Scope

**Files created:**
- `src/tui/formatters.ts` — pure formatting functions
- `src/tui/table-layout.ts` — column definitions, width calculation, row rendering

**Files modified:**
- `src/tui/dashboard.ts` — remove formatting/table logic, import from new modules

**Tests added:**
- `tests/formatters.test.ts` — unit tests for each formatter
- `tests/table-layout.test.ts` — unit tests for column selection, row rendering at various widths

### Formatters Module

```typescript
// src/tui/formatters.ts
export function formatAge(ms: number): string
export function formatCurrency(value: number): string
export function formatAbbrev(value: number): string
export function formatResetCompact(resetAt: number, now: number): string
```

These are currently private helpers inside `dashboard.ts`. They are pure functions with no dependencies beyond `Date`.

### Table Layout Module

```typescript
// src/tui/table-layout.ts
export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  align: "left" | "right";
  format: (value: number) => string;
}

export function selectColumns(width: number): ColumnDef[]
export function renderHeaderRow(columns: ColumnDef[], theme: DashboardTheme): string
export function renderDataRow(
  label: string,
  data: AggregatedUsageRow,
  columns: ColumnDef[],
  theme: DashboardTheme,
  options?: { indent?: boolean; bold?: boolean },
): string
export function computeLabelWidth(columns: ColumnDef[], totalWidth: number): number
```

### dashboard-model.ts Decision

`dashboard-model.ts` (58 lines) contains two functions: `toRow` and `buildPeriods`. These transform offline scan results into `AggregatedUsagePeriod[]`. They remain as-is — they serve a distinct purpose (data transformation vs rendering) and are already tested independently.

### Exit Criteria

- `dashboard.ts` ≤ 450 lines
- `dashboard.test.ts` passes unchanged (rendering output identical)
- Formatters and table layout have dedicated unit tests
- No formatting logic remains private inside dashboard.ts

---

## Phase 4 — Collapse Derived State in UsageCoreState

**Goal:** Remove 5 stored derived fields from the runtime state object, computing them at emission time instead. Eliminates `syncCompatibility()` and its missed-call bug surface.

### Constraint

The `UsageCoreState` TypeScript type exported from `@pi-vault/pi-usage/types` must not change shape. `pi-status` imports this type and accesses `state.compatibility.currentLiveProviderSnapshot`. The emitted event payloads must include all derived fields as before.

### Scope

**Files modified:**
- `src/shared/types.ts` — no changes to exported types (compat constraint)
- `src/index.ts` — delete `syncCompatibility()`, change state to exclude derived fields at runtime, compute them in `emit()`

**Files created:**
- `src/core/state-projections.ts` — pure functions that compute derived fields

### Approach

Create pure projection functions:

```typescript
// src/core/state-projections.ts
export function computeCurrentSnapshot(
  providers: ProviderUsageSnapshot[],
  currentProviderId: ProviderId | null,
): ProviderUsageSnapshot | null

export function computeCompatibility(
  snapshot: ProviderUsageSnapshot | null,
): { currentLiveProviderId: ProviderId | null; currentLiveProviderSnapshot: ProviderUsageSnapshot | null }

export function computeUsageField(
  snapshot: ProviderUsageSnapshot | null,
): { provider?: string; usage?: CurrentUsageCompatibility }

export function projectState(state: InternalState): UsageCoreState
```

The runtime state object becomes an `InternalState` type (not exported) with only source-of-truth fields:
- `refreshRequested`, `generatedAt`, `loading`
- `offline`, `insights`
- `currentProviderId`, `currentModelLabel`
- `providers` (array of snapshots)
- `diagnostics`

The `emit()` function calls `projectState(internalState)` to produce the full `UsageCoreState` shape with all derived fields populated, then clones and emits.

### What Gets Deleted

- `syncCompatibility()` function (~33 lines)
- All 5 call sites of `syncCompatibility()` in index.ts
- Direct mutations to `state.currentProviderSnapshot`, `state.compatibility.*`, `state.provider`, `state.usage`

### Exit Criteria

- No `syncCompatibility` function exists
- Derived fields computed only at emission time via `projectState()`
- Event payload shape unchanged (verified by existing tests)
- `pi-status` types still compile against the export

---

## Phase 5 — Deepen index.ts into a UsageCore Module

**Goal:** Extract state management and orchestration from the extension entry point into a testable `UsageCore` module. index.ts becomes a thin adapter mapping Pi hooks to core calls.

### Scope

**Files created:**
- `src/core/usage-core.ts` — state + orchestration module
- `src/shared/concurrency.ts` — `mapWithLimit` utility

**Files modified:**
- `src/index.ts` — shrinks to Pi adapter (~80-100 lines)
- `tests/index.test.ts` — keep integration tests, add core-specific unit tests

**Tests added:**
- `tests/usage-core.test.ts` — unit tests for core without Pi extension API mocks

### UsageCore Interface

```typescript
// src/core/usage-core.ts
export interface UsageCoreOptions {
  deps: UsageDeps;
  onStateChange: (state: UsageCoreState) => void;
}

export interface UsageCore {
  bootstrap(): Promise<void>;
  refresh(force?: boolean, signal?: AbortSignal): Promise<void>;
  refreshOffline(force?: boolean): Promise<void>;
  updateModel(model: { provider?: string; id?: string; name?: string } | undefined): void;
  getState(): UsageCoreState;
  startLivePolling(): void;
  shutdown(): void;
}

export function createUsageCore(options: UsageCoreOptions): UsageCore
```

### What index.ts Becomes

```typescript
// src/index.ts (after)
export function createUsageExtension(options?: UsageExtensionOptions) {
  const deps = mergeDeps(options?.deps);
  return function usageExtension(pi: ExtensionAPI): void {
    if (!injectedMode && globalThis[GLOBAL_KEY]) return;
    if (!injectedMode) globalThis[GLOBAL_KEY] = { initialized: true };

    const core = createUsageCore({
      deps,
      onStateChange: (state) => pi.events.emit(USAGE_CORE_UPDATE_CURRENT_EVENT, { state }),
    });

    // Map Pi hooks to core
    pi.on("session_start", (_, ctx) => { core.updateModel(ctx.model); core.startLivePolling(); core.bootstrap(); });
    pi.on("model_select", (e, ctx) => { core.updateModel(e.model ?? ctx.model); core.refresh(true, ctx.signal); });
    pi.on("turn_start", (_, ctx) => core.updateModel(ctx.model));
    pi.on("turn_end", (_, ctx) => core.updateModel(ctx.model));

    // Commands
    pi.registerCommand("usage", { ... });
    pi.registerCommand("usage:refresh", { ... });

    // Cleanup
    pi.on("session_shutdown", () => { core.shutdown(); delete globalThis[GLOBAL_KEY]; });
  };
}
```

### Other Changes

- `ScanToken` → standard `AbortController`
- Lifecycle cleanup centralized in `core.shutdown()` (timers, watchers, subscriptions)
- `mapWithLimit` extracted to `src/shared/concurrency.ts`
- `globalThis.__piUsageBus` stays in `index.ts` (it's a Pi-specific concern)

### Exit Criteria

- `index.ts` ≤ 100 lines
- `UsageCore` testable without Pi extension API mocks
- No scattered timer/watcher variables in index.ts
- All existing tests pass

---

## Verification Strategy

Each phase:
1. Run `pnpm check` (lint + typecheck + tests) — must pass
2. Run `pnpm pack:dry-run` — ensure package contents unchanged
3. Verify pi-status compiles against new types (Phases 4 and 5)

## Risk Matrix

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low — pure extraction, no behavior change | Tests are behavioral; identical output expected |
| 2 | Low — reorganization, same logic | Integration test covers the full fetch path |
| 3 | Low — extraction from UI, no logic change | Snapshot tests catch rendering differences |
| 4 | Medium — changes state lifecycle | `projectState()` is pure and testable; event shape asserted in tests |
| 5 | Medium — largest restructuring | Core tested in isolation; index.test.ts remains as integration safety net |
