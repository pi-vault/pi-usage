# MiniMax OpenAI Provider Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing MiniMax five-hour and weekly usage windows when the active Pi model uses the trusted custom provider ID `minimax-openai`.

**Architecture:** Canonicalize the exact custom provider ID `minimax-openai` to the existing `minimax` usage provider inside `detectProviderFromModel()`. Preserve the current provider-isolation rule: every other non-empty provider remains authoritative and cannot be overridden by a MiniMax-looking model ID.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-31-minimax-openai-provider-alias-design.md`

## Global Constraints

- Treat `minimax-openai` as a trusted local alias, not a built-in Pi provider.
- Return canonical provider ID `minimax`; do not add a public provider ID or provider adapter.
- Keep model-ID fallback limited to models whose provider field is empty.
- Do not add aliases for `minimax-cn` or other MiniMax routes.
- Do not change provider fetching, caching, state projection, events, configuration, or consumers.
- Modify only `src/shared/provider-detection.ts` and `tests/provider-registry.test.ts`.
- Add no dependency or abstraction for the single alias.

---

### Task 1: Canonicalize the Trusted MiniMax OpenAI Provider

**Files:**

- Modify: `tests/provider-registry.test.ts`
- Modify: `src/shared/provider-detection.ts`

**Interfaces:**

- Consumes: `detectProviderFromModel(model: { provider?: string; id?: string; name?: string } | undefined)` from `src/shared/provider-detection.ts`.
- Produces: canonical provider ID `"minimax"` for normalized explicit provider `"minimax-openai"`; all other detection behavior remains unchanged.

- [ ] **Step 1: Add the positive alias and negative isolation regressions**

In the existing `provider detection` test in `tests/provider-registry.test.ts`, add these assertions after the direct `minimax` assertion:

```ts
expect(
  detectProviderFromModel({
    provider: "minimax-openai",
    id: "MiniMax-M3",
  }),
).toBe("minimax");
expect(
  detectProviderFromModel({
    provider: "custom-proxy",
    id: "MiniMax-M3",
  }),
).toBeUndefined();
```

- [ ] **Step 2: Run the focused test and verify the positive regression fails**

Run:

```bash
./node_modules/.bin/vitest run tests/provider-registry.test.ts
```

Expected: FAIL because the `minimax-openai` call receives `undefined` instead of `"minimax"`. The `custom-proxy` assertion passes.

- [ ] **Step 3: Implement the exact alias**

In `src/shared/provider-detection.ts`, replace the current direct MiniMax condition with:

```ts
if (p === "minimax" || p === "minimax-openai") return "minimax";
```

Do not move or weaken the later `if (p) return undefined;` guard.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
./node_modules/.bin/vitest run tests/provider-registry.test.ts
```

Expected: PASS. The trusted alias resolves to `minimax`, while `custom-proxy` remains unrecognized.

- [ ] **Step 5: Verify the required Node.js runtime**

Run:

```bash
node --version
```

Expected: `v24.15.0` or newer.

- [ ] **Step 6: Run the complete project check**

Run:

```bash
pnpm check
```

Expected: Biome, TypeScript, and all Vitest suites exit 0.

- [ ] **Step 7: Review formatting and scope**

Run:

```bash
git diff --check
git status --short
git diff -- src/shared/provider-detection.ts tests/provider-registry.test.ts
```

Expected: no whitespace errors; implementation changes are limited to the detector and its regression test. The previously committed design spec and this plan document may also appear in repository history or status, but no provider adapter, parser, projection, configuration, or consumer file changes.

- [ ] **Step 8: Commit the implementation**

```bash
git add src/shared/provider-detection.ts tests/provider-registry.test.ts
git commit -m "fix: recognize MiniMax OpenAI provider alias"
```
