# Pi Usage Refactor Phase 10: Offline Data Model and Renderer Extraction

## Goal

Extract dashboard rendering into a dedicated UI module and update the offline aggregation/table model to expose
separate cache-read and cache-write columns while keeping `/usage` fully usable.

## Summary

This phase prepares the final dashboard redesign by separating UI rendering from extension orchestration and by making
the offline table data model match the intended semantics:

- `Tokens = input + output + cacheWrite`
- `↑In = input + cacheWrite`
- `cacheRead` visible separately instead of being folded into the main token totals

The visual structure can remain close to the current table in this phase. The higher-risk card-based redesign lands
after the data model and render boundaries are stable.

## Changes

- Extract the dashboard renderer out of `src/index.ts` into a dedicated UI module.
- Keep `src/index.ts` focused on:
  - Pi lifecycle wiring
  - state refresh
  - model-context updates
  - event emission
  - `/usage` command handling
- Add `currentModelLabel?: string` to `UsageCoreState`.
- Extend `AggregatedUsageRow`:
  - keep `cache`
  - add `cacheRead`
  - add `cacheWrite`
- Update offline aggregation/build-period helpers to carry the new fields through provider and model rows.
- Update the current table renderer to support:
  - `CacheR`
  - `CacheW`
- Keep existing interactions:
  - period tabs
  - provider expansion
  - insights toggle
  - keyboard navigation

## Usable Checkpoint

- `/usage` still opens the existing table-oriented dashboard.
- The table now shows separate cache-read and cache-write values when width allows.
- Token totals and input totals follow the intended semantics consistently.

## Acceptance Criteria

- Offline table semantics are:
  - `Tokens = input + output + cacheWrite`
  - `↑In = input + cacheWrite`
- `cacheRead` is excluded from the main token totals.
- `cacheRead` and `cacheWrite` are both available to the renderer.
- Existing `cache` aggregate remains available where compatibility depends on it.
- The renderer is isolated enough that the next phase can replace layout composition without reworking state wiring.

## Test Coverage

- Extend offline aggregation tests to assert:
  - separate `cacheRead` and `cacheWrite`
  - preserved `cache` aggregate
  - token totals exclude `cacheRead`
- Add render tests for:
  - wide layout showing `CacheR` and `CacheW`
  - compact layouts dropping lower-priority columns
  - provider expansion rows with the new fields available
  - unchanged keyboard behavior and insights toggle
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Codex-style bordered summary card.
- Final hybrid dashboard composition and styling.
