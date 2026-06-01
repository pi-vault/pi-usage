# OpenRouter Themed Usage Dashboard Phase 1: Split `/usage` and `/usage:refresh`

## Goal

Replace `/usage --refresh` with a dedicated `/usage:refresh` command without changing provider fetch logic, offline scan behavior, dashboard rendering, or event payload shape.

## Summary

This is the smallest rollout checkpoint. Refresh becomes an explicit Pi command before provider or UI work begins, while the existing dashboard and runtime behavior stay intact.

## Changes

- Remove `parseUsageArgs()` and all `--refresh` parsing from `src/index.ts`.
- Register two commands: `usage` and `usage:refresh`.
- Keep the current early `!ctx.hasUI` return for both commands. Non-UI invocation remains a complete no-op, including no refresh side effects.
- `/usage` behavior:
  - Accept only empty or whitespace-only args.
  - On non-empty args, call `ctx.ui.notify(...)` with a warning that points users to `/usage:refresh`, then return before opening the dashboard.
  - Preserve current sequencing: `await populateProviders(false)`, start `refreshOffline(false, scanToken)` only when offline periods are empty and not already loading, open the dashboard immediately, then await the scan promise after the dashboard closes.
- `/usage:refresh` behavior:
  - Accept only empty or whitespace-only args.
  - On non-empty args, call `ctx.ui.notify(...)` with a warning and return before opening the dashboard.
  - Preserve current refresh semantics: set `state.refreshRequested = true`, append `"refresh requested"` to diagnostics, emit `usage-core:update-current`, `await populateProviders(true)`, start `refreshOffline(true, scanToken)`, open the dashboard, then await the scan promise after close.
- Leave provider order, cache watching, event names, state cloning, and dashboard rendering unchanged.
- Update README usage examples to replace `/usage --refresh` with `/usage:refresh` and clarify cached vs forced-refresh behavior.

## Usable Checkpoint

- `/usage` opens the existing dashboard using cached provider data and only scans offline history when the current code would already do so.
- `/usage:refresh` refreshes live providers, rescans local history, and opens the existing dashboard.
- Existing providers, events, and UI remain unchanged.

## Acceptance Criteria

- `/usage --refresh` is not supported.
- No compatibility or deprecation-specific handling exists for `--refresh`.
- `/usage` and `/usage:refresh` are both registered.
- Both commands reject non-empty args before opening the dashboard.
- Both commands remain complete no-ops when `hasUI` is false.
- Refresh still emits the existing refresh diagnostic and update event.
- Refresh preserves the current ordering of provider refresh, offline scan start, dashboard open, and post-close scan await.

## Test Coverage

- Update command registration expectations to `["usage", "usage:refresh"]`.
- Verify `/usage` still opens the dashboard and does not mark refresh state.
- Verify `/usage:refresh` marks refresh state, emits the existing update event, and opens the dashboard.
- Verify non-empty args for `/usage` warn and do not open the dashboard.
- Verify non-empty args for `/usage:refresh` warn and do not open the dashboard.
- Verify both commands remain side-effect-free when `hasUI` is false.
- Run `pnpm check`.
- Run `git diff --check`.

## Assumptions

- No backward compatibility is kept for `/usage --refresh`.
- Whitespace-only args are treated as empty args.
- `/usage:refresh` takes no positional or option arguments.
- Colon-style command names are acceptable in Pi's command namespace.

## Deferred Scope

- OpenRouter support.
- Quota-row formatting changes.
- Pi theme styling and navigation changes.
