# Next Release Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the next release’s documentation surface so `README.md`, `CHANGELOG.md`, and license metadata match the current shipped behavior.

**Architecture:** Keep the implementation docs-only and stage it in three focused slices: first rewrite `README.md` as a usage guide, then add a release-ready `CHANGELOG.md` entry based on commits after `v0.4.0`, then verify MIT license surfacing and package contents. Avoid code changes, historical changelog rewrites, or version bumps unless explicitly requested during execution.

**Tech Stack:** Markdown, JSON metadata, git, pnpm

**Spec:** `docs/superpowers/specs/2026-06-22-next-release-docs-design.md`

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `README.md` | Modify | Rewrite as a usage-first guide, update Node badge, add `usage.json` documentation, and remove development-focused framing |
| `CHANGELOG.md` | Modify | Add the next release notes entry summarizing shipped changes since `v0.4.0` |
| `package.json` | Verify | Confirm `license` and packaged `files` metadata stay aligned with the repo root artifacts |
| `LICENSE` | Verify | Confirm the existing MIT text remains present at the repo root |

---

## Task 1: Rewrite README.md as a usage-first guide

**Files:**
- Modify: `README.md`
- Verify against: `src/shared/types.ts`, `src/index.ts`, `src/core/usage-core.ts`, `package.json`

- [ ] **Step 1: Replace `README.md` with the full usage-first draft**

Overwrite `README.md` with this exact content:

```md
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

The lower section shows live quota and balance information for providers you have already configured.

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

Offline history works without extra setup. Live provider cards appear only for providers you have both configured and left enabled.

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
```

- [ ] **Step 2: Verify README claims against the codebase**

Run:

```bash
rg -n '"node":|"license":|"files"' package.json
sed -n '1,20p' src/shared/types.ts
rg -n 'registerCommand\("usage|registerCommand\("usage:refresh' src/index.ts
rg -n 'join\(deps.agentDir\(\), "extensions", "usage.json"\)|return \{\}' src/core/usage-core.ts
rg -n 'treats missing config file as all providers enabled|ignores malformed config JSON' tests/usage-core.test.ts
```

Expected:
- `package.json` shows Node `>=24.15.0` and license `MIT`
- `src/shared/types.ts` lists `offline` plus the configurable live providers: `openai-codex`, `minimax`, `stepfun`, `opencode-go`, `command-code`, and `openrouter`
- `src/index.ts` still registers `/usage` and `/usage:refresh`
- `src/core/usage-core.ts` loads `$PI_CODING_AGENT_DIR/extensions/usage.json` and falls back to `{}` on errors
- `tests/usage-core.test.ts` explicitly covers both the missing-file and malformed-JSON behaviors

- [ ] **Step 3: Read the rendered README sections once before moving on**

Run:

```bash
rg -n '^## |^### |usage.json|CHANGELOG|LICENSE|Node >=' README.md
```

Expected headings present:
- `## Install`
- `## Commands`
- `## What the dashboard shows`
- `## How to use it`
- `## Configuration`
- `## Changelog`
- `## License`

Also confirm there is no `## Development` section anymore.

- [ ] **Step 4: Commit the README refresh**

```bash
git add README.md
git commit -m "docs: refresh README for current usage flow"
```

---

## Task 2: Add the next release entry to CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`
- Verify against: `git log v0.4.0..HEAD`

- [ ] **Step 1: Insert an `Unreleased` section above `## v0.4.0`**

Add this exact block after the intro paragraph in `CHANGELOG.md`:

```md
## Unreleased

- added `usage.json` provider toggles so you can disable live providers you do not want queried
- added dashboard insights for project, active skill, and MCP server breakdowns
- grouped insight rows by category and cap each insight section with an overflow summary to keep the dashboard readable
- improved offline session parsing to extract project names, active skills, MCP server names, and builtin tool usage more accurately
- fixed dashboard readability around usage statistics spacing and grouped insight rendering
- updated runtime requirements and tooling to Node `>=24.15.0`, refreshed dependencies, and aligned CI with Node 24 and pnpm 11.8.0
```

Do not rewrite older version sections in this task.

- [ ] **Step 2: Verify every bullet against the commit history**

Run:

```bash
git log --oneline v0.4.0..HEAD
```

Expected supporting commits include:
- `feat(core): add provider enable/disable toggle via extensions/usage.json`
- `feat(insights): add project breakdown by cost`
- `feat(insights): add skill and MCP server breakdowns`
- `feat(tui): render insights grouped by category`
- `feat(insights): cap project insights at 5 with overflow summary`
- `fix(offline): expand BUILTIN_TOOLS from real session data, rename cap constant`
- `chore: update node engine to 24.15.0, refresh package dependencies, and adjust project metadata`
- `chore: upgrade pnpm to 11.8.0 and Node.js to 24 in CI workflows`

If a bullet cannot be traced to the log, fix the wording now rather than carrying a vague release note forward.

- [ ] **Step 3: Decide whether to keep `Unreleased` or rename it during the actual release cut**

During this plan’s implementation, leave the heading as `## Unreleased` unless the user explicitly provides the final version number. If the release number is known during execution, rename the heading to `## vX.Y.Z` only after the wording is finalized.

- [ ] **Step 4: Read the top of the changelog after editing**

Run:

```bash
sed -n '1,30p' CHANGELOG.md
```

Expected:
- the file starts with `# Changelog`
- the intro paragraph stays intact
- `## Unreleased` appears before `## v0.4.0`
- the new bullets read cleanly and do not duplicate older entries verbatim

- [ ] **Step 5: Commit the changelog update**

```bash
git add CHANGELOG.md
git commit -m "docs: add unreleased release notes"
```

---

## Task 3: Verify MIT license surfacing and packaged release files

**Files:**
- Verify: `LICENSE`
- Verify: `package.json`
- Verify: `README.md`
- Verify: `CHANGELOG.md`

- [ ] **Step 1: Confirm MIT license metadata and root files are aligned**

Run:

```bash
test -f LICENSE && echo "LICENSE present"
rg -n '"license": "MIT"' package.json
rg -n '\[!\[License: MIT\]|\]\(LICENSE\)|\[`LICENSE`\]\(LICENSE\)' README.md
rg -n '"files"|LICENSE|CHANGELOG.md|README.md' package.json
```

Expected:
- `LICENSE present`
- `package.json` contains `"license": "MIT"`
- `README.md` includes both the MIT badge and the final license link
- `package.json` includes `LICENSE`, `CHANGELOG.md`, and `README.md` in the packaged file list

- [ ] **Step 2: If any license surface is inconsistent, fix it immediately**

Use these exact targets if a repair is needed:

```json
{
  "license": "MIT",
  "files": [
    "src",
    "docs/assets",
    "LICENSE",
    "CHANGELOG.md",
    "README.md"
  ]
}
```

For README fixes, keep the license badge and final section in this form:

```md
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
```

```md
## License

MIT — see [`LICENSE`](LICENSE).
```

If all checks already pass, make no file edits in this step.

- [ ] **Step 3: Run package and repo verification**

Run:

```bash
pnpm pack --dry-run
pnpm check
git diff --check
```

Expected:
- `pnpm pack --dry-run` succeeds and includes `LICENSE`, `CHANGELOG.md`, `README.md`, and `docs/assets/dashboard-ui.png`
- `pnpm check` passes
- `git diff --check` prints no whitespace errors

- [ ] **Step 4: Create the final documentation commit if this task changed any files**

If Step 2 required edits:

```bash
git add package.json README.md LICENSE CHANGELOG.md
git commit -m "docs: align license metadata and package contents"
```

If Step 2 made no edits, skip this commit.

---

## Self-Review Checklist

- Spec coverage:
  - README usage-only rewrite: covered by Task 1
  - `usage.json` defaults and explicit examples: covered by Task 1
  - next release notes based on post-`v0.4.0` commits: covered by Task 2
  - MIT license verification and package surfacing: covered by Task 3
- Placeholder scan:
  - no `TBD`, `TODO`, or “similar to above” placeholders remain
  - every edit step includes exact markdown or command targets
- Type and naming consistency:
  - provider IDs in the README match `ProviderId` names in `src/shared/types.ts`
  - the changelog references shipped features only
  - the plan leaves the version heading as `Unreleased` until the release number is explicitly chosen
