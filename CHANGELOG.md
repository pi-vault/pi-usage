# Changelog

All notable changes to `@pi-vault/pi-usage` are documented here.

## v0.5.1

- updated `@earendil-works/pi-coding-agent` to `^0.80.2`, `@earendil-works/pi-tui` to `^0.80.2`, `@types/node` to `^26.0.0`, and `vitest` to `^4.1.9`

## v0.5.0

- added `usage.json` provider toggles so you can disable live providers you do not want queried
- added dashboard insights for project, active skill, and MCP server breakdowns
- grouped insight rows by category and cap each insight section with an overflow summary to keep the dashboard readable
- improved offline session parsing to extract project names, active skills, MCP server names, and builtin tool usage more accurately
- fixed dashboard readability around usage statistics spacing and grouped insight rendering
- updated runtime requirements and tooling to Node `>=24.15.0`, refreshed dependencies, and aligned CI with Node 24 and pnpm 11.8.0

## v0.4.0

- reorganized the extension around a dedicated `UsageCore`, with the package entrypoint reduced to a thin Pi adapter
- split shared provider runtime behavior into reusable utilities for timeouts, JSON parsing, and percentage handling
- broke the OpenCode Go provider into focused modules for dashboard scraping, SQLite reads, and quota window calculation
- extracted dashboard formatting and table layout logic into smaller TUI modules
- expanded automated coverage for orchestration, state projection, runtime utilities, dashboard formatting, and provider integrations
- kept the public usage flow stable: `/usage`, `/usage:refresh`, exported events, and exported types remain intact

## v0.3.0

- added StepFun live usage support
- refreshed the README and provider setup guidance
- refactored the source tree into the current `core`, `providers`, `shared`, and `tui` layout
- updated dependencies, toolchain config, and Node requirements for the current runtime model

## v0.2.0

- added the `/usage:refresh` command for explicit live refreshes
- added OpenRouter live usage and balance support
- reworked the dashboard UI with Pi-themed styling, improved quota formatting, and current-provider tabs
- improved MiniMax usage parsing and compatibility window handling

## v0.1.1

- added the request/reply event API for consumers that need the latest usage snapshot
- exported the event and type modules through `package.json`
- added regression coverage for the event API surface

## v0.1.0

- introduced the initial Pi usage dashboard with offline aggregation across local sessions
- added live provider support for OpenAI/Codex, MiniMax, OpenCode Go, and Command Code
- added the interactive TUI dashboard, provider registry, packaging metadata, release workflow, and test/lint/typecheck automation
- published the first public package documentation and project license
