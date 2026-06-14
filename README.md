# @pi-vault/pi-usage

[![npm version](https://img.shields.io/npm/v/%40pi-vault%2Fpi-usage)](https://www.npmjs.com/package/@pi-vault/pi-usage)
[![Quality](https://github.com/pi-vault/pi-usage/actions/workflows/quality.yml/badge.svg?branch=master)](https://github.com/pi-vault/pi-usage/actions/workflows/quality.yml)
[![Node >= 22.19](https://img.shields.io/badge/node-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

Track Pi usage across your sessions in one dashboard. `@pi-vault/pi-usage` combines offline history with live provider snapshots so you can see costs, tokens, session activity, and rolling quota status without leaving Pi.

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

## What You Get

### Usage statistics

The top section aggregates all local Pi session history for the selected period.

- switch between `Today`, `This Week`, `Last Week`, and `All Time`
- expand provider rows to inspect model-level usage
- compare sessions, messages, cost, total tokens, input, output, cache reads, and cache writes
- keep a running total row for everything currently shown

### Current usage

The lower section shows live quota and balance information for providers you have already configured in Pi.

- switch between `OpenAI/Codex`, `MiniMax`, `StepFun`, `OpenCode Go`, `Command Code`, and `OpenRouter`
- view rolling-window quota bars like `5h` and weekly usage
- see balance-style fields where the provider exposes them
- get inline status for live, cached, stale, or fallback data

### Keyboard shortcuts

- `[Tab/Shift-Tab]` switch provider tabs
- `[Left/Right]` switch time period
- `[Up/Down]` move through rows
- `[Enter/Space]` expand or collapse provider rows
- `[v]` toggle insights
- `[q/Esc]` close the dashboard

## Provider Setup

Offline history works without extra setup. Live provider cards appear only for providers you have already configured.

### OpenAI/Codex

Pi usage can reuse existing Pi or Codex auth. Optional overrides:

- `OPENAI_CODEX_OAUTH_TOKEN`
- `OPENAI_CODEX_ACCESS_TOKEN`
- `CODEX_OAUTH_TOKEN`
- `CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_ACCOUNT_ID`
- `CHATGPT_ACCOUNT_ID`

### MiniMax

Set one of:

- `MINIMAX_CODING_API_KEY`
- `MINIMAX_API_KEY`

Optional override:

- `MINIMAX_API_HOST`

### StepFun

Set one of:

- `STEPFUN_TOKEN`
- `STEPFUN_USERNAME` and `STEPFUN_PASSWORD`

### OpenCode Go

Set:

- `OPENCODE_GO_COOKIE_HEADER`
- `OPENCODE_GO_WORKSPACE_ID`

`OPENCODE_GO_WORKSPACE_ID` accepts either the raw `wrk_...` id or the full workspace URL.

### Command Code

Set:

- `COMMAND_CODE_COOKIE_HEADER`

### OpenRouter

Set:

- `OPENROUTER_API_KEY`

Optional overrides:

- `OPENROUTER_API_URL`
- `OPENROUTER_X_TITLE`
- `OPENROUTER_HTTP_REFERER`

## Development

```bash
pnpm install
pnpm check
pnpm pack --dry-run
```

## License

MIT
