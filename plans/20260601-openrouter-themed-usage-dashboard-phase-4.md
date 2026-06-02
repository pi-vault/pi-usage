# OpenRouter Themed Usage Dashboard Phase 4: Apply Pi Theme and Finalize Navigation

## Goal

Finish the dashboard refactor with Pi theme styling, ANSI-safe layout handling, repaint wiring for live updates, and the final keyboard controls.

## Summary

This phase completes the dashboard renderer. It introduces ANSI styling into width-sensitive output, remaps keyboard ownership between Usage Statistics and Current Usage, and ensures the open dashboard repaints when asynchronous provider or offline-scan updates land.

## Changes

- Pass Pi `theme` and `tui.requestRender()` into the dashboard component through `openDashboard()`.
- Add a lightweight repaint subscription inside the extension so state updates while the dashboard is open trigger `tui.requestRender()`.
- Keep state updates routed through the existing usage-core event path and emit an update after successful offline refresh completion so `/usage:refresh` repaints when scan results arrive.
- Add Pi-themed top and bottom borders, accent bold section titles, border separators, dim inactive tabs, and dim help text.
- Add a separator line after the `Current Usage` header.
- Use ANSI-visible widths for truncation, padding, wrapping, and alignment.
- Default Usage Statistics to `All Time`.
- Remap controls:
  - `Left` and `Right` change Usage Statistics period.
  - `Up` and `Down` change the selected Usage Statistics row.
  - `Enter` or `Space` expands and collapses provider rows.
  - `Tab` and `Shift-Tab` change Current Usage provider.
  - `v` toggles insights.
  - `q` and `Esc` close the dashboard.
- Use `[Shortcut] Action` footer text in this order:
  - `[Tab/Shift-Tab] Provider`
  - `[Left/Right] Period`
  - `[Up/Down] Row`
  - `[Enter/Space] Expand/Collapse`
  - `[v] Insights`
  - `[q/Esc] Close`
- Remove the extra `>` row cursor.
- Highlight only the selected disclosure arrow and provider label.
- Use wide table columns:
  - `Provider / Model`
  - `Sessions`
  - `Msgs`
  - `Cost`
  - `Tokens`
  - `In` with an up-arrow prefix
  - `Out` with a down-arrow prefix
  - `CacheR`
  - `CacheW`
- Keep existing compact breakpoints, meaning narrower widths still collapse to the current reduced column sets rather than forcing the wide layout.
- Dim `In`, `Out`, `CacheR`, `CacheW`, inactive tabs, expanded model rows, formula legend, quota labels, reset text, ratios, notes, and footer help.
- Highlight quota remaining-bar fill and percentage while keeping bars fixed at 24 characters.

## Usable Checkpoint

- The complete dashboard follows Pi's visual language.
- Usage Statistics and Current Usage controls no longer compete for arrow keys.
- OpenRouter and existing providers remain available through Tab-based Current Usage navigation.
- The dashboard stays visually current while open during live refreshes and offline scan completion.

## Acceptance Criteria

- Usage Statistics opens on `All Time`.
- Statistics periods use `Left` and `Right`.
- Current Usage providers use `Tab` and `Shift-Tab`.
- Selected rows have no leading `>` cursor.
- Wide tables show dimmed `CacheR` and `CacheW` columns.
- ANSI styling does not break alignment, truncation, or tab wrapping.
- Quota bars remain vertically aligned after styling.
- `/usage:refresh` repaints the already-open dashboard when async scan results complete.
- Responsive layouts remain readable at narrow widths.

## Test Coverage

- Verify themed ANSI output and visible-width alignment.
- Verify All Time default.
- Verify period, row, expansion, provider-tab, insights, and close controls.
- Verify selected-row styling without an extra cursor.
- Verify split `CacheR` and `CacheW` output in wide layouts.
- Verify aligned themed quota bars.
- Verify the footer shortcut format.
- Verify an open dashboard requests repaint when async state updates land after open.
- Update dashboard and command UI test mocks to provide theme styling helpers plus `tui.requestRender()`.
- Verify responsive layouts.
- Run `pnpm check`.
- Run `git diff --check`.
- Run `pnpm pack --dry-run`.
- Manually verify `/usage` and `/usage:refresh` in Pi.

## Assumptions

- Split `CacheR` and `CacheW` supersede older combined-`Cache` references from earlier umbrella planning.
- Existing Pi theme color roles such as `accent`, `dim`, `muted`, and `text` are sufficient; no new theme tokens are introduced.
- Existing compact table breakpoints remain in place to keep the diff smaller and preserve current narrow-width behavior.

## Deferred Scope

- `pi-status` changes.
- Statusline configuration changes.
- Backward compatibility for `/usage --refresh`.
