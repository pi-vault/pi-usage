# @pi-vault/pi-usage

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-usage)](https://www.npmjs.com/package/@pi-vault/pi-usage)
[![Quality](https://github.com/pi-vault/pi-usage/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-usage/actions/workflows/quality.yml)
[![Node >= 24.15.0](https://img.shields.io/badge/node-%3E%3D24.15.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Track Pi usage across your sessions in one dashboard. `@pi-vault/pi-usage` combines offline history with live provider snapshots so you can review costs, tokens, session activity, current quotas, and usage insights without leaving Pi.

![Pi usage dashboard showing the aggregated usage table for the "All Time" period, current usage quota bars for OpenAI/Codex, and the keyboard navigation hints at the bottom](docs/assets/dashboard-ui.png)

## Install

```bash
pi install npm:@pi-vault/pi-usage
```

Then reload Pi:

```bash
/reload
```

## Quick Start

Open the dashboard with cached data:

```text
/usage
```

Force a live refresh, rescan local history, and reopen:

```text
/usage:refresh
```

## Commands

| Command           | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `/usage`          | Open the dashboard. Uses cached live data when available. Quick inspection.              |
| `/usage:refresh`  | Force a live refresh, rescan local session history, then open the dashboard.             |

## Dashboard Tabs

The dashboard renders as a tabbed overlay. Switch tabs with `Tab` / `Shift-Tab`.

### Usage Statistics (default)

Aggregates local Pi session history for the selected period.

- Period selector: `Today`, `This Week`, `Last Week`, `All Time`.
- Aggregated provider/model table with expandable rows.
- Total row for everything currently shown.
- Per-row counts for sessions, messages, cost, total tokens, input, output, cache reads, and cache writes.

### Current Usage

Shows supported live providers. Configured providers return live quota and balance data; unconfigured ones may show `unavailable` or a local fallback.

- Provider selector: `OpenAI/Codex`, `MiniMax`, `StepFun`, `OpenCode Go`, `Command Code`, `OpenRouter`.
- Rolling-window quota bars (e.g. `5h`, weekly).
- Balance-style fields where the provider exposes them.
- Inline status: `live`, `cached`, `stale`, `local`, `unavailable`.

### Insights

Breakdowns for the selected period. Toggle visibility by switching to this tab.

- Most expensive projects in your local session history.
- Active skill breakdown when that data is present.
- MCP server breakdown when that data is present.
- Grouped insight categories with capped lists and overflow summaries so long sections stay readable.

The Insights period selector is independent of the Usage Statistics period.

## Keyboard Shortcuts

Global:

- `[Tab]` next tab.
- `[Shift-Tab]` previous tab.
- `[q]` / `[Esc]` close the dashboard.

Usage Statistics tab:

- `[Left/Right]` switch period.
- `[Up/Down]` move through rows.
- `[Enter]` / `[Space]` expand or collapse the selected provider row.

Current Usage tab:

- `[Left/Right]` switch provider.

Insights tab:

- `[Left/Right]` switch period.

The footer at the bottom of the dashboard shows the contextual shortcuts for the active tab.

## Configuration

### `usage.json`

Create `$PI_CODING_AGENT_DIR/extensions/usage.json` to disable specific live providers.

Default behavior:

- File missing: all providers stay enabled.
- File is `{}`: all providers stay enabled.
- Provider omitted: that provider stays enabled.
- JSON malformed: `@pi-vault/pi-usage` ignores it and falls back to the default behavior.

Default example:

```json
{}
```

Explicit all-providers-enabled example:

```json
{
  "providers": {
    "openai-codex": { "enabled": true },
    "minimax": { "enabled": true },
    "stepfun": { "enabled": true },
    "opencode-go": { "enabled": true },
    "command-code": { "enabled": true },
    "openrouter": { "enabled": true }
  }
}
```

Disable MiniMax only:

```json
{
  "providers": {
    "minimax": { "enabled": false }
  }
}
```

### Provider setup

Offline history works without extra setup. Provider cards appear for every supported live provider unless you disable them in `usage.json`. Providers you configure can return live data; others may show `unavailable` or a local fallback state.

#### OpenAI/Codex

Pi usage can reuse existing Pi or Codex auth. Optional overrides:

- `OPENAI_CODEX_OAUTH_TOKEN`
- `OPENAI_CODEX_ACCESS_TOKEN`
- `CODEX_OAUTH_TOKEN`
- `CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_ACCOUNT_ID`
- `CHATGPT_ACCOUNT_ID`

#### MiniMax

Set one of:

- `MINIMAX_CODING_API_KEY`
- `MINIMAX_API_KEY`

Optional override:

- `MINIMAX_API_HOST`

#### StepFun

Set one of:

- `STEPFUN_TOKEN`
- `STEPFUN_USERNAME` and `STEPFUN_PASSWORD`

#### OpenCode Go

Set:

- `OPENCODE_GO_COOKIE_HEADER`
- `OPENCODE_GO_WORKSPACE_ID`

`OPENCODE_GO_WORKSPACE_ID` accepts either the raw `wrk_...` id or the full workspace URL.

#### Command Code

Set:

- `COMMAND_CODE_COOKIE_HEADER`

#### OpenRouter

Set:

- `OPENROUTER_API_KEY`

Optional overrides:

- `OPENROUTER_API_URL`
- `OPENROUTER_X_TITLE`
- `OPENROUTER_HTTP_REFERER`

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for release-by-release notes.

## License

MIT — see [`LICENSE`](LICENSE).
