# Pi Usage Refactor Phase 8: Provider Runtime Extraction and Offline Adapter Normalization

## Goal

Split the live-provider runtime and registry into `src/providers/` modules, and represent offline as a first-class
provider adapter, without changing `/usage` behavior or layout.

## Summary

`src/providers.ts` currently mixes four concerns:

- registry assembly
- shared live-runtime/cache machinery
- provider-specific fetch logic
- placeholder/offline handling

This phase establishes the new architecture boundary while keeping the UI stable. The intent is to reduce coupling
first, then make higher-risk UI and data-model changes in later phases.

Repo check on May 31, 2026 confirms the extraction is technically ready, but the plan must explicitly preserve current
provider capability semantics:

- OpenAI/Codex does not have verified monthly live usage in the integrated ChatGPT usage API path.
- MiniMax does not expose a monthly window in the current remains API integration.
- OpenCode Go continues to expose monthly usage through its existing dashboard/local-estimate logic.
- Command Code exposes current billing-cycle usage and remaining credits, not a verified calendar-month usage window.

## Changes

- Create `src/providers/runtime.ts` and move shared runtime helpers there:
  - `providerCacheDir`
  - unavailable snapshot helper
  - cached/stale snapshot helper
  - JSON read/write helpers
  - lock acquisition and stale-lock recovery
  - retry-after parsing
  - common numeric/date parsing helpers
  - shared live-runtime fetch wrapper
- Create `src/providers/index.ts` for registry assembly and shared provider exports.
- Create provider modules for:
  - `src/providers/openai-codex.ts`
  - `src/providers/minimax.ts`
  - `src/providers/command-code.ts`
  - `src/providers/offline.ts`
- Add `src/providers/opencode-go.ts` only as a thin adapter wrapper around the existing `buildOpenCodeGoSnapshot`
  module in this phase.
- Treat offline as a first-class provider adapter with `id: "offline"`.
- Keep the operational distinction between offline and live providers, but expose the same adapter shape so registry
  and state code can reason about all providers uniformly.
- Keep `src/providers.ts` as a compatibility barrel that re-exports from `src/providers/index.ts`.
- Leave current OpenCode Go parsing logic in `src/opencode-go.ts` for this phase; do not consolidate it yet.

## Provider Capability Rules To Preserve

- OpenAI/Codex:
  - keep the synthetic `monthly` window entry
  - keep it marked unavailable with the existing phase-neutral reason
  - do not introduce dashboard scraping, billing inference, or renamed semantics in this phase
- MiniMax:
  - preserve interval and weekly request-window normalization only
  - do not add any monthly placeholder or inferred monthly window
- OpenCode Go:
  - preserve existing 5h, weekly, and monthly behavior exactly as emitted today
- Command Code:
  - preserve the existing `Current cycle` window and balance behavior
  - do not rename `Current cycle` to `Monthly`
  - do not reinterpret billing-cycle values as calendar-month usage

## Usable Checkpoint

- `/usage` renders the same dashboard and supports the same commands and interactions as before.
- Provider fetch behavior, cache behavior, and watcher behavior stay unchanged.
- Offline is now represented through the provider architecture even though the user-visible UI remains the same.

## Acceptance Criteria

- `src/providers.ts` no longer contains the full provider implementation body.
- Shared runtime logic exists in one module and is reused by OpenAI, MiniMax, and Command Code.
- Registry order remains:
  - Offline
  - OpenAI/Codex
  - MiniMax
  - OpenCode Go
  - Command Code
- No changes to event names or compatibility fields.
- No change to `/usage` rendering beyond incidental wording from Phase 7.
- Provider capability semantics remain unchanged:
  - OpenAI monthly remains unavailable
  - MiniMax remains non-monthly
  - OpenCode Go keeps monthly support
  - Command Code keeps billing-cycle wording

## Test Coverage

- Update provider tests to use the new registry location without changing behavioral expectations.
- Add or update tests asserting:
  - offline adapter is included in the registry
  - provider labels and order are unchanged
  - OpenAI auth resolution, cache TTL, backoff, and unavailable monthly placeholder remain unchanged
  - MiniMax host fallback, response normalization, and non-monthly behavior remain unchanged
  - OpenCode Go adapter wrapping preserves current monthly behavior
  - Command Code cookie parsing, partial live data handling, local fallback, and `Current cycle` wording remain unchanged
  - watcher logic still reacts only to live-provider snapshot files
- Run `npm run check`.
- Run `git diff --check`.

## Notes

- No UI or data-model replan is required in this phase.
- The only material replan from repo review is to make the provider capability constraints explicit so the extraction
  does not accidentally normalize distinct concepts like unavailable monthly usage and billing-cycle balances.

## Deferred Scope

- Merging OpenCode Go parser and adapter.
- Changing offline aggregation semantics or table columns.
- Redesigning the dashboard layout.
- Introducing new live data sources for OpenAI/Codex monthly usage.
- Reframing Command Code billing-cycle data as monthly usage.
