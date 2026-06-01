# OpenRouter Themed Usage Dashboard Phase 2: Align Current Usage Quota Rows

## Goal

Redesign Current Usage quota rows so bars align vertically and follow the Codex-style presentation without changing providers or keyboard controls.

## Summary

This phase improves the live-provider display independently of the larger ANSI-safe themed renderer refactor.

## Changes

- Refactor live-window formatting in `src/ui/dashboard.ts`.
- Compute the widest visible window label and pad shorter labels before rendering bars.
- Keep fixed-width bars that visualize remaining quota.
- Render available windows as:
  - `label: [bar] X% left (resets HH:mm[ on D MMM]) - used/limit`
- Dim reset text and the optional ratio when theme support arrives in Phase 4; keep the layout structure ready for styling now.
- Render `(reset unavailable)` when reset time is absent.
- Keep unavailable windows as plain text rows without bars.

## Usable Checkpoint

- Current Usage retains the existing provider navigation.
- Providers with differently sized labels show aligned progress bars.
- Existing live-provider data remains visible, including optional used/limit ratios.

## Acceptance Criteria

- Opening brackets for all available quota bars align vertically.
- Bars remain equal width.
- The percentage remains `X% left`.
- Reset text uses compact local-time formatting.
- Optional ratio text appears after reset text.

## Test Coverage

- Verify alignment for mixed label lengths such as `5h` and `Weekly`.
- Verify ratio and no-ratio windows.
- Verify reset and reset-unavailable formatting.
- Verify unavailable windows do not render a bar.
- Run `pnpm check`.
- Run `git diff --check`.

## Deferred Scope

- OpenRouter support.
- Theme colors and ANSI-safe width helpers.
- Final keyboard-control remapping.
