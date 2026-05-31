# Pi Usage Refactor Phase 10: Renderer Extraction and Cache-Aware Table Model

## Goal

Extract dashboard rendering into dedicated UI modules and expose separate cache-read and cache-write values through the
offline table model while keeping `/usage` fully usable.

## Summary

The offline scanner already enforces the intended token semantics:

- `Tokens = input + output + cacheWrite`
- `↑In = input + cacheWrite`
- `cacheRead` excluded from the main token totals

Phase 10 should therefore focus on renderer extraction, state plumbing, and cache-aware row mapping rather than
changing aggregation math.

## Changes

- Extend `AggregatedUsageRow`:
  - keep `cache`
  - add `cacheRead`
  - add `cacheWrite`
- Add `currentModelLabel?: string` to `UsageCoreState`.
- Extract dashboard code out of `src/index.ts` into a small `src/ui/` boundary:
  - `dashboard-model.ts` owns `buildPeriods` and row mapping
  - `dashboard.ts` owns the dashboard component, pure render logic, and `openDashboard`
- Keep `src/index.ts` focused on:
  - Pi lifecycle wiring
  - provider and offline refresh
  - model-context updates
  - event emission
  - `/usage` command handling
- Replace closure-local active-model tracking with `state.currentModelLabel`, updated from `model?.id ?? model?.name`
  on:
  - `session_start`
  - `model_select`
  - `turn_start`
  - `turn_end`
- Preserve the current dashboard structure and interactions in this phase:
  - period tabs
  - provider expansion
  - insights toggle
  - keyboard navigation
  - provider status list
- Keep the current width breakpoints and make cache fields visible only in the wide layout:
  - `>= 90`: include `cacheR:` and `cacheW:` in provider and expanded model rows
  - `65-89`: keep the current cost/tokens/input/output view without cache fields
  - `< 65`: keep the current tiny summary rows

## Implementation Notes

- Do not change `scanOfflineUsage` token math in this phase.
- `buildPeriods` should map offline totals as:
  - `input` copied from offline totals as-is
  - `output` copied from offline totals as-is
  - `tokens` copied from offline totals as-is
  - `cacheRead` copied through
  - `cacheWrite` copied through
  - `cache = cacheRead + cacheWrite`
- Keep existing event names, provider IDs, compatibility payload fields, and provider fetch behavior unchanged.

## Usable Checkpoint

- `/usage` still opens the existing table-oriented dashboard.
- The wide layout now shows separate cache-read and cache-write values.
- Token totals and input totals continue to follow the existing intended semantics.
- The renderer is isolated enough for phase 11 to replace layout composition without reworking extension wiring.

## Acceptance Criteria

- `AggregatedUsageRow` exposes `cacheRead` and `cacheWrite` while preserving `cache`.
- `UsageCoreState` exposes `currentModelLabel`.
- `src/index.ts` no longer owns dashboard rendering or period-row mapping.
- Wide dashboard rows show `cacheR` and `cacheW`.
- Compact and tiny layouts remain usable and retain current interactions.
- `/usage` behavior remains unchanged apart from the added wide-layout cache visibility.

## Test Coverage

- Add dashboard-model tests to assert:
  - separate `cacheRead` and `cacheWrite`
  - preserved `cache` aggregate
  - row token totals exclude `cacheRead`
  - row input totals include `cacheWrite`
- Add dashboard render tests for:
  - wide layout showing `cacheR:` and `cacheW:`
  - compact and tiny layouts dropping cache fields
  - provider expansion rows carrying the new values
  - unchanged keyboard behavior and insights toggle
- Keep `/usage` integration coverage to confirm the extension still opens the extracted dashboard.
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Codex-style bordered summary card.
- Final hybrid dashboard composition and styling.
- Changes to provider adapters or offline scanning behavior beyond type plumbing and tests.
