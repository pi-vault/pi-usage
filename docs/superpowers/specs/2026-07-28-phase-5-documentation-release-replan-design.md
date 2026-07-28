# Phase 5 documentation and release verification replan design

## Purpose

Phase 5 must document the merged StepFun Credits and compact Insights behavior, replace the obsolete Insights screenshot, and establish release readiness without accidentally testing an installed package or accepting incomplete evidence.

The current Phase 5 plan has four execution defects:

- `pi -e .` also loads enabled user extensions, including the installed `@pi-vault/pi-usage`, so the global initialization guard can cause the checkout under test to be skipped.
- `pnpm test -- tests/provider-stepfun.test.ts` passes a literal `--` to Vitest and runs all test files instead of the intended focused set.
- fixed sleeps followed by `q` can cancel an unfinished offline scan, producing stale or incomplete Insights evidence.
- `git log -5` cannot show all phase commits because Phase 4 contains follow-up commits and merge commits.

## Current baseline

The worktree is clean. Phases 1–4 are merged, the focused StepFun/dashboard/constants tests pass when invoked directly through Vitest, `pnpm check` passes all 262 tests, and `pnpm pack:dry-run` contains the expected package files.

`package.json` declares both Pi development dependencies as `^0.82.0`; `pnpm-lock.yaml` and the installed dependency tree resolve both to 0.82.1. The changelog must describe both facts rather than implying the manifest pins 0.82.1.

The local Pi reference repository at `/Users/lanh/Developer/pi-packages/pi` confirms the relevant contracts:

- `--no-extensions` excludes configured extensions while retaining explicit `-e` paths.
- percentage overlay sizes use `Math.floor`.
- `maxHeight` clips rendered overlay lines with `slice(0, maxHeight)`.
- the installed Pi TUI 0.82.1 has the same sizing and clipping behavior as the repository's v0.82.0 reference.

## Scope

Modify only:

- `README.md`
- `CHANGELOG.md`
- `docs/assets/insights.png`
- the existing Phase 5 implementation plan

Do not change runtime code, tests, dependencies, package version, provider behavior, Insights calculations, or overlay options.

## Documentation behavior

The README will:

- replace StepFun username/password guidance with the `Oasis-Token` and `Oasis-WebId` browser-session procedure;
- identify both values as secrets and explain session renewal;
- describe Insights as all-time category navigation;
- state that only populated Projects, Skills, MCP servers, and Cost patterns categories appear;
- change the Insights shortcut from period navigation to category navigation.

The changelog will add one Unreleased section. Its Pi dependency entry will say the development ranges are `^0.82.0` and resolve to 0.82.1. It will also record the StepFun browser-session/Credits migration, compact all-time Insights navigation, and removal of username/password and `.com` dashboard behavior.

## Isolated visual verification

Every visual verification process will start Pi with:

```sh
pi --no-extensions -e .
```

This loads the checkout explicitly without loading the installed `@pi-vault/pi-usage` package.

Herdr will create a temporary tab, obtain its pane ID, and install cleanup that closes the tab on success or failure. The process will set its pseudo-terminal dimensions with `stty rows 24 cols "$width"`.

After `/usage:refresh` opens the dashboard, verification will remain on Usage Statistics until `Loading session history...` disappears. Polling will have a fixed timeout and fail with captured output if the scan does not complete. The process will not press `q` while loading because dashboard dismissal invokes the scan cancellation callback.

After completion, two Tab keypresses will open Insights in the same overlay. Captures at 40 by 24 and 80 by 24 must show:

- Insights selected;
- populated category tabs;
- one selected category;
- the Category footer;
- the complete bottom frame.

The normal-size release screenshot will select Cost patterns because it demonstrates category navigation without exposing local project names. Before replacement, the image must be checked for credentials, usernames, project names, prompts, shell content, and unrelated windows.

## StepFun evidence and release gate

A live StepFun check requires both `STEPFUN_TOKEN` and `STEPFUN_WEB_ID` in the transient Pi process environment. Neither value may be printed, persisted, captured, or committed.

The check must confirm one Credits bar, the returned plan name when available, valid absolute used/total values when the response provides a complete valid bucket set, and only the subscription reset when present.

If disposable credentials are unavailable or the live check fails, documentation and automated verification may proceed, but Phase 5 and release readiness remain blocked. The final report must identify the missing evidence. Only an explicit later user waiver can remove this gate.

## Automated verification

Focused tests will use:

```sh
pnpm exec vitest run tests/provider-stepfun.test.ts tests/dashboard.test.ts tests/constants.test.ts
```

Release verification will then run:

```sh
pnpm check
pnpm pack:dry-run
git diff --check
git status --short
git log --oneline v0.6.0..HEAD
```

The package listing must include `src`, `docs/assets`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`, with no environment files or credentials. The history range must show the Phase 1 dependency/toolchain work, StepFun browser-session migration, StepFun Credits support, compact Insights commits, and Phase 5 documentation commit; merge and follow-up commits are expected.

## Completion contract

Phase 5 is complete only when:

- README and changelog claims match the implementation and dependency metadata;
- the screenshot shows the compact category UI and passes privacy review;
- isolated 40 by 24 and 80 by 24 captures pass;
- focused, full, and package checks pass;
- the worktree is clean after the documentation commit;
- live StepFun evidence passes or the user explicitly waives it.
