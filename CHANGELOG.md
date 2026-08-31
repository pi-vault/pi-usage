# Changelog

All notable changes to `@pi-vault/pi-usage` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-08-31

### Added

- Parsed Command Code rolling `5h` and weekly rate-limit windows from the live usage API and surfaced them in the Current Usage tab.

### Changed

- Split Command Code live usage parsing into `src/providers/command-code/usage-parser.ts` so the provider module focuses on HTTP and snapshot assembly.
- Strengthened Command Code numeric parsing with a `strictFinite` helper that rejects empty-string inputs and ignores non-finite values.
- Updated `@biomejs/biome` to `^2.5.11`, `@earendil-works/pi-coding-agent` to `^0.84.4`, `@earendil-works/pi-tui` to `^0.84.4`, `@types/node` to `^26.4.0`, `typebox` to `^1.3.22`, `typescript` to `^7.0.2`, and `vitest` to `^4.1.11`. The `biome.json` schema URL was updated to match the new biome version.

### Fixed

- Recognized the `minimax-openai` model provider string as a MiniMax usage provider so models such as `MiniMax-M3` exposed through a MiniMax OpenAI-compatible proxy are attributed correctly.

### Compatibility

- Public API unchanged: `/usage`, `/usage:refresh`, exported events, exported types all retain their previous surface.
- Peer dependencies unchanged: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.
- Node.js requirement unchanged: `>=24.15.0`.

## [0.7.0] - 2026-07-28

### Changed

- Updated the `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` development ranges to `^0.82.0`; the lockfile resolves both to 0.82.1.
- Migrated StepFun Step Plan tracking to `platform.stepfun.ai` browser-session credentials and monthly Credit usage.
- Replaced the unsupported Insights period selector with compact all-time category navigation.

### Fixed

- Matched the current StepFun browser request headers and cookie casing.
- Kept Insights category navigation visible in constrained-width footers.
- Kept open dashboard overlays synchronized with completed provider and offline-history updates.

### Removed

- StepFun username/password login and legacy `.com` dashboard requests.

## [0.6.0] - 2026-07-05

### Added

- Tabbed overlay layout for the dashboard with three tabs: Usage Statistics, Current Usage, and Insights. The tab bar follows the same pattern as `@earendil-works/pi-extension-manager` for visual consistency.
- Independent period selector for the Insights tab so the Insights period no longer follows the Usage Statistics period.
- Per-tab contextual footer strings in `src/shared/constants.ts` so each tab shows only the keys that are relevant in that tab.
- `DashboardTheme.inverse()` and `DashboardTheme.bg()` methods to support the new overlay rendering primitives.
- New `src/tui/overlay-render.ts` module that owns `frame()`, `renderTabBar()`, and `pad()` utilities for drawing the overlay chrome.

### Changed

- Refactored `src/tui/dashboard.ts` to render the new tabbed overlay layout. The `render()`, `handleInput()`, and `activeTab` state replace the previous stacked-section renderer.
- Dashboard description in `package.json` updated to "Pi extension that tracks Pi usage across your sessions in one dashboard".
- Updated `@biomejs/biome` to `^2.5.2`, `@earendil-works/pi-coding-agent` to `^0.80.3`, `@earendil-works/pi-tui` to `^0.80.3`, `@types/node` to `^26.1.0`, and `typebox` to `^1.3.3`.
- Moved `typebox` from `peerDependencies` to `devDependencies` since it is only used for compile-time schema construction in this package.

### Removed

- `v` keyboard shortcut for toggling the Insights panel — Insights is now its own tab, reached via `Tab` / `Shift-Tab`.
- Legacy dashboard footer and border character constants from `src/shared/constants.ts` (replaced by per-tab footer strings and `overlay-render`).
- Unused helper code that was only consumed by the legacy single-scroll renderer.

### Compatibility

- Node.js requirement unchanged: `>=24.15.0`.
- Peer dependencies unchanged: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.
- Public API unchanged: `/usage`, `/usage:refresh`, exported events, exported types all retain their previous surface.
- `biome.json` schema URL updated to `https://biomejs.dev/schemas/2.5.2/schema.json` to match the new biome version.

## [0.5.1] - 2026-06-25

### Changed

- Updated `@earendil-works/pi-coding-agent` to `^0.80.2`, `@earendil-works/pi-tui` to `^0.80.2`, `@types/node` to `^26.0.0`, and `vitest` to `^4.1.9`.

## [0.5.0] - 2026-06-22

### Added

- `usage.json` provider toggles so you can disable live providers you do not want queried.
- Dashboard insights for project, active skill, and MCP server breakdowns.
- Grouped insight rows by category, with an overflow summary per section to keep the dashboard readable.
- Improved offline session parsing to extract project names, active skills, MCP server names, and builtin tool usage more accurately.

### Fixed

- Dashboard readability around usage statistics spacing and grouped insight rendering.

### Compatibility

- Runtime requirement updated to Node `>=24.15.0`.
- CI aligned with Node 24 and pnpm 11.8.0.

## [0.4.0] - 2026-06-14

### Added

- Expanded automated coverage for orchestration, state projection, runtime utilities, dashboard formatting, and provider integrations.

### Changed

- Reorganized the extension around a dedicated `UsageCore`, with the package entrypoint reduced to a thin Pi adapter.
- Split shared provider runtime behavior into reusable utilities for timeouts, JSON parsing, and percentage handling.
- Broke the OpenCode Go provider into focused modules for dashboard scraping, SQLite reads, and quota window calculation.
- Extracted dashboard formatting and table layout logic into smaller TUI modules.

### Compatibility

- Public usage flow kept stable: `/usage`, `/usage:refresh`, exported events, and exported types remain intact.

## [0.3.0] - 2026-06-08

### Added

- StepFun live usage support.

### Changed

- Refreshed the README and provider setup guidance.
- Refactored the source tree into the current `core`, `providers`, `shared`, and `tui` layout.
- Updated dependencies, toolchain config, and Node requirements for the current runtime model.

## [0.2.0] - 2026-06-01

### Added

- The `/usage:refresh` command for explicit live refreshes.
- OpenRouter live usage and balance support.

### Changed

- Reworked the dashboard UI with Pi-themed styling, improved quota formatting, and current-provider tabs.
- Improved MiniMax usage parsing and compatibility window handling.

## [0.1.1] - 2026-05-31

### Added

- The request/reply event API for consumers that need the latest usage snapshot.
- Exported the event and type modules through `package.json`.
- Regression coverage for the event API surface.

## [0.1.0] - 2026-05-31

### Added

- Initial Pi usage dashboard with offline aggregation across local sessions.
- Live provider support for OpenAI/Codex, MiniMax, OpenCode Go, and Command Code.
- Interactive TUI dashboard, provider registry, packaging metadata, release workflow, and test/lint/typecheck automation.
- First public package documentation and project license.
