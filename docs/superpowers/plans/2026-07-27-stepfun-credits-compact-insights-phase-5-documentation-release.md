# Phase 5 Documentation and Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair async dashboard updates, document the finished StepFun and compact Insights behavior, replace obsolete visual evidence, and prove release readiness.

**Architecture:** Keep the release fix at the existing usage-core event boundary: the open dashboard replaces its cloned state from each internal update payload, then repaints. After that prerequisite passes, update only public documentation and the Insights image, run Pi in extension-isolated Herdr tabs for visual checks, and keep live StepFun evidence as a hard release gate.

**Tech Stack:** TypeScript, Vitest, Markdown, Pi 0.82.1, Herdr 0.7.5, jq, pnpm, macOS `screencapture`.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Design spec:** `docs/superpowers/specs/2026-07-28-phase-5-documentation-release-replan-design.md`

**Phase dependency:** Phases 1–4 are committed. Before this phase, `pnpm check` passes all 262 tests and `pnpm pack:dry-run` succeeds.

**Release gate:** Phase 5 is not complete without a successful live StepFun browser-session check or an explicit user waiver. Missing disposable credentials may block release readiness without blocking the documentation and automated tasks.

---

## File map

- Modify `src/tui/dashboard.ts`: consume `UsageCorePayload.state` before repainting an open overlay.
- Modify `tests/dashboard.test.ts`: prove an async update replaces loading state and preserve listener cleanup coverage.
- Modify `README.md`: document StepFun browser-session cookies and compact all-time Insights navigation.
- Modify `CHANGELOG.md`: add one accurate Unreleased entry, including the async dashboard fix.
- Modify `docs/assets/insights.png`: replace the legacy period-selector image with privacy-safe Cost patterns evidence.
- Reference only `package.json` and `pnpm-lock.yaml`: verify declared Pi ranges and resolved versions; do not edit them.
- Reference only `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/resource-loader.ts` and `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/tui.ts`: retain the verified extension-isolation and overlay-clipping assumptions; do not edit the Pi repository.

## Constraints

- Do not change provider behavior, Insights calculations, overlay dimensions, dependency ranges, package version, or public APIs.
- Run every local Pi visual check as `pi --no-extensions -e .`. Plain `pi -e .` may also load the installed `@pi-vault/pi-usage`, whose global guard can skip this checkout.
- Never print, persist, capture, or commit `STEPFUN_TOKEN` or `STEPFUN_WEB_ID` values.
- Do not dismiss a refreshing dashboard while `Loading session history...` is visible; `q` and `Esc` invoke `cancelScan`.

---

### Task 1: Make the dashboard consume async state updates

**Files:**

- Modify: `tests/dashboard.test.ts:1088-1133`
- Modify: `src/tui/dashboard.ts:1-195`

- [ ] **Step 1: Replace the repaint-only test with a failing state-projection test**

Replace the first test in `describe("dashboard repaint subscription", ...)` with:

```ts
it("updates rendered state and repaints when usage-core state changes", () => {
  const tui = makeMockTui();
  const unsubscribe = vi.fn();
  const bus = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      expect(event).toBe("usage-core:update-current");
      bus.handler = handler;
      return unsubscribe;
    }),
    handler: undefined as ((...args: unknown[]) => void) | undefined,
  };
  (globalThis as { __piUsageBus?: unknown }).__piUsageBus = bus;

  try {
    const initialState = mkState();
    initialState.loading = true;
    initialState.offline.periods = [];
    const component = new UsageDashboardComponent(
      initialState,
      () => undefined,
      {
        theme: noTheme,
        tui: tui as unknown as TUI,
      },
    );

    expect(component.render(80).join("\n")).toContain(
      "Loading session history...",
    );

    bus.handler?.({ state: mkState() });

    const output = component.render(80).join("\n");
    expect(output).not.toContain("Loading session history...");
    expect(output).toContain("OpenAI/Codex");
    expect(tui.requestRender).toHaveBeenCalledTimes(1);

    component.invalidate();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  } finally {
    delete (globalThis as { __piUsageBus?: unknown }).__piUsageBus;
  }
});
```

Keep the existing `does nothing if no TUI is provided` test unchanged.

- [ ] **Step 2: Run the new test and verify the stale-state failure**

Run:

```sh
pnpm exec vitest run tests/dashboard.test.ts -t 'updates rendered state and repaints'
```

Expected: FAIL because the post-event render still contains `Loading session history...`. A failure caused by syntax, imports, or fixture setup is not the expected red state and must be corrected before continuing.

- [ ] **Step 3: Import the canonical update event and payload type**

Add this import after the TUI imports in `src/tui/dashboard.ts`:

```ts
import {
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCorePayload,
} from "../shared/events.ts";
```

Delete the local duplicate:

```ts
const USAGE_CORE_UPDATE_EVENT = "usage-core:update-current";
```

- [ ] **Step 4: Allow the component to replace its state snapshot**

Change the constructor parameter property from:

```ts
private readonly state: UsageCoreState,
```

to:

```ts
private state: UsageCoreState,
```

- [ ] **Step 5: Apply event state before requesting a repaint**

Replace the handler and subscription call in `subscribeToUpdates()` with:

```ts
const handler = (payload: unknown) => {
  const update = payload as Partial<UsageCorePayload> | null;
  if (update?.state) this.state = update.state;
  try {
    tui.requestRender();
  } catch {
    // Render failures must not break the dashboard.
  }
};
const off = bus.on(USAGE_CORE_UPDATE_CURRENT_EVENT, handler);
```

Do not add a second store, event, polling loop, or state merge. The core already emits a complete structured-clone projection.

- [ ] **Step 6: Run the focused dashboard tests**

Run:

```sh
pnpm exec vitest run tests/dashboard.test.ts
```

Expected: PASS. The new test proves loading state disappears after an event, and existing navigation, compact Insights, clipping, and listener tests remain green.

- [ ] **Step 7: Run static checks for the runtime change**

Run:

```sh
pnpm exec biome lint src/tui/dashboard.ts tests/dashboard.test.ts
pnpm typecheck
```

Expected: both commands PASS with no lint or TypeScript errors.

- [ ] **Step 8: Commit the minimal runtime prerequisite**

```sh
git add src/tui/dashboard.ts tests/dashboard.test.ts
git commit -m "fix: refresh open dashboard state"
```

---

### Task 2: Document StepFun and compact all-time Insights

**Files:**

- Modify: `README.md:47-83`
- Modify: `README.md:149-156`

- [ ] **Step 1: Replace the Insights section**

Replace the existing `### Insights` section, through the sentence about its independent period, with:

```markdown
### Insights

![Insights tab](docs/assets/insights.png)

Shows all-time breakdowns from local Pi session history. Left/Right switches between the available `Projects`, `Skills`, `MCP servers`, and `Cost patterns` categories. Only categories with data appear, and each category keeps its capped list plus overflow summary.
```

- [ ] **Step 2: Update the Insights keyboard shortcut**

Under `Insights tab`, replace the period shortcut with:

```markdown
- `[Left/Right]` switch category.
```

- [ ] **Step 3: Replace the StepFun provider setup section**

Replace the existing `#### StepFun` section with:

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

The three-space indentation keeps the shell block nested under ordered-list item 4.

- [ ] **Step 4: Verify obsolete README claims are gone**

Run:

```sh
if git grep -n -E 'STEPFUN_USERNAME|STEPFUN_PASSWORD|platform\.stepfun\.com|Insights period|independent.*period' -- README.md; then
  echo 'Obsolete README guidance remains' >&2
  exit 1
fi
```

Expected: no matches and exit status 0.

- [ ] **Step 5: Review the README diff and Markdown structure**

Run:

```sh
git diff -- README.md
git diff --check -- README.md
```

Expected: only StepFun setup, Insights description, and the Insights shortcut changed; the ordered list runs from 1 through 4; the secret warning is ordinary prose; no whitespace errors appear.

- [ ] **Step 6: Commit the README update**

```sh
git add README.md
git commit -m "docs: update StepFun and Insights guidance"
```

---

### Task 3: Record the release-facing changes accurately

**Files:**

- Modify: `CHANGELOG.md:1-8`
- Reference: `package.json`
- Reference: `pnpm-lock.yaml`

- [ ] **Step 1: Confirm declared and resolved Pi versions before writing claims**

Run:

```sh
node -e 'const p=require("./package.json"); console.log(p.devDependencies["@earendil-works/pi-coding-agent"], p.devDependencies["@earendil-works/pi-tui"])'
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
```

Expected: `package.json` prints `^0.82.0 ^0.82.0`; pnpm reports both installed packages at 0.82.1. Do not edit dependency metadata in this phase.

- [ ] **Step 2: Add one Unreleased section above 0.6.0**

Insert this block immediately before `## [0.6.0] - 2026-07-05`:

```markdown
## [Unreleased]

### Changed

- Updated the `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` development ranges to `^0.82.0`; the lockfile resolves both to 0.82.1.
- Migrated StepFun Step Plan tracking to `platform.stepfun.ai` browser-session credentials and monthly Credit usage.
- Replaced the unsupported Insights period selector with compact all-time category navigation.

### Fixed

- Kept open dashboard overlays synchronized with completed provider and offline-history updates.

### Removed

- StepFun username/password login and legacy `.com` dashboard requests.
```

Do not rewrite the historical 0.6.0 notes; they describe behavior in that released version.

- [ ] **Step 3: Verify the new section is unique and accurate**

Run:

```sh
test "$(grep -c '^## \[Unreleased\]' CHANGELOG.md)" -eq 1
git diff --check -- CHANGELOG.md
git diff -- CHANGELOG.md
```

Expected: one Unreleased heading, `^0.82.0` declared ranges, 0.82.1 lockfile resolution, the dashboard state fix, StepFun migration, compact all-time Insights, and the removed legacy login path.

- [ ] **Step 4: Commit the changelog**

```sh
git add CHANGELOG.md
git commit -m "docs: add unreleased StepFun and Insights notes"
```

---

### Task 4: Verify compact Insights at constrained sizes

**Files:**

- Verify: `src/tui/dashboard.ts`
- Verify: `src/tui/overlay-render.ts`
- No persistent file changes.

- [ ] **Step 1: Run isolated 40 by 24 and 80 by 24 checks with bounded polling**

Run the complete block from the repository root in Bash:

```bash
verify_insights() (
  set -eu
  width=$1
  workspace=$(herdr pane current | jq -er '.result.pane.workspace_id')
  created=$(herdr tab create \
    --workspace "$workspace" \
    --cwd "$(pwd)" \
    --label "verify-insights-$width" \
    --no-focus)
  pane=$(printf '%s' "$created" | jq -er '.result.root_pane.pane_id')
  tab=$(printf '%s' "$created" | jq -er '.result.tab.tab_id')
  trap 'herdr tab close "$tab" >/dev/null 2>&1 || true' EXIT INT TERM

  herdr pane send-text "$pane" \
    "stty rows 24 cols $width && pi --no-extensions -e ."
  herdr pane send-keys "$pane" enter
  herdr pane wait-output "$pane" \
    --match '[Extensions]' --source recent --timeout 30000 >/dev/null

  herdr pane send-text "$pane" '/usage:refresh'
  herdr pane send-keys "$pane" enter
  herdr pane wait-output "$pane" \
    --match 'Usage Statistics' --source recent --timeout 60000 >/dev/null

  deadline=$(($(date +%s) + 120))
  while :; do
    output=$(herdr pane read "$pane" --source visible --lines 24)
    if ! printf '%s\n' "$output" | grep -Fq 'Loading session history...'; then
      break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      printf '%s\n' "$output" >&2
      echo 'Timed out waiting for the offline scan' >&2
      exit 1
    fi
    sleep 1
  done

  herdr pane send-keys "$pane" tab tab
  sleep 1
  output=$(herdr pane read "$pane" --source visible --lines 24)
  printf '%s\n' "$output"

  printf '%s\n' "$output" | grep -Fq 'Insights'
  printf '%s\n' "$output" | grep -Fq 'Category'
  printf '%s\n' "$output" | grep -Eq 'Projects|Skills|MCP servers|Cost patterns'
  printf '%s\n' "$output" | grep -Fq '┗'
  if printf '%s\n' "$output" | grep -Fq 'Loading session history...'; then
    echo 'Insights was captured before the scan completed' >&2
    exit 1
  fi
)

verify_insights 40
verify_insights 80
```

Expected for both widths:

- the command exits 0;
- the checkout appears as `src` under Pi's Extensions startup list;
- Usage Statistics stops showing `Loading session history...` without sending `q` or `Esc`;
- two Tab keys show Insights;
- at least one populated category appears;
- the contextual footer contains Category;
- `┗` proves the bottom frame is visible.

At 40 columns, truncation and overflow indicators are acceptable. At 80 columns, all available category tabs must fit on one row. The trap must close each temporary tab on success or failure.

- [ ] **Step 2: Treat a timeout as a blocker, not permission to sleep longer**

If either check times out, retain the printed pane output and stop. Re-run the focused dashboard test and inspect the event payload/state flow. Do not replace polling with a fixed sleep and do not dismiss the overlay while loading.

---

### Task 5: Replace the legacy Insights screenshot

**Files:**

- Modify: `docs/assets/insights.png`

- [ ] **Step 1: Open the checkout in an isolated normal-size Pi terminal**

In the terminal that will be captured, run:

```sh
stty rows 32 cols 100
pi --no-extensions -e .
```

Wait for the Pi prompt, run `/usage:refresh`, and leave the overlay open until `Loading session history...` disappears. Press Tab twice to open Insights. Press Left or Right until `Cost patterns` is highlighted.

Expected: the frame shows Insights selected, populated category tabs, Cost patterns selected, the Category footer, and the complete bottom border.

- [ ] **Step 2: Capture only the dashboard frame**

From a second terminal, run:

```sh
screencapture -i docs/assets/insights.png
```

Drag the capture region around only the dashboard frame. Exclude the shell prompt, working-directory line, model/status bar, other windows, and notifications.

- [ ] **Step 3: Validate the image file**

Run:

```sh
test -s docs/assets/insights.png
file docs/assets/insights.png
sips -g pixelWidth -g pixelHeight docs/assets/insights.png
```

Expected: a non-empty PNG with positive pixel width and height.

- [ ] **Step 4: Perform visual and privacy review**

Inspect `docs/assets/insights.png` directly and with the available image-understanding tool using this prompt:

```text
Confirm this screenshot shows the Pi Usage Insights tab, populated category tabs, Cost patterns selected, a Category keyboard footer, and the complete bottom frame. Report any visible credentials, usernames, project names, prompts, shell content, paths, or unrelated windows.
```

Expected: all requested compact UI elements are present and none of the private or unrelated content is visible. If any private content appears, delete the image and repeat the capture before continuing.

- [ ] **Step 5: Review and commit only the replacement image**

Run:

```sh
git status --short
git diff --stat -- docs/assets/insights.png
git add docs/assets/insights.png
git commit -m "docs: refresh compact Insights screenshot"
```

Expected: the commit contains the single intended PNG replacement.

---

### Task 6: Obtain live StepFun release evidence

**Files:**

- No file changes.
- Manual trust-boundary verification only.

- [ ] **Step 1: Start isolated Pi with transient, non-echoed credentials**

Use disposable browser-session values. Run this in a private terminal that is not being captured or logged:

```bash
bash -c '
  read -rsp "StepFun Oasis-Token: " token
  printf "\n"
  read -rsp "StepFun Oasis-WebId: " web_id
  printf "\n"
  exec env STEPFUN_TOKEN="$token" STEPFUN_WEB_ID="$web_id" \
    pi --no-extensions -e .
'
```

The values exist only in the launched process environment and are not entered into shell history.

- [ ] **Step 2: Verify the live Credits presentation**

Inside Pi, run `/usage:refresh`. Wait until Usage Statistics no longer shows `Loading session history...`, press Tab once for Current Usage, then use Left/Right until StepFun is selected.

Confirm all applicable evidence:

- exactly one `Credits` bar;
- the returned plan name appears when `GetStepPlanStatus` succeeds;
- absolute used and total Credits appear when every bucket in the response is valid;
- only the subscription reset appears when `subscription_credit_reset_time` is present;
- no Oasis token or Web ID appears in the overlay or diagnostics.

Exit Pi after inspection. Do not save terminal output or a screenshot from this check.

- [ ] **Step 3: Enforce the credential gate**

If disposable credentials are unavailable, authentication fails, or any expected live behavior is absent, do not mark this task complete and do not call the branch release-ready. Report the exact missing evidence to the user. Continue to Task 7 only to collect automated evidence. Only an explicit user waiver can clear this release gate.

---

### Task 7: Run release-level verification

**Files:**

- Verify all files changed by Phases 1–5.

- [ ] **Step 1: Run the focused regression tests directly through Vitest**

Run:

```sh
pnpm exec vitest run tests/provider-stepfun.test.ts tests/dashboard.test.ts tests/constants.test.ts
```

Expected: all focused StepFun, dashboard, and constants tests PASS. Do not use `pnpm test --` because that produces `vitest run -- ...` and runs the full suite instead of the intended focused set.

- [ ] **Step 2: Run the complete quality gate**

Run:

```sh
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and the complete Vitest suite all PASS.

- [ ] **Step 3: Verify package contents**

Run:

```sh
pnpm pack:dry-run
```

Expected: PASS. The listing includes `src`, `docs/assets`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`. It contains no `.env` files, browser cookies, captured terminal logs, or credentials.

- [ ] **Step 4: Verify whitespace, worktree state, and complete phase history**

Run:

```sh
git diff --check
git status --short
git log --oneline v0.6.0..HEAD
```

Expected:

- `git diff --check` prints nothing;
- `git status --short` prints nothing;
- the history range shows the Phase 1 dependency/toolchain work, StepFun browser-session migration, StepFun Credits, compact Insights and follow-up commits, the Phase 5 design/replan commits, the dashboard state fix, README/changelog updates, and the screenshot commit;
- merge commits and Phase 4 follow-up commits are retained rather than hidden by a five-commit limit.

- [ ] **Step 5: Report release status without overstating evidence**

Report the focused test command, `pnpm check`, package dry run, 40 by 24 and 80 by 24 captures, screenshot privacy review, worktree status, and live StepFun result.

Use one of these conclusions:

```text
Release-ready: automated, visual, package, and live StepFun evidence passed.
```

or:

```text
Release blocked: automated, visual, and package evidence passed; live StepFun evidence is unavailable or failed and has not been waived.
```

Do not use the first conclusion unless Task 6 passed or the user explicitly waived it.

## Reference evidence

- Pi resource loading: `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/resource-loader.ts` confirms `--no-extensions` excludes configured extensions while explicit `-e .` still loads this checkout.
- Pi overlay sizing and clipping: `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/tui.ts` confirms percentage dimensions use `Math.floor` and overlay lines are clipped with `slice(0, maxHeight)`.
- The installed coding-agent and TUI resolve to 0.82.1; the relevant overlay behavior matches the local Pi repository's v0.82.0 reference.

**Stop here.** Integrate the branch only after every automated and visual task passes and the live StepFun gate passes or is explicitly waived.
