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

## Changes

- Create `src/providers/runtime.ts` and move shared runtime helpers there:
  - `providerCacheDir`
  - unavailable snapshot helper
  - cached/stale snapshot helper
  - JSON read/write helpers
  - lock acquisition and stale-lock recovery
  - retry-after parsing
  - common numeric/date parsing helpers
- Create `src/providers/index.ts` for registry assembly and shared provider exports.
- Create provider modules for:
  - `src/providers/openai-codex.ts`
  - `src/providers/minimax.ts`
  - `src/providers/command-code.ts`
  - `src/providers/offline.ts`
- Treat offline as a first-class provider adapter with `id: "offline"`.
- Keep the operational distinction between offline and live providers, but expose the same adapter shape so registry
  and state code can reason about all providers uniformly.
- Keep `src/providers.ts` as a compatibility barrel that re-exports from `src/providers/index.ts`.
- Leave current OpenCode Go parsing logic in its existing module for this phase; if needed, use only a thin adapter
  wrapper from the new registry.

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

## Test Coverage

- Update provider tests to use the new registry location without changing behavioral expectations.
- Add or update tests asserting:
  - offline adapter is included in the registry
  - provider labels and order are unchanged
  - OpenAI auth resolution, cache TTL, and backoff remain unchanged
  - MiniMax host fallback and response normalization remain unchanged
  - Command Code cookie parsing, partial live data handling, and local fallback remain unchanged
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Merging OpenCode Go parser and adapter.
- Changing offline aggregation semantics or table columns.
- Redesigning the dashboard layout.
