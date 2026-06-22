# Phase 2: Provider Enable/Disable Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to disable specific live providers via a `usage.json` config file so they produce no API calls, cache writes, or dashboard cards.

**Architecture:** A `UsageConfig` type gates provider inclusion. `loadConfig()` reads `$PI_CODING_AGENT_DIR/extensions/usage.json` at bootstrap. Disabled providers are filtered from the registry before any fetches. All downstream logic (live runtime, cache watcher, dashboard) operates on the filtered set automatically.

**Tech Stack:** TypeScript, Vitest, Node.js `readFile`

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-enhancements-design.md` → Feature 1

**Parent plan:** `docs/superpowers/plans/2026-06-21-dashboard-enhancements.md` → Phase 2

**Prerequisite:** None (independent of Phase 1)

---

## File Map

| File                       | Action | Responsibility                                        |
| -------------------------- | ------ | ----------------------------------------------------- |
| `src/shared/types.ts`      | Modify | Add `UsageConfig` interface                           |
| `src/core/usage-core.ts`   | Modify | Add `loadConfig()`, filter providers in `bootstrap()` |
| `tests/usage-core.test.ts` | Modify | Config loading + provider filtering tests             |

---

### Task 2.1: Add UsageConfig type

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the UsageConfig interface**

Append after the `UsageDashboardState` interface (around line 136) in `src/shared/types.ts`:

```ts
export interface UsageConfig {
  providers?: Partial<Record<ProviderId, { enabled?: boolean }>>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS (new type, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add UsageConfig interface for provider toggle"
```

---

### Task 2.2: Implement loadConfig and provider filtering

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `tests/usage-core.test.ts`

- [ ] **Step 1: Write failing tests for config loading**

Add a new `describe("config loading", ...)` block at the end of `tests/usage-core.test.ts`. The file already imports `createUsageCore` and has a `createTestDeps(root, overrides?)` helper (lines 16-29). Add the following imports to the top of the file if not already present:

```ts
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
```

Then add the describe block:

```ts
describe("config loading", () => {
  function mkTmp(): string {
    return mkdtempSync(join(tmpdir(), "pi-usage-config-"));
  }

  it("loads config and filters disabled providers", async () => {
    const root = mkTmp();
    const extDir = join(root, "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(
      join(extDir, "usage.json"),
      JSON.stringify({ providers: { minimax: { enabled: false } } }),
    );
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "s.jsonl"), "", "utf8");

    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    await core.bootstrap();
    const state = core.getState();

    expect(
      state.providers.find((p) => p.providerId === "minimax"),
    ).toBeUndefined();
    expect(
      state.providers.find((p) => p.providerId === "openai-codex"),
    ).toBeDefined();

    rmSync(root, { recursive: true, force: true });
  });

  it("treats missing config file as all providers enabled", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "s.jsonl"), "", "utf8");

    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    await core.bootstrap();
    const state = core.getState();

    const ids = state.providers.map((p) => p.providerId);
    expect(ids).toContain("openai-codex");
    expect(ids).toContain("minimax");

    rmSync(root, { recursive: true, force: true });
  });

  it("ignores malformed config JSON", async () => {
    const root = mkTmp();
    const extDir = join(root, "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(join(extDir, "usage.json"), "not json!!!");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "s.jsonl"), "", "utf8");

    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    await core.bootstrap();
    const state = core.getState();

    const ids = state.providers.map((p) => p.providerId);
    expect(ids).toContain("minimax");

    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/usage-core.test.ts`

Expected: FAIL — the config loading logic doesn't exist yet, so the disabled-provider test should fail.

- [ ] **Step 3: Implement loadConfig and filtering in usage-core.ts**

In `src/core/usage-core.ts`:

**Add imports at the top:**

```ts
import { join } from "node:path";
import type { UsageConfig } from "../shared/types.ts";
```

**Add `loadConfig` function before `createUsageCore`:**

```ts
async function loadConfig(deps: UsageDeps): Promise<UsageConfig> {
  try {
    const configPath = join(deps.agentDir(), "extensions", "usage.json");
    const raw = await deps.readFile(configPath, "utf8");
    return JSON.parse(raw as string) as UsageConfig;
  } catch {
    return {};
  }
}
```

**Change `const` to `let` for provider registry variables (lines 52-58):**

```ts
// Before:
const providers = createProviderRegistry(deps);
const liveProviderIds = new Set(
  providers.filter((p) => p.strategy === "api").map((p) => p.id),
);
const liveProviderSnapshotFiles = new Set(
  [...liveProviderIds].map((id) => `${id}.json`),
);

// After:
let providers = createProviderRegistry(deps);
let liveProviderIds = new Set(
  providers.filter((p) => p.strategy === "api").map((p) => p.id),
);
let liveProviderSnapshotFiles = new Set(
  [...liveProviderIds].map((id) => `${id}.json`),
);
```

**Update `bootstrap()` to load config and filter (lines 202-206):**

```ts
// Before:
async function bootstrap(): Promise<void> {
  await Promise.all([populateProviders(false), refreshOffline(false)]);
  state.diagnostics = ["live runtime ready"];
  emit(USAGE_CORE_READY_EVENT);
}

// After:
async function bootstrap(): Promise<void> {
  const config = await loadConfig(deps);
  if (config.providers) {
    providers = providers.filter((p) => {
      const setting = config.providers?.[p.id];
      return setting?.enabled !== false;
    });
    liveProviderIds = new Set(
      providers.filter((p) => p.strategy === "api").map((p) => p.id),
    );
    liveProviderSnapshotFiles = new Set(
      [...liveProviderIds].map((id) => `${id}.json`),
    );
  }
  await Promise.all([populateProviders(false), refreshOffline(false)]);
  state.diagnostics = ["live runtime ready"];
  emit(USAGE_CORE_READY_EVENT);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/usage-core.test.ts`

Expected: PASS — all existing tests plus the new config tests.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/usage-core.ts tests/usage-core.test.ts
git commit -m "feat(core): add provider enable/disable toggle via extensions/usage.json"
```
