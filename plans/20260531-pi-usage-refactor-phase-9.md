# Pi Usage Refactor Phase 9: OpenCode Go Consolidation

## Goal

Merge the OpenCode Go parser and provider adapter into `src/providers/opencode-go.ts`, aligning it with the new
provider-module architecture without changing the provider's behavior.

## Summary

OpenCode Go is the only provider still split across a dedicated parser/snapshot module and the provider registry. That
split no longer buys much once the registry/runtime code has moved into `src/providers/`.

This phase consolidates the provider into one module while preserving all currently verified behavior:

- dashboard HTML parsing
- workspace ID normalization
- cookie filtering
- SQLite fallback
- Pi JSONL fallback
- rolling 5h, weekly, and monthly local estimation

## Changes

- Move the current contents of `src/opencode-go.ts` into `src/providers/opencode-go.ts`.
- Collapse `buildOpenCodeGoSnapshot` into the provider adapter module instead of keeping a separate snapshot builder.
- Update imports and registry assembly so OpenCode Go is constructed like the other providers.
- Remove the old `src/opencode-go.ts` module once the new provider module is fully wired.
- Preserve the current diagnostics model, source labels, and fallback order.

## Usable Checkpoint

- `/usage` shows the same OpenCode Go windows and diagnostics as before.
- Dashboard-backed OpenCode Go still works when the environment is configured.
- Local SQLite and Pi fallback still works when the dashboard source is unavailable.

## Acceptance Criteria

- OpenCode Go has no standalone parser module outside `src/providers/`.
- Provider-specific logic for OpenCode Go lives in one adapter module.
- Cache TTL, stale-cache preservation, and fetch cancellation behavior remain unchanged.
- No new data sources or dashboard behavior are introduced in this phase.

## Test Coverage

- Keep existing OpenCode Go dashboard-source tests:
  - workspace ID normalization
  - cookie filtering
  - signed-out and auth-failure handling
  - hydration parsing and reset timestamps
- Keep existing SQLite and Pi fallback tests:
  - DB resolution
  - direct and fallback cost parsing
  - unsupported schema handling
  - local estimate normalization
- Add regression coverage that the consolidated provider still returns the same snapshot shape and source labels.
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Offline table semantic changes.
- Renderer extraction.
- Hybrid dashboard redesign.
