# OpenRouter Themed Usage Dashboard Phase 1: Replace Refresh Argument With Registered Command

## Goal

Replace `/usage --refresh` with the registered `/usage:refresh` command while keeping the current providers and dashboard unchanged.

## Summary

This is the smallest rollout checkpoint. Refresh becomes an explicit Pi command before provider or UI work begins.

## Changes

- Remove `--refresh` parsing from `src/index.ts`.
- Keep `/usage` for normal dashboard opening and treat any arguments as unsupported.
- Register `/usage:refresh` for forced live-provider refresh, offline rescan, and dashboard opening.
- Keep non-UI command handling as a no-op.
- Update README command examples.

## Usable Checkpoint

- `/usage` opens the existing dashboard.
- `/usage:refresh` refreshes live providers, rescans local history, and opens the dashboard.
- Existing providers, events, and UI remain unchanged.

## Acceptance Criteria

- `/usage --refresh` is not supported.
- No compatibility or deprecation-specific handling exists for `--refresh`.
- `/usage` and `/usage:refresh` are both registered.
- Refresh still emits the existing refresh diagnostic and update event.

## Test Coverage

- Update command registration expectations.
- Verify `/usage` opens the dashboard.
- Verify `/usage:refresh` marks refresh state and opens the dashboard.
- Verify unsupported `/usage` arguments stop before opening the dashboard.
- Verify both commands remain side-effect-free without interactive UI.
- Run `pnpm check`.
- Run `git diff --check`.

## Deferred Scope

- OpenRouter support.
- Quota-row formatting changes.
- Pi theme styling and navigation changes.
