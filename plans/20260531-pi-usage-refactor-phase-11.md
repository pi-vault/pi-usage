# Pi Usage Refactor Phase 11: Dashboard Formatting and Live-Usage Presentation

## Goal

Ship the final `/usage` dashboard redesign with implementation-locked formatting, live-usage presentation, legend
placement, and provider labeling.

## Summary

- Phase 10 architecture remains the baseline:
  - provider registry is modular
  - offline aggregation semantics are stable
  - dashboard rendering is already isolated in `src/ui/`
- This phase should not change provider/runtime architecture or offline aggregation math.
- This phase should finalize:
  - exact numeric and datetime formatting
  - summary-card composition
  - live-usage progress-bar rendering
  - legend and diagnostics placement
  - provider heading and plan-name display rules

## Changes

- Keep the two major dashboard areas:
  - a Codex-style bordered summary card for the focused live provider
  - a tmustier-style responsive offline usage table
- Render the full dashboard in this order:
  - dashboard title
  - summary card
  - offline usage table
  - legends
  - diagnostic notes
  - full live-provider list
  - footer/help text
- Keep focused-provider selection order:
  - `state.currentProviderSnapshot`
  - otherwise the first non-offline provider with windows or balances
  - otherwise the first non-offline provider in registry order
- Keep the full live-provider list below the table so users can inspect all providers, not only the focused one.

## Formatting Rules

- Currency everywhere is fixed to two decimal places:
  - `$1.75`
  - `$0.00`
  - `$10.00`
- Reset timestamps everywhere use local machine time in this exact shape:
  - `Resets Jun 7, 2026 11:47 AM`
- Token-sized numbers should be rounded and abbreviated:
  - `425k`
  - `3.1M`
  - `236M`
- Provider headings use this exact display shape:
  - `Provider Name (Plan if present) • status (source label) • 4s old`
- Diagnostics should not be inlined into provider headings.
- Diagnostic notes should be rendered under the legends and prefixed with `*`.
- Legends must explicitly define:
  - `Tokens = Input + Output + CacheW`
  - `↑In = Input + CacheW`
  - `↓Out = Output`
  - `CacheR = Cache Read`
  - `CacheW = Cache Write`

## Live Usage Rendering

- Replace textual live-window rows with Codex-style horizontal bar rows.
- Bars show remaining quota, not used quota:
  - compute `leftPercent = max(0, 100 - usedPercent)`
  - render `XX% left`
- When a window has `used` and `limit`, show the ratio before the bar using normalized formatting:
  - requests: `0/4.5k requests`
  - money: `$4.29/$10.00`
- When a window has only `usedPercent`, omit the ratio and render the bar plus `% left`.
- When a window has `unavailableReason`, render a plain text row with no bar.
- Remove the synthetic OpenAI/Codex monthly window entirely; only show real ChatGPT API windows.
- Keep MiniMax and Command Code plan names next to the provider name:
  - `Command Code (Go)`
  - `MiniMax (Plus)`
- For MiniMax, normalize display plan text by stripping a leading `MiniMax ` prefix if the API returns one, but do not
  invent a remap for legacy names.
- Keep `providerLabel`, `planName`, `sourceLabel`, and `diagnostics` in the existing state shape; compose the final
  display label in the UI.

## Offline Table

- Keep current tabs, navigation, expand/collapse, insights toggle, totals row, and responsive column sets.
- Apply normalized formatting in the table:
  - `Cost` uses `$0.00`
  - `Tokens`, `↑In`, `↓Out`, `CacheR`, and `CacheW` use abbreviated numerals
  - `Sessions` and `Msgs` stay integer counts
  - empty or unavailable cells render as `-`
- Place the explanatory legend immediately below the totals row, before diagnostics and footer/help text.

## Public Interface Changes

- No new public types are required.
- Keep `UsageCoreState`, `ProviderUsageSnapshot`, and `AggregatedUsageRow` unchanged.
- Provider adapters only change where presentation data is wrong for the new UI:
  - OpenAI/Codex stops emitting the synthetic monthly window
  - MiniMax may normalize `planName` by removing a redundant `MiniMax ` prefix
  - Command Code keeps the existing short plan aliases:
    - `Go`
    - `Pro`
    - `Max`
    - `Ultra`

## Acceptance Criteria

- Currency formatting is consistent across summary card, table, balances, and live-provider rows.
- Reset times are human-readable and local-time formatted.
- Large token counts are abbreviated in the table and live displays.
- OpenAI/Codex no longer shows a monthly limit row.
- MiniMax and Command Code provider headings show plan names inline.
- Diagnostics appear under legends as note lines instead of being appended to headings.
- Live windows render as remaining-quota horizontal bars.
- Existing table interactions and responsive layouts remain intact.

## Test Coverage

- Update dashboard render tests for:
  - focused-provider summary-card selection
  - provider heading format with plan, status, source, and age
  - fixed two-decimal currency formatting
  - abbreviated token rendering in the table
  - reset timestamp formatting as `Resets Mon D, YYYY h:mm AM/PM`
  - progress bars showing `% left`
  - OpenAI/Codex rendering without a monthly row
  - diagnostics rendered under legends with `*` prefix
  - responsive column sets unchanged at current breakpoints
  - provider expansion and insights behavior unchanged
- Update provider tests for:
  - OpenAI/Codex no longer emitting the synthetic monthly window
  - MiniMax display-plan normalization for prefixed API names
  - Command Code plan labels remaining short aliases
- Run `pnpm check`.
- Run `git diff --check`.

## Assumptions

- Reset timestamps use the local timezone of the machine and show no timezone suffix.
- `-` means unavailable or not present, not numeric zero.
- MiniMax may still return legacy plan strings; preserve unexpected API text after removing only a redundant
  `MiniMax ` prefix.
