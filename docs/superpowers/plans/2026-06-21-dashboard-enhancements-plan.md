# Dashboard Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider enable/disable config, richer insights (project/skill/MCP breakdowns), and a spacing fix to the pi-usage dashboard.

**Architecture:** Four independent phases, each producing a usable result. Phase 1 is a one-line spacing fix. Phase 2 adds config-driven provider toggling. Phases 3-4 enrich the offline scan and dashboard insights view with project, skill, and MCP server breakdowns.

**Tech Stack:** TypeScript, Vitest, Pi extension API (`@earendil-works/pi-coding-agent`), TUI rendering

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-enhancements-design.md`

---

## File Map

| File                       | Action | Responsibility                                                                                                                                        |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tui/dashboard.ts`     | Modify | Phase 1: spacing fix; Phase 3: category-grouped insights rendering                                                                                    |
| `src/shared/types.ts`      | Modify | Phase 2: `UsageConfig` type; Phase 3: `category` field on `UsageInsight`                                                                              |
| `src/core/usage-core.ts`   | Modify | Phase 2: load config, filter disabled providers                                                                                                       |
| `src/core/offline.ts`      | Modify | Phase 3: extract CWD, enrich `UsageTurn`; Phase 3: project insights in `buildInsights()`; Phase 4: extract skills + MCP tools, add skill/MCP insights |
| `tests/dashboard.test.ts`  | Modify | Phase 1: adjust for spacing; Phase 3: insights rendering tests                                                                                        |
| `tests/offline.test.ts`    | Modify | Phase 3: project extraction + project insights tests; Phase 4: skill + MCP extraction + insights tests                                                |
| `tests/usage-core.test.ts` | Modify | Phase 2: config loading + provider filtering tests                                                                                                    |

---

## Phase 1: Spacing Fix

### Task 1.1: Add empty line between "Usage Statistics" title and period tabs

**Files:**

- Modify: `src/tui/dashboard.ts:364-377`
- Modify: `tests/dashboard.test.ts` (affected rendering assertions)

- [ ] **Step 1: Update the rendering method**

In `src/tui/dashboard.ts`, method `renderUsageStatistics()`, add an empty line between the section title and the tabs:

```ts
// Find this block (lines 364-377):
private renderUsageStatistics(w: number, lines: string[]): void {
    lines.push(
      this.sectionTitle(
        UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics,
      ),
    );

    lines.push(
      ...this.renderTabs(
        PERIODS.map((period) => PERIOD_LABELS[period]),
        this.periodIndex,
        w,
      ),
    );

// Replace with:
private renderUsageStatistics(w: number, lines: string[]): void {
    lines.push(
      this.sectionTitle(
        UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics,
      ),
    );
    lines.push("");

    lines.push(
      ...this.renderTabs(
        PERIODS.map((period) => PERIOD_LABELS[period]),
        this.periodIndex,
        w,
      ),
    );
```

- [ ] **Step 2: Run tests to check what breaks**

Run: `pnpm test -- tests/dashboard.test.ts`

Some render snapshot assertions may fail because they expect the old line ordering. Note which tests fail.

- [ ] **Step 3: Fix any failing dashboard tests**

If tests assert exact line positions or patterns that now shift by one line due to the empty line, update those assertions. The empty line appears between the "Usage Statistics" title and the `[All Time]` tab line in the render output.

- [ ] **Step 4: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tui/dashboard.ts tests/dashboard.test.ts
git commit -m "fix(tui): add spacing between Usage Statistics title and period tabs"
```

---

## Phase 2: Provider Enable/Disable Toggle

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

### Task 2.2: Implement loadConfig and provider filtering

**Files:**

- Modify: `src/core/usage-core.ts`
- Modify: `tests/usage-core.test.ts`

- [ ] **Step 1: Write failing tests for config loading**

Add a new `describe("config loading", ...)` block at the end of `tests/usage-core.test.ts`:

```ts
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Add this describe block after the existing test blocks:

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
    // Create a session file so bootstrap has something to scan
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "s.jsonl"), "", "utf8");

    const core = createUsageCore({
      deps: createTestDeps(root),
      onEmit: () => {},
    });
    await core.bootstrap();
    const state = core.getState();

    // minimax should be excluded from providers
    expect(
      state.providers.find((p) => p.providerId === "minimax"),
    ).toBeUndefined();
    // other providers should still be present
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

    // All live providers should be present (though unavailable without credentials)
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

    // Should not crash, all providers present
    const ids = state.providers.map((p) => p.providerId);
    expect(ids).toContain("minimax");

    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/usage-core.test.ts`

Expected: FAIL — `createTestDeps` may not exist in that file (check the existing helper name; it may be `createTestDeps` or inline). Also, the config loading logic doesn't exist yet so the disabled-provider test should fail.

- [ ] **Step 3: Implement loadConfig and filtering in usage-core.ts**

In `src/core/usage-core.ts`, add the `loadConfig` function and update `createUsageCore`:

```ts
// Add import at the top:
import { join } from "node:path";
import type { UsageConfig } from "../shared/types.ts";

// Add this function before createUsageCore:
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

Then change `createUsageCore` to accept config and filter providers. The cleanest approach: make `createUsageCore` async or add an `init()` step. Since `bootstrap()` is already async and called before anything else, load config there and filter before the first fetch.

Update the function:

```ts
export function createUsageCore(options: UsageCoreOptions): UsageCore {
  const { deps, onEmit } = options;

  // --- Provider registry (created once, filtered after config load) ---
  let providers = createProviderRegistry(deps);
  let liveProviderIds = new Set(
    providers.filter((p) => p.strategy === "api").map((p) => p.id),
  );
  let liveProviderSnapshotFiles = new Set(
    [...liveProviderIds].map((id) => `${id}.json`),
  );

  // ... (rest of state and internal variables unchanged) ...

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

  // ... rest unchanged ...
}
```

Note: change `const providers` to `let providers`, `const liveProviderIds` to `let liveProviderIds`, `const liveProviderSnapshotFiles` to `let liveProviderSnapshotFiles`.

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

---

## Phase 3: Insight Infrastructure + Project Breakdown

### Task 3.1: Add category field to InsightItem

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add category to InsightItem in offline.ts**

In `src/core/offline.ts`, update the `InsightItem` interface (around line 287):

```ts
export interface InsightItem {
  category?: string;
  label: string;
  cost: number;
  detail: string;
}
```

- [ ] **Step 2: Add category to UsageInsight in types.ts**

In `src/shared/types.ts`, update the `UsageInsight` interface (around line 108):

```ts
export interface UsageInsight {
  category?: string;
  label: string;
  cost: number;
  detail: string;
}
```

- [ ] **Step 3: Tag existing insights with category "cost"**

In `src/core/offline.ts`, in `buildInsights()`, add `category: "cost"` to each of the five existing insight items in the return array (around line 344):

```ts
return [
  {
    category: "cost",
    label: "Parallel sessions",
    cost: parallelCost,
    detail: `${pct(parallelCost)} cost while >=4 active`,
  },
  {
    category: "cost",
    label: "Large context",
    cost: largeContext,
    detail: `${pct(largeContext)} over 150k context`,
  },
  {
    category: "cost",
    label: "Large uncached",
    cost: largeUncached,
    detail: `${pct(largeUncached)} over 100k input`,
  },
  {
    category: "cost",
    label: "Long sessions",
    cost: longSessionCost,
    detail: `${pct(longSessionCost)} from 8h+ sessions`,
  },
  {
    category: "cost",
    label: "Top-5 concentration",
    cost: top5,
    detail: `${pct(top5)} in top 5 sessions`,
  },
];
```

- [ ] **Step 4: Run tests**

Run: `pnpm check`

Expected: PASS — category is optional, existing tests don't assert on it.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts src/shared/types.ts
git commit -m "feat(types): add category field to InsightItem and UsageInsight"
```

### Task 3.2: Extract session CWD and add project field to UsageTurn

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for project extraction**

Add to the `describe("offline scanner", ...)` block in `tests/offline.test.ts`:

```ts
it("extracts project name from session header cwd", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions", "proj");
  mkdirSync(sessions, { recursive: true });
  const sessionHeader = JSON.stringify({
    type: "session",
    version: 3,
    id: "test-session",
    timestamp: "2026-05-30T10:00:00Z",
    cwd: "/Users/dev/career-ops",
  });
  const message = JSON.stringify({
    type: "message",
    id: "m1",
    timestamp: "2026-05-30T11:00:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.5 },
    },
  });
  writeFileSync(
    join(sessions, "s.jsonl"),
    `${sessionHeader}\n${message}\n`,
    "utf8",
  );
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-05-30T12:00:00Z"),
  });
  expect(result.turns).toHaveLength(1);
  expect(result.turns[0].project).toBe("career-ops");
  rmSync(root, { recursive: true, force: true });
});

it("falls back to undefined project when no session header", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const message = JSON.stringify({
    type: "message",
    id: "m1",
    timestamp: "2026-05-30T11:00:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
    },
  });
  writeFileSync(join(sessions, "s.jsonl"), `${message}\n`, "utf8");
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
  });
  expect(result.turns[0].project).toBeUndefined();
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — `project` property doesn't exist on `UsageTurn` yet.

- [ ] **Step 3: Implement CWD extraction**

In `src/core/offline.ts`:

1. Add `project` to the `UsageTurn` interface:

```ts
export interface UsageTurn {
  id: string;
  sessionId: string;
  timestamp: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  project?: string;
}
```

2. Add a helper to extract project from CWD:

```ts
function projectFromCwd(cwd: unknown): string | undefined {
  if (typeof cwd !== "string" || !cwd) return undefined;
  const segments = cwd.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || undefined;
}
```

3. In `scanOfflineUsage()`, inside the file-reading loop (around line 234 where each JSONL file is processed line by line), track the session's CWD. Currently the code reads lines from each file. Add session-level state tracking:

```ts
// Inside the per-file loop, before iterating lines:
let sessionProject: string | undefined;

// When parsing each line, before the existing parseLine call:
// Check for session header to extract CWD
try {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (parsed?.type === "session" && parsed.cwd) {
    sessionProject = projectFromCwd(parsed.cwd);
    continue; // session headers are not turns
  }
} catch {
  // fall through to existing parseLine logic
}
```

4. After `parseLine()` returns a turn, set `turn.project = sessionProject`:

```ts
const turn = parseLine(line, sessionId);
if (!turn) continue;
turn.project = sessionProject;
```

Note: The exact location depends on the current loop structure. The key change is: parse `type: "session"` entries to extract `cwd`, store as session-level state, and apply to each turn in that file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract project name from session CWD"
```

### Task 3.3: Add project insights to buildInsights

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for project insights**

Add to the `describe("insights", ...)` block in `tests/offline.test.ts`:

```ts
it("produces project breakdown insights", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 9,
      project: "career-ops",
    },
    {
      id: "2",
      sessionId: "s2",
      timestamp: 2,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 1,
      project: "dotfiles",
    },
  ];
  const insights = buildInsights(turns);
  const projectInsights = insights.filter((i) => i.category === "project");
  expect(projectInsights.length).toBeGreaterThanOrEqual(2);
  expect(projectInsights[0].label).toBe("career-ops");
  expect(projectInsights[0].detail).toContain("90.0%");
  expect(projectInsights[1].label).toBe("dotfiles");
});

it("omits project insights when no projects are set", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 1,
    },
  ];
  const insights = buildInsights(turns);
  const projectInsights = insights.filter((i) => i.category === "project");
  expect(projectInsights).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — no insights with `category: "project"` produced yet.

- [ ] **Step 3: Implement project insights in buildInsights**

In `src/core/offline.ts`, in the `buildInsights()` function, add project grouping before the return statement:

```ts
// After the existing top5 calculation, before the return:
const byProject = new Map<string, number>();
for (const t of turns) {
  if (t.project) {
    byProject.set(t.project, (byProject.get(t.project) ?? 0) + t.cost);
  }
}
const projectInsights: InsightItem[] = [...byProject.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([project, cost]) => ({
    category: "project",
    label: project,
    cost,
    detail: pct(cost),
  }));

// Update the return to prepend project insights:
return [
  ...projectInsights,
  // ... existing 5 cost insights (with category: "cost") ...
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Update existing insight count test**

The existing test `"produces five insight rows"` asserts `toHaveLength(5)`. Since those turns have no `project` set, it should still be 5. Verify this by running:

Run: `pnpm test -- tests/offline.test.ts`

If the test still passes, no change needed. If it fails because the test turns now produce project insights (unlikely since they have no `project` field), update the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(insights): add project breakdown by cost"
```

### Task 3.4: Category-grouped insights rendering in dashboard

**Files:**

- Modify: `src/tui/dashboard.ts`
- Modify: `tests/dashboard.test.ts`

- [ ] **Step 1: Write failing test for category-grouped rendering**

Add a new test in the `describe("dashboard rendering", ...)` block in `tests/dashboard.test.ts`:

```ts
it("renders insights grouped by category", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "career-ops", cost: 9, detail: "90.0%" },
    { category: "project", label: "dotfiles", cost: 1, detail: "10.0%" },
    {
      category: "cost",
      label: "Large context",
      cost: 5,
      detail: "50.0% over 150k context",
    },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  c.handleInput("v");
  const out = c.render(100).join("\n");
  expect(out).toContain("Projects");
  expect(out).toContain("career-ops");
  expect(out).toContain("90.0%");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("Large context");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/dashboard.test.ts`

Expected: FAIL — "Projects" category header not rendered.

- [ ] **Step 3: Implement category-grouped rendering**

In `src/tui/dashboard.ts`, update the insights rendering block inside `renderUsageStatistics()` (around lines 383-398). Replace the flat list rendering:

```ts
// Find this block:
if (this.showInsights) {
  lines.push(
    this.sectionTitle(UI_STRINGS.dashboardBorderedSectionTitles.insights),
  );
  if (this.state.insights.length === 0) {
    lines.push(this.theme.dim("No insights yet."));
  } else {
    for (const item of this.state.insights) {
      lines.push(
        this.theme.dim(
          `- ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
        ),
      );
    }
  }
  return;
}

// Replace with:
if (this.showInsights) {
  lines.push(
    this.sectionTitle(UI_STRINGS.dashboardBorderedSectionTitles.insights),
  );
  if (this.state.insights.length === 0) {
    lines.push(this.theme.dim("No insights yet."));
  } else {
    lines.push(...this.renderInsightsByCategory(w));
  }
  return;
}
```

Then add the `renderInsightsByCategory` method to the class:

```ts
private renderInsightsByCategory(w: number): string[] {
  const lines: string[] = [];
  const categoryOrder = ["project", "skill", "mcp", "cost"];
  const categoryLabels: Record<string, string> = {
    project: "Projects",
    skill: "Skills",
    mcp: "MCP servers",
    cost: "Cost patterns",
  };

  // Group insights by category
  const grouped = new Map<string, typeof this.state.insights>();
  for (const item of this.state.insights) {
    const cat = item.category ?? "cost";
    const list = grouped.get(cat) ?? [];
    list.push(item);
    grouped.set(cat, list);
  }

  for (const cat of categoryOrder) {
    const items = grouped.get(cat);
    if (!items || items.length === 0) continue;
    lines.push("");
    const header = categoryLabels[cat] ?? cat;
    if (cat === "cost") {
      lines.push(this.theme.dim(header));
      for (const item of items) {
        lines.push(
          this.theme.dim(
            `  - ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
          ),
        );
      }
    } else {
      const pctHeader = "% of usage";
      const maxLabelLen = Math.max(...items.map((i) => i.label.length), header.length);
      const headerLine = `  ${padVisible(this.theme.dim(header), maxLabelLen + 2, "left")}  ${this.theme.dim(pctHeader)}`;
      lines.push(headerLine);
      for (const item of items) {
        const label = padVisible(this.theme.dim(item.label), maxLabelLen + 2, "left");
        lines.push(`  ${label}  ${this.theme.dim(item.detail)}`);
      }
    }
  }

  return lines;
}
```

Import `padVisible` is already imported at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/dashboard.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify existing insight toggle test still works**

The test `"uses enter/space for expand, v for insights"` checks `toContain("Insights")`. The `mkState()` factory has `insights: [{ label: "x", cost: 1, detail: "y" }]` which has no category (defaults to `"cost"`). Verify this test still passes — it should since uncategorized items fall into "Cost patterns".

- [ ] **Step 6: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard.ts tests/dashboard.test.ts
git commit -m "feat(tui): render insights grouped by category"
```

---

## Phase 4: Skill and MCP Server Breakdowns

### Task 4.1: Extract skill invocations from user messages

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for skill extraction**

Add to `describe("offline scanner", ...)` in `tests/offline.test.ts`:

```ts
it("tags turns with the active skill from user messages", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const skillMessage = JSON.stringify({
    type: "message",
    id: "u1",
    timestamp: "2026-05-30T10:00:00Z",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: '<skill name="career-ops" location="/path/to/SKILL.md">\nSkill content\n</skill>\nDo the thing',
        },
      ],
    },
  });
  const assistantTurn = JSON.stringify({
    type: "message",
    id: "a1",
    timestamp: "2026-05-30T10:01:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
    },
  });
  const secondSkill = JSON.stringify({
    type: "message",
    id: "u2",
    timestamp: "2026-05-30T10:02:00Z",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: '<skill name="writing-plans" location="/p">\ncontent\n</skill>',
        },
      ],
    },
  });
  const assistantTurn2 = JSON.stringify({
    type: "message",
    id: "a2",
    timestamp: "2026-05-30T10:03:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 2.0 },
    },
  });
  writeFileSync(
    join(sessions, "s.jsonl"),
    [skillMessage, assistantTurn, secondSkill, assistantTurn2].join("\n") +
      "\n",
    "utf8",
  );
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-05-30T12:00:00Z"),
  });
  expect(result.turns).toHaveLength(2);
  expect(result.turns[0].activeSkill).toBe("career-ops");
  expect(result.turns[1].activeSkill).toBe("writing-plans");
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — `activeSkill` doesn't exist yet.

- [ ] **Step 3: Implement skill extraction**

In `src/core/offline.ts`:

1. Add `activeSkill` to `UsageTurn`:

```ts
export interface UsageTurn {
  // ... existing fields ...
  project?: string;
  activeSkill?: string;
}
```

2. Add a skill extraction helper:

```ts
const SKILL_NAME_RE = /<skill\s+name="([^"]+)"/;

function extractSkillName(line: string): string | undefined {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row?.type !== "message") return undefined;
    const message = row.message as Record<string, unknown> | undefined;
    if (message?.role !== "user") return undefined;
    const content = message.content;
    if (!Array.isArray(content)) return undefined;
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text"
      ) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") {
          const match = SKILL_NAME_RE.exec(text);
          if (match) return match[1];
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}
```

3. In the per-file scan loop, track `activeSkill` as session-level state (alongside `sessionProject`):

```ts
let activeSkill: string | undefined;
```

Before calling `parseLine()`, check for skill in user messages:

```ts
const skillName = extractSkillName(line);
if (skillName !== undefined) {
  activeSkill = skillName;
}
```

After `parseLine()` returns a turn:

```ts
turn.activeSkill = activeSkill;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract active skill from user messages"
```

### Task 4.2: Extract MCP tool calls from assistant messages

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for MCP tool extraction**

Add to `describe("offline scanner", ...)` in `tests/offline.test.ts`:

```ts
it("extracts MCP server names from tool call prefixes", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const message = JSON.stringify({
    type: "message",
    id: "a1",
    timestamp: "2026-05-30T10:00:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      content: [
        {
          type: "toolCall",
          id: "c1",
          name: "playwright_browser_click",
          arguments: {},
        },
        { type: "toolCall", id: "c2", name: "read", arguments: {} },
        { type: "toolCall", id: "c3", name: "tavily", arguments: {} },
      ],
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
    },
  });
  writeFileSync(join(sessions, "s.jsonl"), `${message}\n`, "utf8");
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-05-30T12:00:00Z"),
  });
  expect(result.turns).toHaveLength(1);
  // "read" is built-in so excluded; "playwright" from prefix; "tavily" is single-word non-built-in
  expect(result.turns[0].mcpTools).toEqual(
    expect.arrayContaining(["playwright", "tavily"]),
  );
  expect(result.turns[0].mcpTools).not.toContain("read");
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — `mcpTools` doesn't exist yet.

- [ ] **Step 3: Implement MCP tool extraction**

In `src/core/offline.ts`:

1. Add `mcpTools` to `UsageTurn`:

```ts
export interface UsageTurn {
  // ... existing fields ...
  project?: string;
  activeSkill?: string;
  mcpTools?: string[];
}
```

2. Add the built-in tools set and the extraction helper:

```ts
const BUILTIN_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "web_search",
  "questionnaire",
  "get_subagent_result",
  "ask_user_question",
  "Agent",
  "mcp",
]);

function extractMcpServers(
  message: Record<string, unknown>,
): string[] | undefined {
  const content = message.content;
  if (!Array.isArray(content)) return undefined;
  const servers = new Set<string>();
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "toolCall"
    ) {
      const name = (block as Record<string, unknown>).name;
      if (typeof name !== "string") continue;
      if (BUILTIN_TOOLS.has(name)) continue;
      const firstSegment = name.split("_")[0];
      if (firstSegment) servers.add(firstSegment);
    }
  }
  return servers.size > 0 ? [...servers] : undefined;
}
```

3. In `parseLine()`, after building the turn, extract MCP tools from the message:

```ts
// In parseLine(), after constructing turnBase but before return:
const mcpTools = extractMcpServers(message as Record<string, unknown>);
return { id, ...turnBase, mcpTools };
```

Note: `parseLine` currently only looks at `message.usage` — the `message.content` array is available on the same `message` object. Just pass it to `extractMcpServers`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract MCP server names from tool call prefixes"
```

### Task 4.3: Add skill and MCP server insights to buildInsights

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing tests for skill and MCP insights**

Add to `describe("insights", ...)` in `tests/offline.test.ts`:

```ts
it("produces skill breakdown insights", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 8,
      activeSkill: "career-ops",
    },
    {
      id: "2",
      sessionId: "s1",
      timestamp: 2,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 2,
    },
  ];
  const insights = buildInsights(turns);
  const skillInsights = insights.filter((i) => i.category === "skill");
  expect(skillInsights.length).toBeGreaterThanOrEqual(2);
  expect(skillInsights[0].label).toBe("/career-ops");
  expect(skillInsights[0].detail).toContain("80.0%");
  // Turn without skill grouped as "(no skill)"
  const noSkill = skillInsights.find((i) => i.label === "(no skill)");
  expect(noSkill).toBeDefined();
});

it("produces MCP server breakdown insights", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 5,
      mcpTools: ["playwright"],
    },
    {
      id: "2",
      sessionId: "s1",
      timestamp: 2,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 3,
      mcpTools: ["playwright", "firefox"],
    },
    {
      id: "3",
      sessionId: "s1",
      timestamp: 3,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 2,
    },
  ];
  const insights = buildInsights(turns);
  const mcpInsights = insights.filter((i) => i.category === "mcp");
  // playwright: $5 + $3 = $8, firefox: $3
  expect(mcpInsights.length).toBeGreaterThanOrEqual(2);
  expect(mcpInsights[0].label).toBe("playwright");
  expect(mcpInsights[1].label).toBe("firefox");
});

it("omits skill/mcp insights when no data present", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 1,
    },
  ];
  const insights = buildInsights(turns);
  expect(insights.filter((i) => i.category === "skill")).toHaveLength(0);
  expect(insights.filter((i) => i.category === "mcp")).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — no skill or MCP insights produced.

- [ ] **Step 3: Implement skill and MCP insights in buildInsights**

In `src/core/offline.ts`, in `buildInsights()`, add skill and MCP grouping after the project insights block:

```ts
// Skill insights
const bySkill = new Map<string, number>();
let hasAnySkill = false;
for (const t of turns) {
  if (t.activeSkill) {
    hasAnySkill = true;
    const key = `/${t.activeSkill}`;
    bySkill.set(key, (bySkill.get(key) ?? 0) + t.cost);
  } else {
    bySkill.set("(no skill)", (bySkill.get("(no skill)") ?? 0) + t.cost);
  }
}
const skillInsights: InsightItem[] = hasAnySkill
  ? [...bySkill.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([skill, cost]) => ({
        category: "skill",
        label: skill,
        cost,
        detail: pct(cost),
      }))
  : [];

// MCP server insights
const byMcp = new Map<string, number>();
for (const t of turns) {
  if (t.mcpTools) {
    for (const server of t.mcpTools) {
      byMcp.set(server, (byMcp.get(server) ?? 0) + t.cost);
    }
  }
}
const mcpInsights: InsightItem[] = [...byMcp.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([server, cost]) => ({
    category: "mcp",
    label: server,
    cost,
    detail: pct(cost),
  }));
```

Update the return statement to include all categories:

```ts
return [
  ...projectInsights,
  ...skillInsights,
  ...mcpInsights,
  {
    category: "cost",
    label: "Parallel sessions",
    cost: parallelCost,
    detail: `${pct(parallelCost)} cost while >=4 active`,
  },
  // ... other 4 cost insights unchanged ...
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(insights): add skill and MCP server breakdowns"
```

---

## Final Verification

- [ ] **Run full check one last time**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Review all changes**

Run: `git log --oneline master..HEAD`

Expected commits (in order):

1. `fix(tui): add spacing between Usage Statistics title and period tabs`
2. `feat(types): add UsageConfig interface for provider toggle`
3. `feat(core): add provider enable/disable toggle via extensions/usage.json`
4. `feat(types): add category field to InsightItem and UsageInsight`
5. `feat(offline): extract project name from session CWD`
6. `feat(insights): add project breakdown by cost`
7. `feat(tui): render insights grouped by category`
8. `feat(offline): extract active skill from user messages`
9. `feat(offline): extract MCP server names from tool call prefixes`
10. `feat(insights): add skill and MCP server breakdowns`
