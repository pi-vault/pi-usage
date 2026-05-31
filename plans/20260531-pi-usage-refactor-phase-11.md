# Pi Usage Refactor Phase 11: Hybrid Dashboard Redesign

## Goal

Ship the final `/usage` dashboard redesign: a Codex-style live summary card above a tmustier-style responsive offline
usage table, using the architecture and data-model changes from earlier phases.

## Summary

By this point:

- phase-development metadata is gone
- providers are modular
- offline participates in the provider architecture
- OpenCode Go is consolidated
- offline table semantics and renderer boundaries are stable

This final phase changes the visual composition and presentation while keeping the underlying provider/runtime behavior
intact.

## Changes

- Add a Codex-style bordered summary card using box-drawing characters and aligned key/value rows.
- Place the summary card above the offline usage table.
- Focus the summary card on:
  - `state.currentProviderSnapshot` when available
  - otherwise the first non-offline provider with windows or balances
  - otherwise the first non-offline provider in registry order
- Show in the summary card:
  - `>_ Pi Usage`
  - active model label
  - focused provider label
  - source, status, and diagnostic
  - plan name and balances when present
  - refresh/loading status
  - scanned file count and offline message count
  - Codex-style progress bars for live usage windows
- Keep the tmustier interaction model for the offline table:
  - tabs for `Today`, `This Week`, `Last Week`, `All Time`
  - `▸` and `▾` expansion affordances
  - totals row separated by horizontal rules
  - `v` toggles insights
- Use fixed responsive column sets:
  - wide: `Sessions Msgs Cost Tokens ↑In ↓Out CacheR CacheW`
  - medium: `Sessions Msgs Cost Tokens ↑In ↓Out`
  - compact: `Sessions Cost Tokens`
  - narrow: `Cost Tokens`

## Usable Checkpoint

- `/usage` ships with the final hybrid visual design and remains fully interactive.
- Live provider information is easier to scan in the summary card.
- Offline history remains available in the table with the new cache-aware semantics.

## Acceptance Criteria

- The top summary card clearly surfaces the focused live provider.
- Progress bars render for percentage-based live windows.
- Table interactions, insights mode, and close behavior remain intact.
- No phase-oriented wording reappears anywhere in the UI.
- The redesigned dashboard remains usable on narrow terminals.

## Test Coverage

- Add render tests for:
  - focused-provider selection order
  - summary-card key/value content
  - progress-bar rendering for live windows
  - wide, medium, compact, and narrow column layouts
  - provider expansion rows
  - insights empty states and footer/help text
  - absence of phase wording anywhere in the final UI
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- No additional provider integrations.
- No status-bar redesign.
- No new reporting modes beyond the interactive dashboard.
