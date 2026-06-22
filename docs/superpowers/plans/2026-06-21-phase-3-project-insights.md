# Phase 3: Insight Infrastructure + Project Breakdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `category` field to insights, extract project names from session CWD during the offline scan, compute a "Top projects" breakdown (capped at 5 with overflow summary), and render insights grouped by category in the dashboard.

**Architecture:** Five tasks in sequence. Task 3.1 adds the `category` field to types and tags existing insights as `"cost"`. Task 3.2 enriches the JSONL scan to extract session CWD and set `project` on each turn. Task 3.3 adds project grouping to `buildInsights()`. Task 3.4 replaces the flat insights list in the dashboard with category-grouped rendering (tables for breakdown categories, bullet list for cost patterns). Task 3.5 caps project insights at 5, with a `+N more` overflow row aggregating the remaining projects. This also establishes the rendering infrastructure that Phase 4 builds on.

**Tech Stack:** TypeScript, Vitest, TUI rendering

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-enhancements-design.md` → Feature 2 (part 1)

**Parent plan:** `docs/superpowers/plans/2026-06-21-dashboard-enhancements.md` → Phase 3

**Prerequisite:** None (independent of Phases 1-2)

---

## File Map

| File                      | Action | Responsibility                                                                                                                                                    |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/offline.ts`     | Modify | Add `category` to `InsightItem`; add `project` to `UsageTurn`; add `projectFromCwd()` helper; extract CWD in scan loop; add project insights to `buildInsights()` |
| `src/shared/types.ts`     | Modify | Add `category` to `UsageInsight`                                                                                                                                  |
| `src/tui/dashboard.ts`    | Modify | Add `renderInsightsByCategory()` method; update insights rendering block                                                                                          |
| `tests/offline.test.ts`   | Modify | Project extraction tests; project insight tests                                                                                                                   |
| `tests/dashboard.test.ts` | Modify | Category-grouped rendering test                                                                                                                                   |

---

### Task 3.1: Add category field to InsightItem and UsageInsight

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

Expected: PASS — `category` is optional, existing tests don't assert on it.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts src/shared/types.ts
git commit -m "feat(types): add category field to InsightItem and UsageInsight"
```

---

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

**1. Add `project` to the `UsageTurn` interface:**

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

**2. Add a helper to extract project from CWD (place near other helpers, before `scanOfflineUsage`):**

```ts
function projectFromCwd(cwd: unknown): string | undefined {
  if (typeof cwd !== "string" || !cwd) return undefined;
  const segments = cwd.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || undefined;
}
```

**3. In `scanOfflineUsage()`, inside the per-file loop, track session CWD.**

The scan loop reads lines from each JSONL file. Add session-level state before the line iteration, and check for session headers:

```ts
// Inside the per-file loop, before iterating lines:
let sessionProject: string | undefined;

// When processing each line, before the existing parseLine call:
try {
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (parsed?.type === "session" && parsed.cwd) {
    sessionProject = projectFromCwd(parsed.cwd);
    continue;
  }
} catch {
  // fall through to existing parseLine logic
}
```

**4. After `parseLine()` returns a turn, set `turn.project`:**

```ts
const turn = parseLine(line, sessionId);
if (!turn) continue;
turn.project = sessionProject;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract project name from session CWD"
```

---

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

In `src/core/offline.ts`, in the `buildInsights()` function, add project grouping after the existing `top5` calculation but before the return statement:

```ts
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
```

Then update the return to prepend project insights:

```ts
return [
  ...projectInsights,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS. The existing `"produces five insight rows"` test should still pass because those turns have no `project` field, so `projectInsights` will be empty and the array is still length 5.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(insights): add project breakdown by cost"
```

---

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

In `src/tui/dashboard.ts`, find the insights rendering block inside `renderUsageStatistics()` (around lines 383-398).

**Replace the flat list rendering:**

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

**Add the `renderInsightsByCategory` method to `UsageDashboardComponent`:**

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
      const maxLabelLen = Math.max(
        ...items.map((i) => i.label.length),
        header.length,
      );
      const headerLine = `  ${padVisible(this.theme.dim(header), maxLabelLen + 2, "left")}  ${this.theme.dim(pctHeader)}`;
      lines.push(headerLine);
      for (const item of items) {
        const label = padVisible(
          this.theme.dim(item.label),
          maxLabelLen + 2,
          "left",
        );
        lines.push(`  ${label}  ${this.theme.dim(item.detail)}`);
      }
    }
  }

  return lines;
}
```

Note: `padVisible` and `formatCurrency` are already imported/available in the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/dashboard.test.ts`

Expected: PASS. The existing test `"uses enter/space for expand, v for insights"` uses `mkState()` which has `insights: [{ label: "x", cost: 1, detail: "y" }]` — no category, so it defaults to `"cost"` and renders under "Cost patterns". The test checks `toContain("Insights")` which is the section title, still present.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tui/dashboard.ts tests/dashboard.test.ts
git commit -m "feat(tui): render insights grouped by category"
```

---

### Task 3.5: Cap project insights at 5 with overflow summary

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for project cap with overflow**

Add to the `describe("insights", ...)` block in `tests/offline.test.ts`, after the existing project insight tests:

```ts
it("caps project insights at 5 with overflow summary", () => {
  const turns = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    sessionId: `s${i}`,
    timestamp: i,
    provider: "p",
    model: "m",
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 2,
    cost: 7 - i,
    project: `proj-${String.fromCharCode(97 + i)}`,
  }));
  const insights = buildInsights(turns);
  const projectInsights = insights.filter((i) => i.category === "project");
  expect(projectInsights).toHaveLength(6);
  expect(projectInsights[0].label).toBe("proj-a");
  expect(projectInsights[4].label).toBe("proj-e");
  expect(projectInsights[5].label).toBe("+2 more");
  expect(projectInsights[5].cost).toBe(3);
  expect(projectInsights[5].detail).toContain("10.7%");
});
```

Math check: 7 turns with costs [7, 6, 5, 4, 3, 2, 1], totalCost = 28. Top 5 costs sum to 25. Remaining 2 projects cost 2 + 1 = 3. `pct(3)` = `((100 * 3) / 28).toFixed(1)` = `"10.7%"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — currently all 7 projects are returned, but test expects only 6 items (5 + overflow).

- [ ] **Step 3: Implement project cap in buildInsights**

In `src/core/offline.ts`, replace the current `projectInsights` construction (lines 370-377):

```ts
// Replace this:
const projectInsights: InsightItem[] = [...byProject.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([project, cost]) => ({
    category: "project",
    label: project,
    cost,
    detail: pct(cost),
  }));

// With this:
const maxProjects = 5;
const allProjectEntries = [...byProject.entries()].sort(
  (a, b) => b[1] - a[1],
);
const projectInsights: InsightItem[] = allProjectEntries
  .slice(0, maxProjects)
  .map(([project, cost]) => ({
    category: "project",
    label: project,
    cost,
    detail: pct(cost),
  }));
if (allProjectEntries.length > maxProjects) {
  const remainingCost = allProjectEntries
    .slice(maxProjects)
    .reduce((sum, [, c]) => sum + c, 0);
  projectInsights.push({
    category: "project",
    label: `+${allProjectEntries.length - maxProjects} more`,
    cost: remainingCost,
    detail: pct(remainingCost),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS. The existing `"produces project breakdown insights"` test (2 projects, under the cap) still passes unchanged. The new test verifies the cap and overflow row.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(insights): cap project insights at 5 with overflow summary"
```
