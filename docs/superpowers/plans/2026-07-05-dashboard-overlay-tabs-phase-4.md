# Phase 4: Core Refactor + Tests — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the dashboard component from stacked layout to tabbed overlay, and update all tests to match.

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** Phases 1-3 complete (DashboardTheme has `inverse`/`bg`, `overlay-render.ts` exists with `frame`/`renderTabBar`/`pad`/`frameContentWidth`, `UI_STRINGS.dashboardFooters` exists with per-tab strings, `makeAnsiTheme` test helper has `inverse`/`bg`)
**Postconditions:** All tests pass. Dashboard renders as tabbed overlay. `v` key removed. Tab/Shift-Tab switches tabs. Left/Right is contextual per tab.

**Files modified:**

| File                      | Action                               |
| ------------------------- | ------------------------------------ |
| `src/tui/dashboard.ts`    | Refactor to tabbed overlay           |
| `tests/dashboard.test.ts` | Update all assertions for new layout |

---

## Source Changes — `src/tui/dashboard.ts`

### Step 1: Add imports and tab type/constants

- [ ] Add the overlay-render import alongside existing imports:

```typescript
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "./overlay-render.ts";
```

Then add the tab type and tab definition constants after the existing `SHIFT_TAB_KEY` / `DEFAULT_PERIOD_INDEX` block (before `normalizePlan`):

```typescript
type DashboardTabId = "statistics" | "current" | "insights";

const DASHBOARD_TABS: DashboardTab[] = [
  {
    id: "statistics",
    label: UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics,
  },
  {
    id: "current",
    label: UI_STRINGS.dashboardBorderedSectionTitles.currentUsage,
  },
  { id: "insights", label: UI_STRINGS.dashboardBorderedSectionTitles.insights },
];
```

---

### Step 2: Replace class state fields

- [ ] In the `UsageDashboardComponent` class, remove the `showInsights` field and add `activeTab` + `insightsPeriodIndex`.

**Remove:**

```typescript
  private showInsights = false;
```

**Replace the field block with:**

```typescript
  private activeTab: DashboardTabId = "statistics";
  private periodIndex = DEFAULT_PERIOD_INDEX;
  private insightsPeriodIndex = DEFAULT_PERIOD_INDEX;
  private rowIndex = 0;
  private expandedProvider: string | null = null;
  private currentUsageProviderIndex: number;
```

(The `periodIndex`, `rowIndex`, `expandedProvider`, and `currentUsageProviderIndex` fields stay; `showInsights` is removed; `activeTab` and `insightsPeriodIndex` are added.)

---

### Step 3: Add switchTab helper

- [ ] Add a `switchTab` method to the component class, after `moveProvider`:

```typescript
  private switchTab(delta: number): void {
    const ids = DASHBOARD_TABS.map((t) => t.id);
    const currentIndex = ids.indexOf(this.activeTab);
    const next = (currentIndex + delta + ids.length) % ids.length;
    this.activeTab = ids[next] as DashboardTabId;
  }
```

---

### Step 4: Add per-tab input handlers

- [ ] Add three private methods for per-tab contextual key handling. Place them after `switchTab`:

```typescript
  private handleStatisticsInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.movePeriod(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.movePeriod(1);
      return;
    }
    const period = this.currentPeriod();
    if (!period) return;
    if (matchesKey(data, Key.down)) {
      this.rowIndex = Math.min(
        this.rowIndex + 1,
        Math.max(0, period.providers.length - 1),
      );
    }
    if (matchesKey(data, Key.up)) {
      this.rowIndex = Math.max(0, this.rowIndex - 1);
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const provider = period.providers[this.rowIndex]?.key;
      if (!provider) return;
      this.expandedProvider =
        this.expandedProvider === provider ? null : provider;
    }
  }

  private handleCurrentUsageInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.moveProvider(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.moveProvider(1);
      return;
    }
  }

  private handleInsightsInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.moveInsightsPeriod(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.moveInsightsPeriod(1);
      return;
    }
  }

  private moveInsightsPeriod(delta: number): void {
    this.insightsPeriodIndex =
      (this.insightsPeriodIndex + delta + PERIODS.length) % PERIODS.length;
  }
```

---

### Step 5: Replace handleInput with tab-based routing

- [ ] Replace the entire `handleInput` method body:

```typescript
  handleInput(data: string): void {
    // Global keys
    if (data === "q" || matchesKey(data, Key.escape)) {
      this.invalidate();
      this.cancelScan?.();
      this.done();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, SHIFT_TAB_KEY)) {
      this.switchTab(-1);
      return;
    }

    // Per-tab contextual keys
    switch (this.activeTab) {
      case "statistics":
        this.handleStatisticsInput(data);
        break;
      case "current":
        this.handleCurrentUsageInput(data);
        break;
      case "insights":
        this.handleInsightsInput(data);
        break;
    }
  }
```

The old `handleInput` body is fully replaced. The `v` key handler is gone. `Tab`/`Shift-Tab` now call `switchTab` instead of `moveProvider`. `Left`/`Right`/`Up`/`Down`/`Enter`/`Space` are routed through the per-tab handlers.

---

### Step 6: Add renderInsightsTab method

- [ ] Add after `renderInsightsByCategory`:

```typescript
  private renderInsightsTab(w: number, lines: string[]): void {
    lines.push(
      ...this.renderTabs(
        PERIODS.map((period) => PERIOD_LABELS[period]),
        this.insightsPeriodIndex,
        w,
      ),
    );
    lines.push("");

    if (this.state.insights.length === 0) {
      lines.push(this.theme.dim("No insights yet."));
    } else {
      lines.push(...this.renderInsightsByCategory(w));
    }
  }
```

---

### Step 7: Rename renderUsageStatistics -> renderUsageStatisticsTab

- [ ] Rename the method and remove the section title and the `showInsights` branch. The full replacement:

```typescript
  private renderUsageStatisticsTab(w: number, lines: string[]): void {
    lines.push(
      ...this.renderTabs(
        PERIODS.map((period) => PERIOD_LABELS[period]),
        this.periodIndex,
        w,
      ),
    );
    if (this.state.loading) {
      lines.push(this.theme.dim("Loading session history..."));
    }
    lines.push("");

    const period = this.currentPeriod();
    if (!period || period.total.messageCount === 0) {
      lines.push(this.theme.dim("No local session usage found."));
      return;
    }
    const columns = tableColumns(w);
    const providerWidth = labelWidth(columns, w);
    lines.push(tableLine("Provider / Model", columns, providerWidth));
    lines.push(this.theme.fg("borderMuted", separator(columns, providerWidth)));
    period.providers.forEach((row, index) => {
      const expanded = this.expandedProvider === row.key;
      lines.push(
        this.renderProviderRow(
          row,
          index === this.rowIndex,
          expanded,
          columns,
          providerWidth,
        ),
      );
      if (expanded) {
        for (const model of period.modelsByProvider[row.key] ?? []) {
          lines.push(this.renderModelRow(model, columns, providerWidth));
        }
      }
    });
    lines.push(this.theme.fg("borderMuted", separator(columns, providerWidth)));
    lines.push(tableLine("Total", columns, providerWidth, period.total));
    lines.push("");
    lines.push(...this.renderLegend(w));
  }
```

**Removed vs. old `renderUsageStatistics`:**

- Removed `lines.push(this.sectionTitle(...))` and the blank line after it (title is now in the tab bar)
- Removed the entire `if (this.showInsights) { ... }` branch (Insights is a separate tab)

---

### Step 8: Rename renderCurrentUsage -> renderCurrentUsageTab

- [ ] Rename the method, remove the section title and header separator, and add `renderDiagnostics` call at the end. Full replacement:

```typescript
  private renderCurrentUsageTab(w: number, lines: string[]): void {
    const providers = liveProviders(this.state);
    if (providers.length === 0) {
      lines.push(this.theme.dim("No live usage details."));
      return;
    }
    this.currentUsageProviderIndex = Math.min(
      this.currentUsageProviderIndex,
      Math.max(0, providers.length - 1),
    );
    lines.push(
      ...this.renderTabs(
        providers.map((provider) => provider.providerLabel),
        this.currentUsageProviderIndex,
        w,
      ),
    );
    lines.push("");

    const referenceTime = Math.max(
      this.state.generatedAt,
      ...providers.map((provider) => provider.fetchedAt),
      0,
    );
    const selected = providers[this.currentUsageProviderIndex];
    lines.push(
      this.theme.fg(
        "accent",
        this.theme.bold(providerHeading(selected, referenceTime)),
      ),
    );
    if (selected.windows.length === 0 && selected.balances.length === 0) {
      lines.push(this.theme.dim("No live usage details."));
    } else {
      lines.push(...this.renderQuotaWindows(selected.windows));
      for (const balance of selected.balances) {
        const value =
          balance.unit === "USD"
            ? formatCurrency(balance.remaining ?? undefined)
            : formatAbbrev(balance.remaining ?? undefined);
        const unitSuffix = balance.unit === "USD" ? "" : ` ${balance.unit}`;
        const labelStyled = this.theme.dim(`${balance.label}:`);
        lines.push(`${labelStyled} ${value}${unitSuffix}`);
      }
    }

    // Diagnostics (previously a separate section, now housed in Current Usage)
    this.renderDiagnostics(lines);
  }
```

**Removed vs. old `renderCurrentUsage`:**

- Removed `lines.push(this.sectionTitle(...))` (title is in the tab bar)
- Removed `lines.push(this.currentUsageHeaderSeparator(w))` (no separator in tab layout)
- Added `this.renderDiagnostics(lines)` at the end (was called separately in old `render()`)

---

### Step 9: Replace render() to use frame + tab bar + per-tab content

- [ ] Replace the entire `render` method:

```typescript
  render(width: number): string[] {
    const w = Math.max(8, width);
    const contentWidth = frameContentWidth(w);
    const lines: string[] = [];

    // Tab bar
    lines.push(
      renderTabBar(DASHBOARD_TABS, this.activeTab, contentWidth, this.theme),
    );
    lines.push("");

    // Active tab content
    switch (this.activeTab) {
      case "statistics":
        this.renderUsageStatisticsTab(contentWidth, lines);
        break;
      case "current":
        this.renderCurrentUsageTab(contentWidth, lines);
        break;
      case "insights":
        this.renderInsightsTab(contentWidth, lines);
        break;
    }

    // Footer
    lines.push("");
    lines.push(this.renderFooter(contentWidth));

    return frame(lines, w, this.theme);
  }
```

---

### Step 10: Update renderFooter to be context-aware

- [ ] Replace the `renderFooter` method:

```typescript
  private renderFooter(width: number): string {
    const footerKey =
      this.activeTab === "statistics"
        ? "statistics"
        : this.activeTab === "current"
          ? "current"
          : "insights";
    return this.theme.dim(
      truncateVisible(UI_STRINGS.dashboardFooters[footerKey], width),
    );
  }
```

---

### Step 11: Remove dead code

- [ ] Remove the following methods and free functions that are no longer called:

**Remove free functions** (before the `UsageDashboardOptions` interface):

```typescript
function horizontalBorder(width: number, left: string, right: string): string {
  if (width <= 2) return left + right;
  return `${left}${"─".repeat(width - 2)}${right}`;
}

function borderSeparator(width: number): string {
  if (width <= 2) return "├┤";
  return `├${"─".repeat(width - 2)}┤`;
}
```

**Remove private methods** from `UsageDashboardComponent`:

```typescript
  private sectionTitle(text: string): string {
    return this.theme.fg("accent", this.theme.bold(text));
  }

  private borderLine(width: number): string {
    return this.theme.fg(
      "border",
      horizontalBorder(
        width,
        UI_STRINGS.dashboardBorderChars.topLeft,
        UI_STRINGS.dashboardBorderChars.topRight,
      ),
    );
  }

  private currentUsageHeaderSeparator(width: number): string {
    return this.theme.fg("borderMuted", borderSeparator(width));
  }

  private bottomBorder(width: number): string {
    return this.theme.fg(
      "border",
      horizontalBorder(
        width,
        UI_STRINGS.dashboardBorderChars.bottomLeft,
        UI_STRINGS.dashboardBorderChars.bottomRight,
      ),
    );
  }
```

**Update `renderDiagnostics`** to inline the old `sectionTitle` call (since `sectionTitle` is removed):

```typescript
  private renderDiagnostics(lines: string[]): void {
    const providers = liveProviders(this.state);
    const diagnosticNotes = providers.flatMap((provider) =>
      providerDiagnostics(provider).map(
        (diagnostic) => `* ${provider.providerLabel}: ${diagnostic}`,
      ),
    );
    if (diagnosticNotes.length === 0) return;
    lines.push("");
    lines.push(
      this.theme.fg(
        "accent",
        this.theme.bold(UI_STRINGS.dashboardBorderedSectionTitles.notes),
      ),
    );
    for (const note of diagnosticNotes) {
      lines.push(this.theme.dim(note));
    }
  }
```

The only change is replacing `this.sectionTitle(UI_STRINGS.dashboardBorderedSectionTitles.notes)` with the inlined `this.theme.fg("accent", this.theme.bold(...))`.

---

### Step 12: Update openDashboard with overlay options

- [ ] Replace the `openDashboard` function to pass overlay options:

```typescript
export async function openDashboard(
  ctx: ExtensionCommandContext,
  state: UsageCoreState,
  cancelScan?: () => void,
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, _keys, done) => {
      const piTheme = theme as unknown as Parameters<typeof fromPiTheme>[0];
      const dashboardTheme: DashboardTheme =
        piTheme &&
        typeof (piTheme as { fg?: unknown }).fg === "function" &&
        typeof (piTheme as { bold?: unknown }).bold === "function"
          ? fromPiTheme(piTheme)
          : noTheme;
      return new UsageDashboardComponent(state, done, {
        tui,
        theme: dashboardTheme,
        cancelScan,
      });
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        maxHeight: "85%",
        width: "92%",
      },
    },
  );
}
```

The callback body is unchanged. The second argument `{ overlay: true, overlayOptions: { ... } }` is new.

---

### Step 13: Verify build compiles

- [ ] Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit
```

Expected: No type errors. If references to removed methods or old constants remain, fix them before proceeding.

---

## Test Changes — `tests/dashboard.test.ts`

> **Convention:** Content is now inside a `frame()` box. Lines look like `┃  content  ┃`. Tests that used `l.startsWith("text")` must change to `l.includes("text")`. The `indexOf("[")` alignment checks still work because frame padding is uniform across all content lines.

### Step 14: Update test -- "renders Usage Statistics tab by default"

- [ ] Replace the `"renders usage statistics + current usage with selected provider details"` test:

```typescript
it("renders Usage Statistics tab by default with table and legend", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  const out = c.render(140).join("\n");

  // Frame borders
  expect(out).toContain("\u2501"); // ━
  expect(out).toContain("\u250F"); // ┏
  expect(out).toContain("\u251B"); // ┛

  // Tab bar shows all three tabs
  expect(out).toContain("Usage Statistics");
  expect(out).toContain("Current Usage");
  expect(out).toContain("Insights");

  // Default period is All Time
  expect(out).toContain("[All Time]");
  expect(out).toContain("Provider / Model");
  expect(out).toContain("openai-codex");
  expect(out).toContain("428k");

  // Legend
  expect(out).toContain(
    "Tokens = Input + Output + CacheW \u2022 \u2191In = Input + CacheW \u2022 \u2193Out = Output \u2022 CacheR = Cache Read \u2022 CacheW = Cache Write",
  );

  // Current Usage content should NOT be visible on the Statistics tab
  expect(out).not.toContain("Command Code (Go) \u2022 live \u2022 4s old");
  expect(out).not.toContain("57% left");

  // No legacy layout artifacts
  expect(out).not.toContain("\u256D"); // ╭ old border
  expect(out).not.toContain("\u256F"); // ╯ old border
});
```

---

### Step 15: Add test -- "renders Current Usage tab with provider details and diagnostics"

- [ ] Add after the previous test:

```typescript
it("renders Current Usage tab with provider details and diagnostics", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  // Provider details
  expect(out).toContain("Command Code (Go) \u2022 live \u2022 4s old");
  expect(out).toContain("57% left");
  expect(out).toContain(expectedResetText(Date.parse("2026-06-07T11:47:00")));
  expect(out).toContain("$4.29/$10.00");

  // Diagnostics appear in Current Usage tab
  expect(out).toContain("Subscription endpoint unavailable.");
  expect(out).toContain("Live cache is unavailable.");

  // Usage Statistics table should NOT be visible
  expect(out).not.toContain("Provider / Model");
  expect(out).not.toContain("[All Time]");
});
```

---

### Step 16: Add test -- "renders Insights tab with insights grouped by category"

- [ ] Add after the previous test:

```typescript
it("renders Insights tab with insights grouped by category", () => {
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
  // Switch to Insights tab (Tab twice)
  c.handleInput("\t");
  c.handleInput("\t");
  const out = c.render(100).join("\n");

  expect(out).toContain("Projects");
  expect(out).toContain("career-ops");
  expect(out).toContain("90.0%");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("Large context");

  // Should have its own period selector
  expect(out).toContain("[All Time]");

  // Usage Statistics content should NOT be visible
  expect(out).not.toContain("Provider / Model");
});
```

---

### Step 16b: Add test -- "Insights tab period selector is independent from Statistics tab"

- [ ] Add after the previous test:

```typescript
it("has independent period selector for Insights tab", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });

  // Change Statistics tab period to Today
  c.handleInput("\u001b[D"); // Left (All Time → Last Week)
  c.handleInput("\u001b[D"); // Left (Last Week → This Week)
  c.handleInput("\u001b[D"); // Left (This Week → Today)
  expect(c.render(120).join("\n")).toContain("[Today]");

  // Switch to Insights tab
  c.handleInput("\t");
  c.handleInput("\t");
  const insightsOut = c.render(120).join("\n");
  // Insights should still be on All Time (independent period)
  expect(insightsOut).toContain("[All Time]");

  // Change Insights period
  c.handleInput("\u001b[D"); // Left
  expect(c.render(120).join("\n")).toContain("[Last Week]");

  // Switch back to Statistics tab and verify its period is still Today
  c.handleInput("\t"); // Insights → Statistics (wraps)
  expect(c.render(120).join("\n")).toContain("[Today]");
});
```

---

### Step 17: Update test -- quota bar alignment (add tab switch)

- [ ] Replace `"aligns quota bars by shared label width across available windows"`:

```typescript
it("aligns quota bars by shared label width across available windows", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "5h",
      label: "5h",
      usedPercent: 50,
      resetAt: Date.now() + 3600000,
    },
    {
      key: "weekly",
      label: "Weekly",
      usedPercent: 10,
      resetAt: Date.now() + 86400000 * 7,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const lines = c.render(200);

  const line5h = lines.find(
    (l) => l.includes("5h") && l.includes("% left") && l.includes("["),
  );
  const lineWeekly = lines.find(
    (l) => l.includes("Weekly") && l.includes("% left") && l.includes("["),
  );

  expect(line5h).toBeDefined();
  expect(lineWeekly).toBeDefined();

  // Opening brackets must align vertically
  const bracket5h = line5h?.indexOf("[") ?? -1;
  const bracketWeekly = lineWeekly?.indexOf("[") ?? -1;
  expect(bracket5h).toBe(bracketWeekly);

  // Shorter label is padded to match the longest available-window label
  expect(line5h).toMatch(/5h\s+:/);
});
```

---

### Step 18: Update test -- fractional usedPercent (add tab switch)

- [ ] Replace `"rounds fractional usedPercent to integer remaining percentage"`:

```typescript
it("rounds fractional usedPercent to integer remaining percentage", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "cycle",
      label: "Cycle",
      usedPercent: 43.7,
      resetAt: Date.now() + 3600000,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  // 100 - 43.7 = 56.3, rounded to 56
  expect(out).toContain("56% left");
  expect(out).not.toContain("56.3%");
});
```

---

### Step 19: Update test -- same-day reset (add tab switch)

- [ ] Replace `"formats same-day reset as HH:mm only"`:

```typescript
it("formats same-day reset as HH:mm only", () => {
  const now = new Date();
  const sameDayReset = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    14,
    30,
  ).getTime();

  const state = mkState();
  setWindows(state, [
    {
      key: "cycle",
      label: "Cycle",
      usedPercent: 50,
      resetAt: sameDayReset,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  expect(out).toContain("(resets 14:30)");
  expect(out).not.toContain(" on ");
});
```

---

### Step 20: Update test -- cross-day reset (add tab switch)

- [ ] Replace `"formats cross-day reset as HH:mm on D MMM"`:

```typescript
it("formats cross-day reset as HH:mm on D MMM", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "cycle",
      label: "Cycle",
      usedPercent: 50,
      resetAt: Date.parse("2026-06-07T11:47:00"),
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  expect(out).toContain(expectedResetText(Date.parse("2026-06-07T11:47:00")));
});
```

---

### Step 21: Update test -- reset unavailable (add tab switch)

- [ ] Replace `"renders reset unavailable when resetAt is absent"`:

```typescript
it("renders reset unavailable when resetAt is absent", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "cycle",
      label: "Cycle",
      usedPercent: 50,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  expect(out).toContain("(reset unavailable)");
});
```

---

### Step 22: Update test -- unavailable windows (add tab switch)

- [ ] Replace `"renders unavailable windows without bar and does not affect alignment"`:

```typescript
it("renders unavailable windows without bar and does not affect alignment", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "5h",
      label: "5h",
      usedPercent: 50,
      resetAt: Date.now() + 3600000,
    },
    {
      key: "daily",
      label: "Daily",
      usedPercent: 30,
      resetAt: Date.now() + 86400000,
    },
    {
      key: "verylong",
      label: "VeryLongName",
      usedPercent: 10,
      unavailableReason: "Not applicable",
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const lines = c.render(200);

  const line5h = lines.find(
    (l) => l.includes("5h") && l.includes("% left") && l.includes("["),
  );
  const lineDaily = lines.find(
    (l) => l.includes("Daily") && l.includes("% left") && l.includes("["),
  );
  const lineLong = lines.find(
    (l) => l.includes("VeryLongName") && l.includes("Not applicable"),
  );

  expect(line5h).toBeDefined();
  expect(lineDaily).toBeDefined();
  expect(lineLong).toBeDefined();

  // Unavailable window has no bar or percentage
  expect(lineLong).not.toContain("% left");

  // Available windows' bars align (maxLabelWidth from "5h" and "Daily" only)
  const bracket5h = line5h?.indexOf("[") ?? -1;
  const bracketDaily = lineDaily?.indexOf("[") ?? -1;
  expect(bracket5h).toBe(bracketDaily);

  // "5h" is padded to "Daily" width (5 chars), not "VeryLongName" width
  expect(line5h).toMatch(/5h\s+:/);
});
```

---

### Step 23: Update test -- quota row without ratio (add tab switch)

- [ ] Replace `"renders quota row without ratio when used/limit/unit are incomplete"`:

```typescript
it("renders quota row without ratio when used/limit/unit are incomplete", () => {
  const state = mkState();
  setWindows(state, [
    {
      key: "cycle",
      label: "Cycle",
      usedPercent: 50,
      resetAt: Date.now() + 3600000,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  expect(out).toContain("50% left");
  // No ratio suffix should appear
  expect(out).not.toContain(" - $");
  expect(out).not.toContain(" requests");
});
```

---

### Step 24: Update test -- provider navigation (Current Usage tab)

- [ ] Replace `"wraps joined legend and supports tab-based provider navigation"`:

```typescript
it("supports provider navigation with left/right in Current Usage tab", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");

  // Left arrow cycles providers backward: Command Code (4) -> OpenCode Go (3)
  c.handleInput("\u001b[D"); // Left
  let out = c.render(120).join("\n");
  expect(out).toContain("[OpenCode Go]");
  expect(out).toContain("Credits: $12.50");

  // Right arrow cycles forward: OpenCode Go (3) -> Command Code (4)
  c.handleInput("\u001b[C"); // Right
  out = c.render(120).join("\n");
  expect(out).toContain("[Command Code]");
});
```

---

### Step 25: Update test -- enter/space expand and period changes (remove v)

- [ ] Replace `"uses enter/space for expand, v for insights, and left/right for period changes"`:

```typescript
it("uses enter/space for expand and left/right for period changes in Statistics tab", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });

  // Enter expands the selected provider row to reveal its model rows.
  c.handleInput("\r");
  expect(c.render(120).join("\n")).toContain("gpt-5");

  // Left/Right change the period. Default is All Time (index 3); one Left
  // press moves to Last Week.
  c.handleInput("\u001b[D");
  expect(c.render(120).join("\n")).toContain("[Last Week]");

  // Two more Right presses move through This Week back to Today.
  c.handleInput("\u001b[C");
  c.handleInput("\u001b[C");
  expect(c.render(120).join("\n")).toContain("[Today]");

  // Period changes reset the selected row back to 0.
  expect(c.render(120).join("\n")).toContain("openai-codex");
});
```

---

### Step 26: Update test -- insights grouped by category (tab switch instead of v)

- [ ] Replace `"renders insights grouped by category"`:

```typescript
it("renders insights grouped by category in Insights tab", () => {
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
  // Switch to Insights tab (Tab twice)
  c.handleInput("\t");
  c.handleInput("\t");
  const lines = c.render(100);
  const out = lines.join("\n");
  expect(out).toContain("Projects");
  expect(out).toContain("career-ops");
  expect(out).toContain("90.0%");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("Large context");
  // Verify table structure for project category
  const projectsIdx = lines.findIndex((l) => l.includes("Projects"));
  expect(projectsIdx).toBeGreaterThan(-1);
  expect(lines[projectsIdx]).toContain("% of usage");
  expect(lines[projectsIdx + 1]).toContain("career-ops");
  // Verify bullet-list format for cost category
  expect(out).toContain("  - Large context:");
});
```

---

### Step 27: Update test -- defaults insights without category (tab switch instead of v)

- [ ] Replace `"defaults insights without category to cost patterns"`:

```typescript
it("defaults insights without category to cost patterns", () => {
  const state = mkState();
  state.insights = [{ label: "No category", cost: 1, detail: "test" }];
  const c = new UsageDashboardComponent(state, () => undefined, {
    theme: noTheme,
  });
  // Switch to Insights tab
  c.handleInput("\t");
  c.handleInput("\t");
  const out = c.render(100).join("\n");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("  - No category:");
});
```

---

### Step 28: Delete test -- "renders empty line between Usage Statistics title and period tabs"

- [ ] Remove the entire `it("renders empty line between Usage Statistics title and period tabs", ...)` test block. The section title is now in the tab bar, not a standalone line.

---

### Step 29: Update themed test -- frame borders and tab bar styling

- [ ] Replace `"wraps section titles, borders, and dimmed helpers with ANSI escape codes"`:

```typescript
it("renders frame borders and tab bar with themed styling", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  const lines = c.render(140);
  const out = lines.join("\n");

  // Frame uses ┏ and ┛ (from overlay-render frame glyphs)
  expect(out).toContain("\u250F"); // ┏
  expect(out).toContain("\u251B"); // ┛

  // Tab bar active pill uses inverse+bold for Usage Statistics
  expect(
    theme.calls.some(
      (c) => c.method === "bold" && c.text.includes("Usage Statistics"),
    ),
  ).toBe(true);
  expect(
    theme.calls.some(
      (c) => c.method === "inverse" && c.text.includes("Usage Statistics"),
    ),
  ).toBe(true);

  // Footer should be dimmed with per-tab content
  expect(out).toContain("[Tab/Shift-Tab] Switch tab");
  expect(
    theme.calls.some(
      (c) =>
        c.method === "dim" && c.text.includes("[Tab/Shift-Tab] Switch tab"),
    ),
  ).toBe(true);
});
```

---

### Step 30: Update themed test -- inactive tabs with bg styling

- [ ] Replace `"dims the inactive provider tabs in Current Usage"`:

```typescript
it("renders inactive main tabs with bg styling", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  c.render(140);

  // Inactive tabs use bg("selectedBg", fg("accent", label))
  const bgCalls = theme.calls
    .filter((c) => c.method === "bg")
    .map((c) => c.text);
  // Current Usage and Insights should have bg calls (they're inactive)
  expect(bgCalls.some((t) => t.includes("Current Usage"))).toBe(true);
  expect(bgCalls.some((t) => t.includes("Insights"))).toBe(true);
});
```

---

### Step 31: Update themed test -- disclosure arrow (adjust for frame)

- [ ] Replace `"highlights the selected disclosure arrow + provider label and dims the rest"`:

```typescript
it("highlights the selected disclosure arrow and dims the rest", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  const lines = c.render(140);

  const providerLine = lines.find(
    (l) => l.includes("openai-codex") && l.includes("\u25B8"),
  );
  expect(providerLine).toBeDefined();

  const plain = stripAnsi(providerLine ?? "");
  // Line is inside a frame (\u2503...\u2503); verify no stray > cursor in content
  const content = plain.replace(/^\u2503\s*/, "");
  expect(content.startsWith(">")).toBe(false);
  expect(plain).toContain("\u25B8"); // ▸
  expect(plain).toContain("openai-codex");
  expect(
    theme.calls.some(
      (c) =>
        c.method === "fg" &&
        c.color === "accent" &&
        c.text.includes("openai-codex"),
    ),
  ).toBe(true);
});
```

---

### Step 32: Update themed test -- quota bar alignment by visible width (add tab switch)

- [ ] Replace `"aligns themed quota bars by visible width"`:

```typescript
it("aligns themed quota bars by visible width", () => {
  const theme = makeAnsiTheme();
  const state = mkState();
  setWindows(state, [
    {
      key: "5h",
      label: "5h",
      usedPercent: 50,
      resetAt: Date.now() + 3600000,
    },
    {
      key: "weekly",
      label: "Weekly",
      usedPercent: 10,
      resetAt: Date.now() + 86400000 * 7,
    },
  ]);

  const c = new UsageDashboardComponent(state, () => undefined, { theme });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const lines = c.render(200);
  const line5h = lines.find(
    (l) =>
      stripAnsi(l).includes("5h") && l.includes("[") && l.includes("% left"),
  );
  const lineWeekly = lines.find(
    (l) =>
      stripAnsi(l).includes("Weekly") &&
      l.includes("[") &&
      l.includes("% left"),
  );

  expect(line5h).toBeDefined();
  expect(lineWeekly).toBeDefined();

  // The opening bracket (after padding) aligns vertically; frame adds
  // uniform padding so relative alignment is preserved.
  const bracketIndex = (line: string) => stripAnsi(line).indexOf("[");
  expect(bracketIndex(line5h ?? "")).toBe(bracketIndex(lineWeekly ?? ""));
});
```

---

### Step 33: Update themed test -- quota remaining-bar fill (add tab switch)

- [ ] Replace `"highlights the quota remaining-bar fill and percentage"`:

```typescript
it("highlights the quota remaining-bar fill and percentage", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  c.render(140);

  // The fill glyphs should be wrapped in accent styling.
  const filledAccent = theme.calls.find(
    (c) =>
      c.method === "fg" && c.color === "accent" && c.text.includes("\u2588"),
  );
  expect(filledAccent).toBeDefined();

  // The percentage text should be accent-wrapped.
  const percentAccent = theme.calls.find(
    (c) => c.method === "fg" && c.color === "accent" && c.text === "57% left",
  );
  expect(percentAccent).toBeDefined();
});
```

---

### Step 34: Update themed test -- dims formula legend, reset, ratio (split across tabs)

- [ ] Replace `"dims the formula legend, reset text, and ratio text"`:

```typescript
it("dims the formula legend on Statistics tab and reset/ratio on Current Usage tab", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });

  // Statistics tab: legend segments should be dimmed
  c.render(140);
  const dimmed = theme.calls
    .filter((c) => c.method === "dim")
    .map((c) => c.text);
  expect(dimmed).toContain("Tokens = Input + Output + CacheW");
  expect(dimmed).toContain("CacheR = Cache Read");

  // Switch to Current Usage tab: reset and ratio should be dimmed
  c.handleInput("\t");
  c.render(140);
  const allDimmed = theme.calls
    .filter((c) => c.method === "dim")
    .map((c) => c.text);
  expect(
    allDimmed.some(
      (text) =>
        text.startsWith("(resets ") || text.includes("reset unavailable"),
    ),
  ).toBe(true);
  expect(allDimmed).toContain("$4.29/$10.00");
});
```

---

### Step 35: Update themed test -- footer context-aware per tab

- [ ] Replace `"renders the footer in [Shortcut] Action format with dimmed styling"`:

```typescript
it("renders context-aware footer per tab", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });

  // Statistics tab footer
  let out = c.render(160).join("\n");
  let stripped = stripAnsi(out);
  expect(stripped).toContain("[Tab/Shift-Tab] Switch tab");
  expect(stripped).toContain("[Left/Right] Period");
  expect(stripped).toContain("[Up/Down] Row");
  expect(stripped).toContain("[Enter] Expand");
  expect(stripped).toContain("[q/Esc] Close");

  // Current Usage tab footer
  c.handleInput("\t");
  out = c.render(160).join("\n");
  stripped = stripAnsi(out);
  expect(stripped).toContain("[Tab/Shift-Tab] Switch tab");
  expect(stripped).toContain("[Left/Right] Provider");
  expect(stripped).not.toContain("[Up/Down] Row");

  // Insights tab footer
  c.handleInput("\t");
  out = c.render(160).join("\n");
  stripped = stripAnsi(out);
  expect(stripped).toContain("[Tab/Shift-Tab] Switch tab");
  expect(stripped).toContain("[Left/Right] Period");
  expect(stripped).not.toContain("[Up/Down] Row");
});
```

---

### Step 36: Update themed test -- ANSI truncation (frame handles it now)

- [ ] Replace `"strips ANSI before applying final truncation so visible width is preserved"`:

```typescript
it("strips ANSI before applying final truncation so visible width is preserved", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  // Render with a narrow width -- every visible line must not exceed it
  // even when ANSI escapes are present. frame() handles truncation.
  const lines = c.render(40);
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    expect(visible).toBeLessThanOrEqual(40);
  }
});
```

---

### Step 37: Update responsive test -- narrow widths (check frame borders)

- [ ] Replace `"renders at very narrow widths without breaking the table"`:

```typescript
it("renders at very narrow widths without breaking the frame", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  const lines = c.render(30);
  for (const line of lines) {
    const visible = line.replace(ANSI_PATTERN, "").length;
    expect(visible).toBeLessThanOrEqual(30);
  }
  // Frame borders should be present
  const out = lines.join("\n");
  expect(out).toContain("\u250F"); // ┏
  expect(out).toContain("\u251B"); // ┛
});
```

---

## Verification

### Step 38: Run all tests

- [ ] Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass.

---

### Step 39: Fix any remaining failures

- [ ] If any tests fail, diagnose and fix. Common issues:
  - **Line-finding assertions:** Tests using `startsWith` or `indexOf` may need updating for frame-wrapped lines. Use `includes` instead.
  - **Width calculations:** Content width is now `frameContentWidth(w) = w - 6`, so table breakpoints may shift at boundary widths. Adjust render width or assertion if needed.
  - **Tab state:** Tests that render Current Usage content must call `c.handleInput("\t")` first. Tests that render Insights content must call `c.handleInput("\t")` twice.
  - **Missing `inverse`/`bg` on theme:** If `makeAnsiTheme` doesn't have `inverse`/`bg`, Phase 1 was not applied correctly. Verify preconditions.

---

### Step 40: Commit

- [ ] Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/tui/dashboard.ts tests/dashboard.test.ts
git commit -m "feat(tui): refactor dashboard to tabbed overlay + update tests

Replace vertical stacking with 3 tabs: Usage Statistics, Current
Usage, Insights. Use frame() and renderTabBar() from overlay-render.
Tab/Shift-Tab switches tabs, Left/Right is contextual per tab.
Diagnostics moved into Current Usage tab. Enable overlay mode with
centered anchor, 85% maxHeight, 92% width. Update all dashboard
tests for new layout.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
