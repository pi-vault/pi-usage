# Pi Usage Extension Phase 1: Setup Repo

## Goal

Make `pi-usage` installable and loadable in Pi, with `/usage` opening a real dashboard shell. This phase establishes the shared framework that later offline and provider phases build on.

## Scope

- Scaffold a TypeScript Pi extension package with `package.json`, `tsconfig.json`, `index.ts`, `src/`, and tests.
- Configure Pi loading with `pi: { "extensions": ["./index.ts"] }`.
- Register `/usage` and parse `/usage --refresh`.
- Add dependency injection for `fetch`, file reads/writes, file existence, command execution, home directory, environment, clock, and timers.
- Define core public/internal types:
  - `UsageProviderAdapter`
  - `ProviderFetchStrategy`
  - `ProviderFetchOutcome`
  - `ProviderUsageSnapshot`
  - `UsageWindow`
  - `ProviderBalance`
  - dashboard state and unavailable-provider state
- Add a provider registry with placeholder providers for Offline, OpenAI/Codex, MiniMax, OpenCode Go, and Command Code.
- Add event names and basic event emission:
  - `usage-core:ready`
  - `usage-core:update-current`
- Add a global init guard on `globalThis.__piUsage`.
- Add a minimal TUI dashboard shell with empty offline stats and visible unavailable provider cards.

## Usable Checkpoint

- Pi can load the package without runtime errors.
- `/usage` opens a simple dashboard shell.
- Future provider cards are visible and marked unavailable with the phase where each will be implemented.
- `/usage --refresh` is accepted and reflected in diagnostics, even though no live providers are implemented yet.

## Acceptance Criteria

- `pi: { "extensions": ["./index.ts"] }` points at the real entry point.
- `index.ts` exports a Pi extension function and registers `/usage`.
- Running `/usage` does not require network, credentials, or session files.
- Duplicate extension initialization is ignored in real mode through the global guard.
- Tests can inject fake dependencies without touching real files or network.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Load the extension locally in Pi and verify `/usage` opens the dashboard shell.
- Verify `/usage --refresh` does not throw and marks the current render as refresh-requested.

## Out Of Scope

- Session-file aggregation.
- Live provider fetching.
- Cache lock/backoff implementation.
- Insights view.
- Status-bar rendering.
