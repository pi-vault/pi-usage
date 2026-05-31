# Pi Usage Refactor Phase 12: Dashboard UI Simplification and Current Usage Navigation

## Goal

Refactor the `/usage` dashboard layout to remove redundant chrome, tighten the usage-table presentation, and replace the
long live-provider list with a navigable `Current Usage` section.

## Summary

- Remove the top-level dashboard title and the bordered `>_ Pi Usage` summary card.
- Make the dashboard a two-section layout:
  - `Usage Statistics` for offline/session history
  - `Current Usage` for live provider usage
- Keep the offline table interaction model intact.
- Add dedicated provider-tab switching for the live section with `[` and `]`.
- Fix the OpenAI/Codex reset timestamp bug by normalizing API `reset_at` values before rendering them.

## Changes

- In `src/ui/dashboard.ts`, stop rendering:
  - `Pi Usage Dashboard`
  - the bordered summary card
  - `Provider:`
  - `Model:`
  - `State:`
  - `Offline:`
- Start the dashboard with a plain `Usage Statistics` heading, followed by the existing timeframe tabs.
- Keep the offline table structure, totals row, period tabs, responsive columns, expand/collapse behavior, and insights
  toggle unchanged.
- Replace the multi-line legend block under the offline table with a separator-joined legend:
  - `Tokens = Input + Output + CacheW • ↑In = Input + CacheW • ↓Out = Output • CacheR = Cache Read • CacheW = Cache Write`
- Render that legend on one line when it fits; otherwise wrap only at ` • ` boundaries into at most two lines.
- Rename `Live providers` to `Current Usage`.
- Replace the full provider list with horizontal provider tabs in registry order, excluding `offline`:
  - `OpenAI/Codex`
  - `MiniMax`
  - `OpenCode Go`
  - `Command Code`
- Show the selected provider with the same bracket treatment as the timeframe tabs.
- Add component-local state for current live-provider selection:
  - `currentUsageProviderIndex`
- Initialize live-provider selection in this priority order:
  - `state.currentProviderSnapshot` when it is non-offline
  - otherwise the first non-offline provider with windows or balances
  - otherwise the first non-offline provider in registry order
- Add `[` and `]` key handling to move the selected provider tab left and right.
- Keep `Tab/←→` for offline timeframe switching and `↑↓` for offline table row movement.
- Render details only for the selected provider instead of printing every provider.
- Update OpenAI/Codex window parsing to normalize `reset_at` with the shared epoch parser instead of passing the raw
  API value through unchanged.

## Current Usage Rendering

- Provider detail heading format becomes:
  - `Provider Name (Plan if present) • status • age`
- Remove `sourceLabel` from all dashboard-visible provider headings.
- Keep existing `planName` normalization rules.
- Render each live usage window on one line:
  - `<label>: <ratio if available> [bar] <left>% left • Resets <date>`
- If ratio data is available, place it before the bar on the same line.
- If `resetAt` is missing, render `• Reset unavailable` on that same line.
- If `unavailableReason` exists, render a plain one-line text row with no bar.
- Render balances below the selected provider’s windows.
- If the selected provider has no windows and no balances, render `No live usage details.`
- Keep diagnostics/notes, but render them after `Current Usage` so the main sections remain compact.
- Treat `formatReset()` as correct for millisecond timestamps; do not change shared reset formatting unless another
  provider reproduces the same issue.

## OpenAI/Codex Reset Verification

- Verify the incorrect `Jan 21, 1970` display as an OpenAI/Codex normalization bug, not a generic formatting bug.
- Ground the implementation on these repo facts:
  - `src/ui/dashboard.ts` formats `resetAt` as epoch milliseconds.
  - `src/providers/runtime.ts` already exposes `parseEpochMs()` for seconds-to-milliseconds normalization.
  - `src/providers/openai-codex.ts` currently reads `raw.reset_at` directly instead of normalizing it.
  - Interpreting a current-era epoch-second value as milliseconds produces the observed January 1970 date.
- Preserve compatibility with either API unit:
  - epoch seconds must be converted to milliseconds
  - epoch milliseconds must remain unchanged
- Keep the fix scoped to OpenAI/Codex parsing unless a second provider demonstrates the same unit mismatch.

## Public Interface Changes

- Keep `UsageCoreState`, `ProviderUsageSnapshot`, `AggregatedUsageRow`, and provider adapters unchanged.
- Keep `sourceLabel` in the data model for provider runtime/cache compatibility; this phase removes it from rendered UI
  only.
- Update `UI_STRINGS.dashboardFooter` to include provider switching help:
  - `Tab/←→ period • [/] provider • ↑↓ row • Enter expand • v insights • q/Esc close`

## Acceptance Criteria

- The dashboard no longer shows `Pi Usage Dashboard`.
- The dashboard no longer shows the bordered `>_ Pi Usage` card.
- The offline section starts with `Usage Statistics`.
- The offline legend is rendered as one joined legend line at wide widths and wraps cleanly at narrow widths.
- The live section is titled `Current Usage`.
- Users can switch live providers without scrolling through every provider’s details.
- Selected live provider details show reset text inline with the bar row.
- Provider headings no longer expose source labels such as `(ChatGPT usage API)`.
- OpenAI/Codex reset rows render current-era dates instead of January 1970 when the API returns epoch seconds.
- Existing offline-table interactions and responsive columns remain intact.

## Test Coverage

- Update `tests/dashboard.test.ts` for:
  - removed title and summary card
  - `Usage Statistics` heading
  - preserved offline table/totals rendering
  - joined legend rendering and wrapped legend rendering
  - `Current Usage` title
  - provider-tab rendering and `[` / `]` navigation
  - selected-provider-only live detail rendering
  - inline reset text on bar rows
  - source-label removal from visible headings
  - balances under the selected provider
  - updated footer help text
- Update `tests/index.test.ts` integration assertions so `/usage` no longer expects:
  - `Pi Usage Dashboard`
  - the old live-provider list formatting
- Update OpenAI/Codex provider tests to use realistic `reset_at` epoch-second fixtures and assert normalized
  millisecond `resetAt` values.
- Add a regression test that would have rendered a 1970 reset date before the normalization fix.
- Keep other provider-level tests unchanged unless they assert on old rendered UI text.
- Run `pnpm check`.
- Run `git diff --check`.

## Assumptions

- `Usage Statistics` should be a plain compact section heading, not a boxed or banner-style header.
- Removing the summary card also removes its visible model/loading/offline metadata from the dashboard.
- Live-provider switching is intentionally separate from offline-table navigation in this phase.
- OpenAI/Codex may return `reset_at` in epoch seconds or milliseconds, so the parser must accept both.
