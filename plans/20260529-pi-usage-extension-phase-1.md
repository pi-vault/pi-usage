# Pi Usage Extension Phase 1: Setup Repo

## Goal

Make `pi-usage` installable and loadable in Pi, with `/usage` opening a real dashboard shell. This phase establishes the shared framework that later offline and provider phases build on.

Use `/Users/lanh/Developer/pi-vault/pi-custom-providers` only as the repo-structure reference: package layout, pnpm/Vitest/Biome tooling, strict TypeScript setup, and Pi loading from `src/`. Do not borrow implementation behavior from that repo.

## Scope

- Scaffold a TypeScript Pi extension package with:
  - `package.json`
  - `pnpm-lock.yaml`
  - `pnpm-workspace.yaml`
  - `tsconfig.json`
  - `vitest.config.ts`
  - `biome.json`
  - `src/`
  - `tests/`
- Configure Pi loading with `pi: { "extensions": ["./src/index.ts"] }`.
- Configure package metadata:
  - publishable package metadata for `@pi-vault/pi-usage`
  - `type: "module"`
  - `engines.node: ">=22"`
  - `files: ["src", "README.md"]`
  - scripts: `format`, `lint`, `typecheck`, `test`, `check`, and `pack:dry-run`.
- Use latest dependency versions verified on 2026-05-30:
  - `@earendil-works/pi-coding-agent@0.78.0`
  - `@earendil-works/pi-tui@0.78.0`
  - `@biomejs/biome@2.4.16`
  - `vitest@4.1.7`
  - `typescript@6.0.3`
  - `@types/node@25.9.1`
- Add `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies and dev dependencies.
- Configure TypeScript for strict Node ESM with Node16 module resolution, no emit, and test/source includes.
- Configure Biome with two-space indentation, 100-character line width, and source/test includes.
- Register `/usage` from `src/index.ts` and parse `/usage --refresh`.
- Treat unknown `/usage` options as a user-facing warning and do not open the dashboard.
- Return without side effects when `/usage` is run without UI.
- Add dependency injection for `fetch`, file reads/writes, file existence, directory reads, directory creation, rename, stat, command execution, home directory, environment, clock, and timers.
- Define core public/internal types:
  - `ProviderId`
  - `UsageProviderAdapter`
  - `ProviderFetchStrategy`
  - `ProviderFetchOutcome`
  - `ProviderUsageSnapshot`
  - `UsageWindow`
  - `ProviderBalance`
  - `UsageCoreState`
  - dashboard state and unavailable-provider state
- Add a provider registry with placeholder providers for Offline, OpenAI/Codex, MiniMax, OpenCode Go, and Command Code.
- Add event names and basic event emission:
  - `usage-core:ready`
  - `usage-core:update-current`
- Emit event payloads as `{ state }`.
- Keep optional compatibility fields on emitted state so existing event consumers can clear safely when no current live provider data exists.
- Add a global init guard on `globalThis.__piUsage`:
  - enabled in real Pi loading
  - bypassed when tests inject dependencies
  - cleared on `session_shutdown`
- Add a minimal TUI dashboard shell with:
  - empty offline stats
  - visible unavailable provider cards
  - refresh-requested diagnostic when `/usage --refresh` is used
  - `q` / Esc close handling
  - width-safe rendering for narrow terminals

## Usable Checkpoint

- Pi can load the package without runtime errors.
- `/usage` opens a simple dashboard shell.
- Future provider cards are visible and marked unavailable with the phase where each will be implemented.
- `/usage --refresh` is accepted and reflected in diagnostics, even though no live providers are implemented yet.
- The package structure matches the current `pi-vault` package style used by `pi-custom-providers`.

## Acceptance Criteria

- `pi: { "extensions": ["./src/index.ts"] }` points at the real entry point.
- `src/index.ts` exports a Pi extension function and registers `/usage`.
- Running `/usage` does not require network, credentials, or session files.
- Running `/usage` without UI does nothing and does not throw.
- Running `/usage --refresh` marks the current dashboard state as refresh-requested.
- Unknown `/usage` options produce a warning and do not open the dashboard.
- Duplicate extension initialization is ignored in real mode through the global guard.
- Tests can inject fake dependencies without touching real files or network.
- Placeholder provider snapshots are unavailable and include a short diagnostic naming the future implementation phase.

## Verification

- `pnpm test` passed.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm check` passed.
- `NPM_CONFIG_CACHE=/private/tmp/pi-usage-npm-cache pnpm pack:dry-run` passed.
- Plain `pnpm pack:dry-run` can fail on this machine because `/Users/lanh/.npm` contains root-owned files; use the temp-cache command above until the external npm cache is fixed.
- Load the extension locally in Pi and verify `/usage` opens the dashboard shell.
- Verify `/usage --refresh` does not throw and marks the current render as refresh-requested.

## Test Coverage

- Entry tests:
  - extension registers `/usage`
  - package `pi.extensions` points to `./src/index.ts`
  - duplicate real-mode initialization is ignored
  - injected-dependency mode bypasses the global guard
  - `session_shutdown` clears timers and guard
- Command tests:
  - `/usage` without UI is a no-op
  - `/usage` renders without files, credentials, or network
  - `/usage --refresh` marks state/render diagnostics
  - unknown args warn and stop
- State and registry tests:
  - placeholder providers exist for Offline, OpenAI/Codex, MiniMax, OpenCode Go, and Command Code
  - live provider placeholders are unavailable
  - events emit `{ state }`

## Out Of Scope

- Session-file aggregation.
- Live provider fetching.
- Cache lock/backoff implementation.
- Insights view.
- Status-bar rendering.
