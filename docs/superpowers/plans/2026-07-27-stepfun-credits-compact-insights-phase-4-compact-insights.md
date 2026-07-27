# Compact Insights categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unsupported Insights period selector with all-time category navigation that stays visible inside Pi's overlay at the minimum supported terminal size.

**Architecture:** Keep `UsageDashboardComponent`, its frame, and its existing tab renderer. Derive populated Insight categories in fixed order, retain one selected category ID as component state, and render only that category's existing capped items. Statistics keeps its separate period state.

**Tech Stack:** TypeScript 6, Vitest 4, pnpm, `@earendil-works/pi-coding-agent` 0.82.1, and `@earendil-works/pi-tui` 0.82.1. The installed packages remain unchanged; Pi 0.82.0 source is used as the overlay sizing reference.

**Design reference:** `docs/superpowers/specs/2026-07-27-compact-insights-design.md`

**Phase dependency:** Phase 3 is committed. The baseline worktree is clean and `pnpm check` passes 258 tests.

**Usable result:** Insights shows only populated all-time categories, Left/Right cycles them independently of Statistics, and the footer and bottom frame remain visible at 40×24.

**Out of scope:** Offline insight calculations, category item caps, provider behavior, scrolling, new TUI components, dependency changes, overlay option changes, and unrelated dashboard refactors.

---

## File map

- Modify `tests/dashboard.test.ts` for category selection, rendering, state-update fallback, and height-budget coverage.
- Modify `tests/constants.test.ts` for the new Insights footer string.
- Modify `src/tui/dashboard.ts` for fixed category descriptors, selected category state, populated-category derivation, rendering, and input handling.
- Modify `src/shared/constants.ts` for the Insights footer shortcut.
- Do not modify Pi dependencies, offline insight generation, provider code, public types, or overlay configuration.

## Fixed behavior contract

- Category order is Projects, Skills, MCP servers, Cost patterns.
- Categories with no items are omitted.
- Missing `category` values map to Cost patterns.
- Unknown category strings remain excluded, matching the current renderer.
- The first populated category is the default.
- Left and Right cycle populated categories with wraparound.
- If the selected category disappears, selection is stored as the first populated category. If the old category returns later, the fallback remains selected.
- Statistics period state is unaffected by Insights navigation.
- Insights does not render Today, This Week, Last Week, or All Time controls.
- At component widths 36, 73, and 100, rendered output must contain at most 20, 17, and 17 lines respectively.
- Pi 0.82.0's reference implementation floors percentage sizes and slices overlay output after `maxHeight`; the current installed 0.82.1 packages remain in use.

---

### Task 1: Add failing category behavior tests

**Files:**

- Modify: `tests/dashboard.test.ts`

- [ ] **Step 1: Add the shared Insights tab helper**

Add this function after `mkState()` and before the first dashboard test:

```ts
function switchToInsights(component: UsageDashboardComponent): void {
  component.handleInput("\t");
  component.handleInput("\t");
}
```

Use this helper in every test that switches from the default Statistics tab to Insights.

- [ ] **Step 2: Replace the first stale grouped-category test**

Replace the test named `renders Insights tab with insights grouped by category` with:

```ts
it("shows only populated Insight categories and defaults to the first", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);

  const out = c.render(100).join("\n");
  expect(out).toContain("[Projects]");
  expect(out).toContain("Cost patterns");
  expect(out).not.toContain("Skills");
  expect(out).not.toContain("MCP servers");
  expect(out).toContain("pi-usage");
  expect(out).not.toContain("Large context");
  expect(out).not.toContain("Today");
  expect(out).not.toContain("This Week");
  expect(out).not.toContain("Last Week");
  expect(out).not.toContain("All Time");
});
```

- [ ] **Step 3: Replace the obsolete independent-period test**

Delete the test named `has independent period selector for Insights tab` and add:

```ts
it("cycles Insight categories without changing the Statistics period", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });

  c.handleInput("\u001b[D");
  expect(c.render(120).join("\n")).toContain("[Last Week]");

  switchToInsights(c);
  c.handleInput("\u001b[C");
  let out = c.render(100).join("\n");
  expect(out).toContain("[Cost patterns]");
  expect(out).toContain("Large context");
  expect(out).not.toContain("pi-usage");

  c.handleInput("\t");
  out = c.render(100).join("\n");
  expect(out).toContain("[Last Week]");
});
```

This proves one Left in Statistics remains active after category navigation. The category test starts with Projects selected and Right moves to Cost patterns.

- [ ] **Step 4: Add durable fallback coverage**

Add:

```ts
it("falls back permanently when the selected Insight category disappears", () => {
  const state = mkState();
  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "90.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "10.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);
  c.handleInput("\u001b[C");
  expect(c.render(100).join("\n")).toContain("[Cost patterns]");

  state.insights = [
    { category: "project", label: "pi-usage", cost: 9, detail: "100.0%" },
  ];
  expect(c.render(100).join("\n")).toContain("[Projects]");

  state.insights.push({
    category: "cost",
    label: "Large context",
    cost: 1,
    detail: "10.0%",
  });
  expect(c.render(100).join("\n")).toContain("[Projects]");
});
```

The final assertion proves the component stores the fallback ID instead of temporarily substituting the first category during rendering.

- [ ] **Step 5: Rewrite the duplicate grouped-rendering test**

Replace the later test named `renders insights grouped by category in Insights tab` with:

```ts
it("renders the selected Insight category with its existing format", () => {
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
  switchToInsights(c);

  let lines = c.render(100);
  let out = lines.join("\n");
  expect(out).toContain("[Projects]");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("career-ops");
  expect(out).toContain("90.0%");
  expect(out).not.toContain("Large context");

  const projectsIdx = lines.findIndex((line) => line.includes("% of usage"));
  expect(projectsIdx).toBeGreaterThan(-1);
  expect(lines[projectsIdx + 1]).toContain("career-ops");

  c.handleInput("\u001b[C");
  lines = c.render(100);
  out = lines.join("\n");
  expect(out).toContain("[Cost patterns]");
  expect(out).toContain("Large context");
  expect(out).toContain("  - Large context:");
  expect(out).not.toContain("career-ops");
});
```

- [ ] **Step 6: Update existing missing-category test to use the helper**

In `defaults insights without category to cost patterns`, replace the two direct Tab calls with:

```ts
switchToInsights(c);
```

Keep its assertions for `Cost patterns` and `No category` unchanged.

- [ ] **Step 7: Run the dashboard tests and confirm the expected failure**

Run:

```sh
pnpm test -- tests/dashboard.test.ts
```

Expected: FAIL because the current implementation renders period tabs, renders every category at once, and stores an Insights period index rather than a category ID. The existing test suite must not be treated as passing until the stale assertions are replaced.

---

### Task 2: Add the height-budget and footer tests

**Files:**

- Modify: `tests/dashboard.test.ts`
- Modify: `tests/constants.test.ts`

- [ ] **Step 1: Add the maximum-category line-budget test**

Add to the dashboard render tests:

```ts
it("keeps a maximum Insight category inside the supported overlay height", () => {
  const state = mkState();
  state.insights = [
    ...Array.from({ length: 6 }, (_, index) => ({
      category: "project",
      label: index === 5 ? "+20 more" : `project-${index + 1}`,
      cost: 6 - index,
      detail: `${30 - index * 4}.0%`,
    })),
    { category: "skill", label: "/brainstorming", cost: 1, detail: "5.0%" },
    { category: "mcp", label: "playwright", cost: 1, detail: "5.0%" },
    { category: "cost", label: "Large context", cost: 1, detail: "5.0%" },
  ];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  switchToInsights(c);

  expect(c.render(36).length).toBeLessThanOrEqual(20);
  expect(c.render(73).length).toBeLessThanOrEqual(17);
  expect(c.render(100).length).toBeLessThanOrEqual(17);
});
```

- [ ] **Step 2: Update the per-tab footer assertion**

In `renders context-aware footer per tab`, replace:

```ts
expect(stripped).toContain("[Left/Right] Period");
```

in the Insights section with:

```ts
expect(stripped).toContain("[Left/Right] Category");
expect(stripped).not.toContain("[Left/Right] Period");
```

Do not change the Statistics or Current Usage footer assertions.

- [ ] **Step 3: Update the constant expectation**

In `tests/constants.test.ts`, replace the Insights expected string with:

```ts
expect(UI_STRINGS.dashboardFooters.insights).toBe(
  "[Tab/Shift-Tab] Switch tab • [Left/Right] Category • [q/Esc] Close",
);
```

- [ ] **Step 4: Run the focused tests and confirm the expected failure**

Run:

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
```

Expected: FAIL because the implementation still advertises Period navigation and renders the old multi-category layout.

---

### Task 3: Implement populated category state and rendering

**Files:**

- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add the fixed category descriptors**

Immediately below `DASHBOARD_TABS`, add:

```ts
const INSIGHT_CATEGORIES = [
  { id: "project", label: "Projects" },
  { id: "skill", label: "Skills" },
  { id: "mcp", label: "MCP servers" },
  { id: "cost", label: "Cost patterns" },
] as const;

type InsightCategoryId = (typeof INSIGHT_CATEGORIES)[number]["id"];

type AvailableInsightCategory = {
  id: InsightCategoryId;
  label: string;
  items: UsageCoreState["insights"];
};
```

- [ ] **Step 2: Replace the unused Insights period state**

Replace:

```ts
private insightsPeriodIndex = DEFAULT_PERIOD_INDEX;
```

with:

```ts
private insightsCategory: InsightCategoryId = "project";
```

Leave `periodIndex` and `DEFAULT_PERIOD_INDEX` unchanged because Statistics still uses them.

- [ ] **Step 3: Add populated-category derivation and durable selection**

Add these methods to `UsageDashboardComponent` before the Insights renderer:

```ts
private availableInsightCategories(): AvailableInsightCategory[] {
  return INSIGHT_CATEGORIES.map((category) => ({
    ...category,
    items: this.state.insights.filter(
      (item) => (item.category ?? "cost") === category.id,
    ),
  })).filter((category) => category.items.length > 0);
}

private activeInsightCategory(
  categories: AvailableInsightCategory[],
): AvailableInsightCategory | undefined {
  const selected = categories.find(
    (category) => category.id === this.insightsCategory,
  );
  if (selected) return selected;
  const fallback = categories[0];
  if (fallback) this.insightsCategory = fallback.id;
  return fallback;
}
```

This derives from current state on every call and updates the stored selection when the previous category disappears.

- [ ] **Step 4: Replace the all-category renderer**

Delete `renderInsightsByCategory` and add:

```ts
private renderInsightCategory(category: AvailableInsightCategory): string[] {
  const lines: string[] = [];
  if (category.id === "cost") {
    lines.push(this.theme.dim(category.label));
    for (const item of category.items) {
      lines.push(
        this.theme.dim(
          `  - ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
        ),
      );
    }
    return lines;
  }

  const maxLabelLen = Math.max(
    ...category.items.map((item) => item.label.length),
    category.label.length,
  );
  lines.push(
    `  ${padVisible(this.theme.dim(category.label), maxLabelLen + 2, "left")}  ${this.theme.dim("% of usage")}`,
  );
  for (const item of category.items) {
    const label = padVisible(
      this.theme.dim(item.label),
      maxLabelLen + 2,
      "left",
    );
    lines.push(`  ${label}  ${this.theme.dim(item.detail)}`);
  }
  return lines;
}
```

This keeps the existing project, skill, MCP, and cost formatting while removing the outer category loop and its extra blank row.

- [ ] **Step 5: Replace the Insights tab renderer**

Replace `renderInsightsTab` with:

```ts
private renderInsightsTab(w: number, lines: string[]): void {
  const categories = this.availableInsightCategories();
  const active = this.activeInsightCategory(categories);
  if (!active) {
    lines.push(this.theme.dim("No insights yet."));
    return;
  }

  lines.push(
    ...this.renderTabs(
      categories.map((category) => category.label),
      categories.findIndex((category) => category.id === active.id),
      w,
    ),
  );
  lines.push("");
  lines.push(...this.renderInsightCategory(active));
}
```

The `active` check covers both an empty insights array and an array containing only unrecognized category strings. Do not retain the old period-filter comment.

- [ ] **Step 6: Replace Insights period input with category input**

Replace `handleInsightsInput` with:

```ts
private handleInsightsInput(data: string): void {
  const delta = matchesKey(data, Key.left)
    ? -1
    : matchesKey(data, Key.right)
      ? 1
      : 0;
  if (!delta) return;

  const categories = this.availableInsightCategories();
  const active = this.activeInsightCategory(categories);
  if (!active) return;
  const index = categories.findIndex(
    (category) => category.id === active.id,
  );
  this.insightsCategory =
    categories[(index + delta + categories.length) % categories.length].id;
}
```

If no recognized categories exist, `active` is undefined and arrow input does nothing.

---

### Task 4: Update the Insights footer and verify the implementation

**Files:**

- Modify: `src/shared/constants.ts`
- Test: `tests/dashboard.test.ts`
- Test: `tests/constants.test.ts`

- [ ] **Step 1: Change the Insights footer constant**

Replace the `insights` entry in `UI_STRINGS.dashboardFooters` with:

```ts
insights: [
  "[Tab/Shift-Tab] Switch tab",
  "[Left/Right] Category",
  "[q/Esc] Close",
].join(" • "),
```

- [ ] **Step 2: Run focused tests and typecheck**

Run:

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
pnpm typecheck
```

Expected: both commands pass. The line-budget test must report no failure at widths 36, 73, or 100.

- [ ] **Step 3: Run the full project check**

Run:

```sh
pnpm check
```

Expected: Biome lint, TypeScript typecheck, and all Vitest tests pass.

- [ ] **Step 4: Inspect the implementation diff**

Run:

```sh
git diff --check
git diff -- src/tui/dashboard.ts src/shared/constants.ts tests/dashboard.test.ts tests/constants.test.ts
```

Expected: only the four planned files are changed, with no whitespace errors, no dependency changes, no provider changes, and no stale `insightsPeriodIndex`, `renderInsightsByCategory`, or Insights `Period` footer references.

- [ ] **Step 5: Commit the atomic UI change**

Run:

```sh
git add src/tui/dashboard.ts src/shared/constants.ts tests/dashboard.test.ts tests/constants.test.ts
git commit -m "fix: keep Insights within the dashboard height"
```

Expected: one commit contains the compact Insights behavior and its tests.

---

## Phase verification

- [ ] **Step 1: Verify the 40×24 overlay in tmux**

Run:

```sh
session="pi-usage-40"
tmux new-session -d -s "$session" -x 40 -y 24
tmux send-keys -t "$session" "cd $(pwd) && pi -e ." Enter
sleep 3
tmux send-keys -t "$session" "/usage" Enter
sleep 2
tmux send-keys -t "$session" Tab Tab
sleep 1
tmux capture-pane -t "$session" -p
tmux kill-session -t "$session"
```

Expected: the capture shows Insights selected, populated category tabs, one selected category's rows, the Category footer, and the bottom frame. The footer and bottom border must not be sliced off.

- [ ] **Step 2: Verify the normal 80×24 overlay**

Run:

```sh
session="pi-usage-80"
tmux new-session -d -s "$session" -x 80 -y 24
tmux send-keys -t "$session" "cd $(pwd) && pi -e ." Enter
sleep 3
tmux send-keys -t "$session" "/usage" Enter
sleep 2
tmux send-keys -t "$session" Tab Tab
sleep 1
tmux capture-pane -t "$session" -p
tmux kill-session -t "$session"
```

Expected: the available category tabs fit, one category renders, and the footer and bottom frame remain visible.

- [ ] **Step 3: Verify final repository state**

Run:

```sh
git diff --check
git status --short
git log -1 --oneline
```

Expected: no whitespace errors, no uncommitted Phase 4 files, and the latest commit is `fix: keep Insights within the dashboard height`.

Stop here. Documentation and screenshot updates belong to Phase 5.
