# Phase 1: Spacing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an empty line between the "Usage Statistics" section title and the period tabs so the dashboard spacing is consistent with the "Current Usage" section.

**Architecture:** One-line insertion in the dashboard render method, plus any test adjustments for shifted output.

**Tech Stack:** TypeScript, Vitest, TUI rendering

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-enhancements-design.md` → Feature 3

**Parent plan:** `docs/superpowers/plans/2026-06-21-dashboard-enhancements.md` → Phase 1

---

## File Map

| File                      | Action | Responsibility                                       |
| ------------------------- | ------ | ---------------------------------------------------- |
| `src/tui/dashboard.ts`    | Modify | Add `lines.push("")` between section title and tabs  |
| `tests/dashboard.test.ts` | Modify | Adjust any assertions affected by the new empty line |

---

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
