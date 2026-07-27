# Phase 1: Pi 0.82 Compatibility and Toolchain Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Pi 0.82 dependency baseline by making the existing Biome 2.5.5 and Vitest 4.1.10 upgrades pass the project quality gate without changing application behavior.

**Architecture:** Keep the current dependency metadata: `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` remain declared as `^0.82.0` and resolve to 0.82.1 in the lockfile. Apply only behavior-preserving lint fixes in the overlay width calculation and runtime utility tests, and remove the unused test-only lint override.

**Tech Stack:** pnpm, TypeScript 6, Node.js 24.15.0, Pi 0.82.x, Vitest 4.1.10, Biome 2.5.5.

---

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Current baseline:** The branch already contains the Pi, Biome, and Vitest dependency upgrades. Direct Pi packages report 0.82.1 from the `^0.82.0` ranges; typecheck and all 247 tests pass. The remaining blocker is Biome’s one warning and two errors.

**Usable result:** The unchanged extension passes `pnpm check` under Node 24.15.0. This phase remains independent of StepFun behavior, Insights behavior, and all later feature work.

**Out of scope:** Dependency version changes, public API changes, StepFun behavior, Insights behavior, README content, screenshots, and unrelated refactoring.

---

### Task 1: Resolve the Biome 2.5.5 diagnostics

**Files:**
- Modify: `biome.json`
- Modify: `src/tui/overlay-render.ts`
- Modify: `tests/runtime-utilities.test.ts`

- [ ] **Step 1: Reproduce the current quality-gate failure**

Run:

```sh
mise exec node@24.15.0 -- pnpm check
```

Expected before the edits: Biome reports the non-null assertion at `src/tui/overlay-render.ts:113` and unsafe optional chaining at `tests/runtime-utilities.test.ts:23` and `tests/runtime-utilities.test.ts:38`; TypeScript and Vitest are not reached by the combined command.

- [ ] **Step 2: Remove the unused test-only lint override**

Replace `biome.json` with:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "includes": ["src/**/*.ts", "tests/**/*.ts", "!**/node_modules"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

The override is unnecessary because the test suite contains no non-null assertions; keep Biome’s recommended rules enabled for all project files.

- [ ] **Step 3: Replace the overlay width assertion with a bounds-safe reduction**

In `src/tui/overlay-render.ts`, replace:

```ts
let total = 0;
for (let i = s; i < e; i += 1) total += widths[i]!;
```

with:

```ts
let total = widths.slice(s, e).reduce((sum, width) => sum + width, 0);
```

Leave the gap, indicator, and return calculations unchanged. The existing callers pass tab-derived bounds, so the reduction preserves the rendered width while removing the assertion.

- [ ] **Step 4: Narrow the mocked fetch signals in the timeout tests**

In the `"aborts after timeout expires"` test, replace the callback body with:

```ts
deps.fetch = vi.fn(async (_url, init) => {
  const signal = init?.signal;
  if (!signal) throw new Error("fetch signal missing");
  await new Promise((_, reject) => {
    signal.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
  return new Response();
});
```

In the `"respects external signal"` test, replace the callback with:

```ts
deps.fetch = vi.fn(async (_url, init) => {
  const signal = init?.signal;
  if (!signal) throw new Error("fetch signal missing");
  signal.throwIfAborted();
  return new Response();
});
```

The explicit guard preserves the test’s expectation that `fetchWithTimeout` supplies an abort signal and removes unsafe optional chaining.

- [ ] **Step 5: Run the focused regression tests**

Run:

```sh
mise exec node@24.15.0 -- pnpm test -- tests/overlay-render.test.ts tests/runtime-utilities.test.ts
```

Expected: all tests in both files pass.

- [ ] **Step 6: Run Biome against the changed files**

Run:

```sh
mise exec node@24.15.0 -- pnpm exec biome lint biome.json src/tui/overlay-render.ts tests/runtime-utilities.test.ts
```

Expected: no errors, warnings, or fixes requested.

- [ ] **Step 7: Commit the lint compatibility fixes**

Run:

```sh
git add biome.json src/tui/overlay-render.ts tests/runtime-utilities.test.ts
git commit -m "fix: satisfy Biome 2.5.5 lint rules"
```

Expected: the commit contains only the lint configuration cleanup and the behavior-preserving source/test edits.

### Phase verification

- [ ] **Step 1: Run the complete quality gate**

Run:

```sh
mise exec node@24.15.0 -- pnpm check
```

Expected: Biome lint, TypeScript typecheck, and all 247 Vitest tests pass.

- [ ] **Step 2: Confirm the dependency baseline was not changed**

Run:

```sh
mise exec node@24.15.0 -- pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
git diff HEAD^ -- package.json pnpm-lock.yaml
```

Expected: both direct Pi packages report 0.82.1; the lint-fix commit contains no dependency metadata changes.

- [ ] **Step 3: Verify the final worktree**

Run:

```sh
git status --short
git diff --check
git log -1 --oneline
```

Expected: no uncommitted files, no whitespace errors, and the latest commit is `fix: satisfy Biome 2.5.5 lint rules`.

**Stop here.** Phase 2 starts from this passing Pi 0.82.x and toolchain baseline.
