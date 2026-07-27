# Phase 1: Pi 0.82.0 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Upgrade the project to `@earendil-works/pi-coding-agent` 0.82.0 and `@earendil-works/pi-tui` 0.82.0 without changing application behavior.

**Architecture:** This phase changes only dependency metadata. It establishes the exact Pi API baseline used by all later provider and TUI phases.

**Tech Stack:** pnpm, TypeScript 6, Node.js 24, Pi 0.82.0.

**Phase dependency:** The parent design specification must be approved before execution.

**Usable result:** The unchanged extension installs, typechecks, and passes its existing test suite against Pi 0.82.0. This phase can be released independently as a dependency-only maintenance update.

**Out of scope:** StepFun behavior, Insights behavior, README content, screenshots, and unrelated dependency updates.

---

### Task 1: Pin the Pi packages to the 0.82 line

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Record the current dependency state**

Run:

```sh
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
```

Expected before the change: both packages report `0.80.3`.

- [ ] **Step 2: Update both Pi development dependencies**

Run:

```sh
pnpm add -D '@earendil-works/pi-coding-agent@0.82.0' '@earendil-works/pi-tui@0.82.0'
```

Expected: `package.json` contains:

```json
"@earendil-works/pi-coding-agent": "^0.82.0",
"@earendil-works/pi-tui": "^0.82.0"
```

Expected: the importer and package snapshots in `pnpm-lock.yaml` resolve both packages to exactly `0.82.0`.

- [ ] **Step 3: Verify only intended dependency metadata changed**

Run:

```sh
git diff -- package.json pnpm-lock.yaml
```

Expected: the two Pi package specifications and their transitive lockfile entries change; no unrelated direct dependency changes appear.

- [ ] **Step 4: Verify the installed versions**

Run:

```sh
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
```

Expected: both direct dependencies report `0.82.0`.

- [ ] **Step 5: Verify the existing code against Pi 0.82.0**

Run:

```sh
pnpm typecheck
pnpm test
```

Expected: both commands PASS with no TypeScript diagnostics or failed tests. Do not add compatibility shims unless the typecheck exposes a concrete 0.82.0 API change.

- [ ] **Step 6: Commit the atomic upgrade**

```sh
git add package.json pnpm-lock.yaml
git commit -m "chore: update Pi dependencies to 0.82.0"
```

---

### Phase verification

- [ ] Run the project quality gate:

```sh
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and Vitest all PASS.

- [ ] Verify the phase diff and commit:

```sh
git status --short
git diff --check
git log -1 --oneline
```

Expected: no uncommitted Phase 1 files, no whitespace errors, and the latest commit is `chore: update Pi dependencies to 0.82.0`.

**Stop here.** Phase 2 starts from this passing Pi 0.82.0 baseline.