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

## Commands

- `/usage` opens the dashboard using cached live data when available. Use it for quick inspection.
- `/usage:refresh` forces a live refresh, rescans local history, and then opens the dashboard.

## What the dashboard shows

### Usage statistics

The top section aggregates local Pi session history for the selected period.

- switch between `Today`, `This Week`, `Last Week`, and `All Time`
- expand provider rows to inspect model-level usage
- compare sessions, messages, cost, total tokens, input, output, cache reads, and cache writes
- keep a running total row for everything currently shown

### Current usage

The lower section shows the supported providers. Configured providers can return live quota and balance data, while unconfigured ones may show `unavailable` or local fallback states.

- switch between `OpenAI/Codex`, `MiniMax`, `StepFun`, `OpenCode Go`, `Command Code`, and `OpenRouter`
- view rolling-window quota bars like `5h` and weekly usage
- see balance-style fields where the provider exposes them
- get inline status for live, cached, stale, local, or unavailable data

### Insights

Press `v` to toggle insights for the selected period.

- review the most expensive projects in your local session history
- see active skill and MCP server breakdowns when that data is present
- keep long sections readable through grouped insight categories and capped lists with overflow summaries

## How to use it

### Keyboard shortcuts

- `[Tab/Shift-Tab]` switch provider tabs
- `[Left/Right]` switch time period
- `[Up/Down]` move through rows
- `[Enter/Space]` expand or collapse provider rows
- `[v]` toggle insights
- `[q/Esc]` close the dashboard

## Configuration

### `usage.json`

Create `$PI_CODING_AGENT_DIR/extensions/usage.json` to disable specific live providers.

Default behavior:
- if the file is missing, all providers stay enabled
- if the file is `{}`, all providers stay enabled
- if a provider is omitted, that provider stays enabled
- if the JSON is malformed, `@pi-vault/pi-usage` ignores it and falls back to the default behavior

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

Offline history works without extra setup. Provider cards appear for every supported live provider unless you disable them in `usage.json`. Providers you configure can return live data; others may show `unavailable` or local fallback states.

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
