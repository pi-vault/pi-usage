# OpenRouter Themed Usage Dashboard Phase 4: Apply Pi Theme and Finalize Navigation

## Goal

Finish the dashboard refactor with Pi theme styling, ANSI-safe layout handling, the requested table treatment, and the final keyboard controls.

## Summary

This is the highest-complexity phase because styling introduces ANSI escape sequences into width-sensitive table rendering while navigation ownership changes at the same time.

## Changes

- Pass Pi `theme` and `tui.requestRender()` into the dashboard component.
- Add Pi-themed top and bottom borders, accent bold title, border separators, dim inactive tabs, and dim help text.
- Use ANSI-visible widths for truncation, padding, and alignment.
- Default Usage Statistics to `All Time`.
- Remap controls:
  - `Left` and `Right` change Usage Statistics period.
  - `Up` and `Down` change the selected Usage Statistics row.
  - `Enter` or `Space` expands and collapses provider rows.
  - `Tab` and `Shift-Tab` change Current Usage provider.
  - `v` toggles insights.
  - `q` and `Esc` close the dashboard.
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
  - `Cache`
- Replace wide-layout `CacheR` and `CacheW` with one combined `Cache` column while preserving underlying metrics.
- Dim `In`, `Out`, `Cache`, inactive tabs, expanded model rows, formula legend, quota labels, reset text, ratios, and footer help.
- Highlight quota remaining-bar fill and percentage.
- Preserve responsive compact layouts.

## Usable Checkpoint

- The complete dashboard follows Pi's visual language.
- Usage Statistics and Current Usage controls no longer compete for arrow keys.
- OpenRouter and existing providers remain available through Tab-based Current Usage navigation.

## Acceptance Criteria

- Usage Statistics opens on `All Time`.
- Statistics periods use `Left` and `Right`.
- Current Usage providers use `Tab` and `Shift-Tab`.
- Selected rows have no leading `>` cursor.
- Wide tables show one dimmed `Cache` column.
- ANSI styling does not break alignment or truncation.
- Quota bars remain vertically aligned after styling.
- Responsive layouts remain readable at narrow widths.

## Test Coverage

- Verify themed ANSI output and visible-width alignment.
- Verify All Time default.
- Verify period, row, expansion, provider-tab, insights, and close controls.
- Verify selected-row styling without an extra cursor.
- Verify combined `Cache` output.
- Verify aligned themed quota bars.
- Verify responsive layouts.
- Run `pnpm check`.
- Run `git diff --check`.
- Run `pnpm pack --dry-run`.
- Manually verify `/usage` and `/usage:refresh` in Pi.

## Deferred Scope

- `pi-status` changes.
- Statusline configuration changes.
- Backward compatibility for `/usage --refresh`.
