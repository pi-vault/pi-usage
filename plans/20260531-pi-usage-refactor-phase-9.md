# Pi Usage Refactor Phase 9: OpenCode Go Consolidation

## Goal

Consolidate all OpenCode Go parsing, local fallback, and snapshot-building logic into
`src/providers/opencode-go.ts` without changing provider behavior, cache semantics, diagnostics, or source labels.

## Summary

OpenCode Go is the only provider still split across a standalone source module and the provider adapter layer. This
phase removes that split now that the provider runtime and registry already live under `src/providers/`.

Repo review on May 31, 2026 shows the implementation is close, but the plan must be explicit about two contracts:

- helper exports currently used directly by tests
- the runtime wrapper behavior that preserves stale-cache fallback when OpenCode Go returns an unavailable snapshot

## Changes

- Move the full implementation from `src/opencode-go.ts` into `src/providers/opencode-go.ts`.
- Keep these exports from `src/providers/opencode-go.ts`:
  - `createOpenCodeGoProvider`
  - `normalizeWorkspaceId`
  - `filterCookieHeader`
  - `buildOpenCodeGoSnapshot`
- Keep `fetchWithLiveRuntime` as the outer control flow for the provider.
- Preserve the current wrapper behavior inside `createOpenCodeGoProvider`:
  - call `buildOpenCodeGoSnapshot(deps, now, { signal })`
  - when `snapshot.available` is `false`, return `kind: "error"` with the current joined diagnostic message so the
    runtime can preserve stale cache behavior
  - when `snapshot.available` is `true`, return `kind: "ok"` with
    `expiresAt: now + PROVIDER_TTLS_MS["opencode-go"]`
- Update imports and tests to use `src/providers/opencode-go.ts`.
- Remove `src/opencode-go.ts` once all callers have moved.
- Preserve exactly:
  - dashboard-first fallback order
  - dashboard HTML parsing
  - workspace ID normalization
  - cookie filtering
  - SQLite discovery and parsing
  - Pi JSONL fallback
  - rolling 5h, weekly, and monthly local estimation
  - diagnostics wording and source labels

## Usable Checkpoint

- `/usage` shows the same OpenCode Go windows and diagnostics as before.
- Dashboard-backed OpenCode Go still works when the environment is configured.
- Local SQLite and Pi fallback still works when the dashboard source is unavailable.
- Cached OpenCode Go snapshots still remain visible when a later live refresh returns unavailable.

## Acceptance Criteria

- OpenCode Go has no standalone module outside `src/providers/`.
- Provider-specific logic for OpenCode Go lives in one adapter module.
- Helper exports used by repo tests remain available from `src/providers/opencode-go.ts`.
- Cache TTL, stale-cache preservation, and fetch cancellation behavior remain unchanged.
- No new data sources or dashboard behavior are introduced in this phase.

## Test Coverage

- Update `tests/opencode-go.test.ts` to import from `src/providers/opencode-go.ts`.
- Keep existing OpenCode Go tests for:
  - workspace ID normalization
  - cookie filtering
  - dashboard hydration parsing and reset timestamps
  - SQLite plus Pi fallback without double-counting part costs
- Add unit coverage for:
  - invalid dashboard configuration vs dashboard-not-configured diagnostics
  - dashboard auth failure and signed-out HTML diagnostics
  - unsupported SQLite schema diagnostics
  - local estimate window normalization for 5h, weekly, and monthly outputs
- Add provider-level regression coverage in `tests/providers.test.ts` that the consolidated provider still preserves:
  - source labels
  - status handling
  - window keys and labels
  - TTL attachment on live results
  - unavailable snapshot conversion into runtime error/cached behavior
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Offline table semantic changes.
- Renderer extraction.
- Hybrid dashboard redesign.
