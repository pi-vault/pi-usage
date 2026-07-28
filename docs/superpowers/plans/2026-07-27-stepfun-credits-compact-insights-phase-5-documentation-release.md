# Phase 5: Documentation and Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Document the finished StepFun and Insights behavior, refresh visual evidence, and prove the complete package is releasable.

**Architecture:** This phase changes no runtime behavior. It updates public setup and keyboard guidance, adds an Unreleased changelog entry, captures the compact UI, then runs focused, full, package, and live verification.

**Tech Stack:** Markdown, Herdr, pnpm, Vitest, Pi 0.82.1.

**Phase dependency:** Phases 1–4 are committed and `pnpm check` passes.

**Usable result:** Users can configure StepFun safely, understand all-time category navigation, see an accurate screenshot, and install a verified package artifact.

**Out of scope:** Runtime refactors, additional providers, standard StepFun API balance, new Insight calculations, and release version bumping.

---

### Task 1: Document StepFun browser-session setup

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the StepFun setup block**

Replace the current `#### StepFun` section with:

````markdown
#### StepFun

Pi Usage reads Step Plan Credits from your logged-in StepFun Platform browser session.

1. Sign in at [platform.stepfun.ai](https://platform.stepfun.ai/).
2. Open browser DevTools → **Application** → **Storage** → **Cookies** → `https://platform.stepfun.ai`.
3. Copy the `Oasis-Token` and `Oasis-WebId` cookie values.
4. Export them before starting Pi:

```sh
export STEPFUN_TOKEN='your-oasis-token'
export STEPFUN_WEB_ID='your-oasis-web-id'
```

Both values are secrets. Do not commit or share them. When the browser session expires, copy and export fresh cookie values.
````

- [ ] **Step 2: Remove obsolete credential guidance**

Run:

```sh
git grep -n 'STEPFUN_USERNAME\|STEPFUN_PASSWORD\|platform.stepfun.com' -- README.md
```

Expected: no matches.

- [ ] **Step 3: Check the rendered Markdown structure**

Inspect the edited section and confirm the ordered list continues through step 4, the shell block is nested under step 4, and the secret warning renders as prose rather than code.

---

### Task 2: Document compact all-time Insights

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Insights description**

Use:

```markdown
### Insights

![Insights tab](docs/assets/insights.png)

Shows all-time breakdowns from local Pi session history. Left/Right switches between the available `Projects`, `Skills`, `MCP servers`, and `Cost patterns` categories. Only categories with data appear, and each category keeps its capped list plus overflow summary.
```

- [ ] **Step 2: Update the keyboard shortcut**

Under `Insights tab`, use:

```markdown
- `[Left/Right]` switch category.
```

- [ ] **Step 3: Remove period-selector claims**

Run:

```sh
git grep -n 'Insights period\|independent.*period' -- README.md
```

Expected: no matches.

---

### Task 3: Record the release-facing changes

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add one Unreleased section above 0.6.0**

Insert:

```markdown
## [Unreleased]

### Changed

- Updated `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to 0.82.1.
- Migrated StepFun Step Plan tracking to `platform.stepfun.ai` browser-session credentials and monthly Credit usage.
- Replaced the unsupported Insights period selector with compact all-time category navigation.

### Removed

- StepFun username/password login and legacy `.com` dashboard requests.
```

- [ ] **Step 2: Verify no duplicate Unreleased section exists**

Run:

```sh
grep -n '^## \[Unreleased\]' CHANGELOG.md
```

Expected: exactly one matching line.

---

### Task 4: Produce visual and live behavior evidence

**Files:**
- Modify: `docs/assets/insights.png`

- [ ] **Step 1: Verify Insights at 40×24 and 80×24 with Herdr**

```sh
verify_insights() {
  width="$1"
  workspace=$(herdr pane current | jq -r '.result.pane.workspace_id')
  created=$(herdr tab create --workspace "$workspace" --cwd "$(pwd)" --label "verify-$width" --no-focus)
  pane=$(printf '%s' "$created" | jq -r '.result.root_pane.pane_id')
  tab=$(printf '%s' "$created" | jq -r '.result.tab.tab_id')

  herdr pane send-text "$pane" "stty rows 24 cols $width; pi -e ."
  herdr pane send-keys "$pane" enter
  sleep 4
  herdr pane send-text "$pane" '/usage:refresh'
  herdr pane send-keys "$pane" enter
  sleep 10
  herdr pane send-keys "$pane" q
  sleep 1
  herdr pane send-text "$pane" '/usage'
  herdr pane send-keys "$pane" enter
  sleep 2
  herdr pane send-keys "$pane" tab tab
  sleep 1
  herdr pane read "$pane" --source visible --lines 24
  herdr tab close "$tab" >/dev/null
}

verify_insights 40
verify_insights 80
```

The refresh runs before capture so local Insight data is populated; reopening `/usage` reads the completed scan. Expected: both captures show Insights selected, populated category tabs, one selected category, the contextual Category footer, and the bottom frame. At 80 columns, all available category tabs fit on one row.

- [ ] **Step 2: Verify a real StepFun Credit response**

Start Pi with local `STEPFUN_TOKEN` and `STEPFUN_WEB_ID` values, run `/usage:refresh`, and open Current Usage.

Expected:

- one `Credits` bar,
- correct plan name when `GetStepPlanStatus` succeeds,
- absolute used/total Credits when every bucket is valid,
- a subscription reset only when `subscription_credit_reset_time` is present,
- no token or Web ID in diagnostics, terminal capture, or logs.

- [ ] **Step 3: Refresh the Insights screenshot**

At a normal terminal size, run `/usage:refresh`, wait for the scan to finish, close the overlay, reopen `/usage`, switch to Insights, and select a representative populated category. Replace `docs/assets/insights.png` with a screenshot that shows:

- the main Insights tab selected,
- populated category tabs,
- one selected all-time category,
- the contextual Category footer,
- the complete bottom frame.

Before saving, verify the image contains no credentials, usernames, private project names, shell prompts, or unrelated windows.

---

### Task 5: Commit public documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/assets/insights.png`

- [ ] **Step 1: Review the documentation diff**

```sh
git diff -- README.md CHANGELOG.md docs/assets/insights.png
git diff --check
```

Expected: setup instructions match the implemented environment variables, keyboard guidance says Category, the changelog has one Unreleased section, and no whitespace errors appear.

- [ ] **Step 2: Commit documentation and visual evidence**

```sh
git add README.md CHANGELOG.md docs/assets/insights.png
git commit -m "docs: update StepFun and Insights guidance"
```

---

### Task 6: Run release-level verification

**Files:**
- Verify all files changed by Phases 1–5.

- [ ] **Step 1: Run focused regression tests**

```sh
pnpm test -- tests/provider-stepfun.test.ts tests/dashboard.test.ts tests/constants.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 2: Run the complete quality gate**

```sh
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and the complete Vitest suite all PASS.

- [ ] **Step 3: Verify package contents**

```sh
pnpm pack:dry-run
```

Expected: PASS. The package contains `src`, `docs/assets`, `README.md`, `CHANGELOG.md`, and `LICENSE`, with no environment files, cookies, or credentials.

- [ ] **Step 4: Verify the final repository state**

```sh
git status --short
git diff --check
git log -5 --oneline
```

Expected:

- no whitespace errors,
- no uncommitted implementation or documentation files,
- separate commits for the Pi dependency update, StepFun browser sessions, StepFun Credits, compact Insights, and documentation.

- [ ] **Step 5: Record any unavailable manual evidence**

If real StepFun credentials or screenshot tooling were unavailable, do not claim those checks passed. State exactly which manual check remains and keep release status blocked until the user supplies or explicitly waives that evidence.

## Research sources

- [Step Plan overview](https://platform.stepfun.ai/docs/en/step-plan/overview)
- [StepFun account API](https://platform.stepfun.ai/docs/en/api-reference/accounts/get)
- [CodexBar StepFun provider notes](https://github.com/steipete/CodexBar/blob/main/docs/stepfun.md)
- [StepFun `.ai` dashboard integration reference](https://github.com/pi-vault/notBlubbll-Stepfun2Opencode/blob/main/AGENTS.md)
- Pi 0.82.0 overlay clipping behavior: `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/tui.ts`

**Stop here.** The complete refactor is documented, visually checked, package-verified, and ready for branch integration.