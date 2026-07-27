# Phase 4: Compact Insights Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Parent plan:** `docs/superpowers/plans/2026-07-27-stepfun-credits-compact-insights-refactor.md`

**Goal:** Replace the unsupported Insights period selector with all-time category navigation that remains fully visible in Pi's overlay at the minimum supported terminal size.

**Architecture:** Keep the existing dashboard component, frame, and tab renderer. Derive populated Insight categories in fixed order, retain one category ID as UI state, and render only that category's existing capped items.

**Tech Stack:** TypeScript 6, Vitest 4, Pi TUI 0.82.0.

**Phase dependency:** Phase 3 is committed and `pnpm check` passes.

**Usable result:** Insights truthfully displays all-time data, Left/Right switches populated categories, and the footer and bottom frame remain visible at 40×24 and larger terminals.

**Out of scope:** Offline insight calculations, category item caps, provider behavior, scrolling, new TUI components, and unrelated dashboard refactors.

## Fixed layout contract

- Category order: Projects, Skills, MCP servers, Cost patterns.
- Categories with no items are omitted.
- Missing `category` values retain current behavior and belong to Cost patterns.
- The first populated category is the effective default.
- If state updates remove the selected category, selection permanently falls back to the first populated category.
- Insights are all-time; Today, This Week, Last Week, and All Time controls do not render in this tab.
- At a 40×24 terminal, Pi computes overlay width `floor(40 × 0.92) = 36` and maximum height `floor(24 × 0.85) = 20`. The component must render no more than 20 lines at width 36.
- At widths 73 and 100, the component must render no more than 17 lines.

---

### Task 1: Specify category selection behavior

**Files:**
- Modify: `tests/dashboard.test.ts`

- [ ] **Step 1: Add a shared tab-switch helper**

Add near the dashboard tests:

```ts
function switchToInsights(component: UsageDashboardComponent): void {
  component.handleInput("\t");
  component.handleInput("\t");
}
```

Use it in new and existing tests that switch from Statistics to Insights.

- [ ] **Step 2: Replace the independent-period test**

Delete `has independent period selector for Insights tab`. Add:

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

- [ ] **Step 3: Add category cycling without Statistics-state coupling**

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

- [ ] **Step 4: Add durable fallback after a state update**

```ts
it("falls back when the selected Insight category disappears", () => {
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

The final assertion proves fallback updates the selected ID rather than temporarily substituting rendered content.

- [ ] **Step 5: Run the dashboard tests and confirm failure**

```sh
pnpm test -- tests/dashboard.test.ts
```

Expected: FAIL because Insights still renders periods and all categories simultaneously.

---

### Task 2: Specify the Pi overlay height budget and footer

**Files:**
- Modify: `tests/dashboard.test.ts`
- Modify: `tests/constants.test.ts`

- [ ] **Step 1: Add the maximum-category line-budget test**

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

- [ ] **Step 2: Change dashboard footer expectations**

In `renders context-aware footer per tab`, replace the Insights period assertion with:

```ts
expect(stripped).toContain("[Left/Right] Category");
```

- [ ] **Step 3: Change the constant test**

In `tests/constants.test.ts`, expect:

```ts
expect(UI_STRINGS.dashboardFooters.insights).toBe(
  "[Tab/Shift-Tab] Switch tab • [Left/Right] Category • [q/Esc] Close",
);
```

- [ ] **Step 4: Run focused tests and confirm failure**

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
```

Expected: FAIL because the current Insights view exceeds the line budget and still advertises Period navigation.

---

### Task 3: Implement available category state and rendering

**Files:**
- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Define category order and types**

Add below `DASHBOARD_TABS`:

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

- [ ] **Step 2: Replace the unused period state**

Replace:

```ts
private insightsPeriodIndex = DEFAULT_PERIOD_INDEX;
```

with:

```ts
private insightsCategory: InsightCategoryId = "project";
```

Do not change `periodIndex`; Statistics still uses it.

- [ ] **Step 3: Derive populated categories and durable selection**

Add:

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

- [ ] **Step 4: Replace all-category rendering with one complete renderer**

Replace `renderInsightsByCategory` with:

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

This preserves the current formatting and item caps; it only removes the outer category loop and leading blank lines.

- [ ] **Step 5: Replace `renderInsightsTab`**

```ts
private renderInsightsTab(w: number, lines: string[]): void {
  if (this.state.insights.length === 0) {
    lines.push(this.theme.dim("No insights yet."));
    return;
  }

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

Delete the stale period-filter comment.

- [ ] **Step 6: Replace period input with category input**

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

---

### Task 4: Update footer and verify the compact component

**Files:**
- Modify: `src/shared/constants.ts`
- Test: `tests/dashboard.test.ts`
- Test: `tests/constants.test.ts`

- [ ] **Step 1: Change the Insights footer constant**

```ts
insights: [
  "[Tab/Shift-Tab] Switch tab",
  "[Left/Right] Category",
  "[q/Esc] Close",
].join(" • "),
```

- [ ] **Step 2: Run focused tests and typecheck**

```sh
pnpm test -- tests/dashboard.test.ts tests/constants.test.ts
pnpm typecheck
```

Expected: PASS. Width 36 renders at most 20 lines; widths 73 and 100 render at most 17 lines.

- [ ] **Step 3: Commit the atomic UI change**

```sh
git add src/tui/dashboard.ts src/shared/constants.ts tests/dashboard.test.ts tests/constants.test.ts
git commit -m "fix: keep Insights within the dashboard height"
```

---

### Phase verification

- [ ] Run:

```sh
pnpm check
```

Expected: PASS.

- [ ] Verify at the minimum supported terminal size:

```sh
tmux new-session -d -s pi-usage-40 -x 40 -y 24
tmux send-keys -t pi-usage-40 "cd $(pwd) && pi -e ." Enter
sleep 3
tmux send-keys -t pi-usage-40 "/usage" Enter
sleep 2
tmux capture-pane -t pi-usage-40 -p
tmux kill-session -t pi-usage-40
```

Expected: category tabs, selected rows, contextual footer, and bottom frame are visible; Pi has not sliced off the end of the component.

- [ ] Verify the phase diff:

```sh
git diff --check
git status --short
git log -1 --oneline
```

Expected: no whitespace errors, no uncommitted Phase 4 files, and the latest commit is `fix: keep Insights within the dashboard height`.

**Stop here.** The compact all-time Insights UI is usable independently. Phase 5 documents both completed features and performs release-level verification.