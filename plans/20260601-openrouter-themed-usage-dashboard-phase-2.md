# OpenRouter Themed Usage Dashboard Phase 2: Align Current Usage Quota Rows

## Goal

Redesign Current Usage quota rows so bars align vertically and follow the intended Codex-style presentation without changing providers, balances, diagnostics, or keyboard controls.

## Summary

This phase is limited to renderer and renderer-test updates for Current Usage rows. It improves the live-provider display independently of the larger ANSI-safe themed renderer refactor.

## Changes

- Refactor Current Usage window formatting in `src/ui/dashboard.ts`.
- Keep provider order, selected-window order, provider navigation, and balance-row rendering unchanged.
- Compute the shared label width from only windows that render quota bars, meaning windows without `unavailableReason`.
- Keep fixed-width bars at the current width of 24 characters.
- Render available quota windows as:
  - `labelPad: [bar] NN% left (resets HH:mm)`
  - `labelPad: [bar] NN% left (resets HH:mm on D MMM)` when the reset date is not the local render date
  - `labelPad: [bar] NN% left (reset unavailable)` when `resetAt` is absent
- Append ` - used/limit` only when `used`, `limit`, and `unit` are all present, reusing the existing ratio formatting rules.
- Render unavailable windows as plain text `label: unavailableReason` with no bar, no reset text, and no ratio.
- Keep the layout structure ready for dimmed reset text and ratio styling in Phase 4, but do not add theme logic in this phase.
- Render remaining percentage as `Math.round(Math.max(0, 100 - usedPercent))` so displayed output is always an integer `NN% left` even when providers emit fractional `usedPercent`.

## Usable Checkpoint

- Current Usage retains the existing arrow-based provider navigation.
- Providers with differently sized labels show aligned quota bars.
- Existing live-provider data remains visible, including optional `used/limit` ratios and unchanged balance rows.

## Acceptance Criteria

- Opening brackets for all available quota bars align vertically.
- Bars remain equal width.
- Available quota rows always display integer `NN% left`.
- Reset text uses compact local-time formatting:
  - same local day: `resets HH:mm`
  - different local day: `resets HH:mm on D MMM`
- Missing reset time renders `(reset unavailable)`.
- Optional ratio text appears after the reset text.
- Unavailable windows render without a bar and do not affect available-row bar alignment.

## Test Coverage

- Verify alignment for mixed label lengths such as `5h` and `Weekly`.
- Verify decimal `usedPercent` values render rounded integer remaining percentages.
- Verify ratio and no-ratio windows.
- Verify same-day reset formatting, cross-day reset formatting, and reset-unavailable formatting.
- Build expected reset strings using the local runtime timezone in tests rather than hardcoding a timezone-sensitive literal.
- Verify unavailable windows do not render a bar and do not affect quota-row alignment.
- Run `pnpm check`.
- Run `git diff --check`.

## Assumptions

- English month abbreviations are acceptable for this phase.
- Narrow-width behavior remains whole-line truncation; ANSI-safe visible-width handling remains deferred.
- Only quota-bar rows are aligned in this phase; balance rows remain unchanged.

## Deferred Scope

- OpenRouter support.
- Theme colors and ANSI-safe width helpers.
- Final keyboard-control remapping.
