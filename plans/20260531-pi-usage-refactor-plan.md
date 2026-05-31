# Pi Usage Refactor Plan

## Summary

- Split the monolithic provider implementation into a `src/providers/` directory where every provider, including offline, is represented by a provider adapter.
- Merge the OpenCode Go parser and provider adapter into a single `src/providers/opencode-go.ts` module.
- Remove all phase-development metadata and related strings from types, provider snapshots, registry assembly, diagnostics, and UI.
- Redesign `/usage` as a hybrid dashboard: a Codex-style bordered live-summary card above a tmustier-style responsive offline usage table.

## Implementation Changes

### Provider structure

- Create `src/constants.ts` for shared static values:
  - provider IDs, display labels, and registry order
  - cache TTLs, lock timings, and retry/backoff defaults
  - dashboard tab labels, footer strings, and help text
- Replace the internals of `src/providers.ts` with a `src/providers/` directory:
  - `src/providers/index.ts`: provider registry assembly and shared exports
  - `src/providers/runtime.ts`: cache dir helpers, JSON read/write helpers, lock handling, cached/stale snapshot helpers, retry-after parsing, and common numeric/date helpers
  - `src/providers/offline.ts`: offline adapter that exposes the offline source through the same adapter shape as live providers
  - `src/providers/openai-codex.ts`
  - `src/providers/minimax.ts`
  - `src/providers/opencode-go.ts`: merged HTML parsing, SQLite/Pi fallback collection, and adapter fetch logic
  - `src/providers/command-code.ts`
- Keep `src/providers.ts` as a compatibility barrel that re-exports from `src/providers/index.ts` to minimize import churn.

### OpenCode Go

- Move the current contents of `src/opencode-go.ts` into `src/providers/opencode-go.ts`.
- Collapse `buildOpenCodeGoSnapshot` into the adapter module instead of keeping a separate parser-only file.
- Preserve current behavior:
  - dashboard HTML parsing
  - workspace ID and cookie normalization
  - SQLite discovery and parsing
  - Pi local-session fallback
  - current 5h, weekly, and monthly cost-window estimation logic

### Offline as a provider adapter

- Treat offline as a first-class provider adapter in the registry with `id: "offline"`.
- Keep its operational role distinct from live providers, but make its interface consistent with other adapters so registry/state code can reason about all providers uniformly.
- Continue building offline period aggregations from `scanOfflineUsage`, but route offline snapshot/state assembly through the adapter layer where practical.

### Remove phase metadata

- Remove `phase` from:
  - `ProviderUsageSnapshot`
  - `UsageProviderAdapter`
  - `UnavailableProviderState`
- Delete all phase-related support code and strings:
  - `phaseByProvider`
  - `Unavailable in Phase 3`
  - `will be implemented in Phase X`
  - any other phase-development wording in provider fallbacks or tests
- Replace the OpenAI monthly placeholder text with a phase-neutral unavailable reason such as `Unavailable from ChatGPT usage API`.

## Dashboard/UI Spec

### Layout

- Extract dashboard rendering out of `src/index.ts` into a dedicated UI module so `src/index.ts` remains focused on extension wiring, refresh flow, state updates, and Pi event handling.
- Render two major sections in order:
  - a Codex-style bordered summary card for the focused live provider
  - a tmustier-style responsive table for offline usage history

### Live summary card

- Use box-drawing characters and aligned key/value rows similar to the Codex status panel.
- Focus the summary card on:
  - `state.currentProviderSnapshot` if available
  - otherwise the first non-offline provider that has windows or balances
  - otherwise the first non-offline provider in registry order
- Show:
  - `>_ Pi Usage`
  - active model label
  - focused provider label
  - source/status/diagnostic
  - plan name and balances when present
  - refresh/loading state
  - scanned-file count and offline message count
  - Codex-style progress bars for live usage windows

### Offline usage table

- Keep the tmustier interaction model:
  - tabs for `Today`, `This Week`, `Last Week`, `All Time`
  - `▸` and `▾` expansion affordance for providers
  - right-aligned numeric columns
  - totals row separated by horizontal rules
  - `v` toggles insights
- Full-width columns are exactly:
  - `Provider / Model`
  - `Sessions`
  - `Msgs`
  - `Cost`
  - `Tokens`
  - `↑In`
  - `↓Out`
  - `CacheR`
  - `CacheW`
- Responsive column sets are fixed to:
  - wide: `Sessions Msgs Cost Tokens ↑In ↓Out CacheR CacheW`
  - medium: `Sessions Msgs Cost Tokens ↑In ↓Out`
  - compact: `Sessions Cost Tokens`
  - narrow: `Cost Tokens`

### Token semantics

- Offline table semantics are fixed to:
  - `Tokens = input + output + cacheWrite`
  - `↑In = input + cacheWrite`
- Exclude `cacheRead` from the main token totals.
- Show `cacheRead` and `cacheWrite` in separate columns.
- Keep the existing aggregate `cache` field in data structures where compatibility benefits from it.

## Public Interface Changes

- `AggregatedUsageRow` becomes additive:
  - keep `cache`
  - add `cacheRead`
  - add `cacheWrite`
- Add `currentModelLabel?: string` to `UsageCoreState` so the summary card does not depend on closure-local model state.
- Preserve:
  - existing provider IDs
  - existing emitted event names
  - existing compatibility payload fields unless a concrete implementation conflict appears

## Test Plan

- Update provider tests to assert behavior is unchanged after module splitting:
  - provider registry order and labels remain the same
  - offline adapter is included in the registry
  - OpenAI Codex auth resolution, caching, and backoff behavior remain unchanged
  - MiniMax host fallback and response handling remain unchanged
  - Command Code cookie parsing and enrichment behavior remain unchanged
  - OpenCode Go behavior remains unchanged after merging parser and adapter
- Extend offline aggregation tests to assert:
  - `cacheRead` and `cacheWrite` are tracked separately
  - displayed token semantics remain `input + output + cacheWrite`
  - the compatibility `cache` aggregate still exists
- Add dashboard rendering tests for:
  - absence of any phase text
  - phase-neutral OpenAI monthly placeholder text
  - focused-provider summary-card selection
  - full-width table rendering `CacheR` and `CacheW`
  - responsive layout column dropping
  - provider expansion behavior
  - insights empty states and footer/help text

## Assumptions

- `command-cde` in the original request is treated as `command-code`.
- OpenCode Go parsing and adapter logic are tightly coupled enough that a merged module is the cleaner boundary.
- Offline remains a distinct source of truth operationally, but it should conform to the same provider-adapter interface for simpler registry/state handling.
