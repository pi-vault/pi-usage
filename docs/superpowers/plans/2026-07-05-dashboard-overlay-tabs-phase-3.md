# Phase 3: Constants Prep — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-tab `dashboardFooters` to `UI_STRINGS` in `src/shared/constants.ts` alongside the legacy `dashboardFooter` and `dashboardBorderChars` (which are removed in Phase 5 after the dashboard refactor).

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** None
**Postconditions:** All tests pass. `UI_STRINGS.dashboardFooters` exists with `statistics`, `current`, and `insights` keys. Legacy `dashboardFooter` and `dashboardBorderChars` remain untouched for backward compatibility (removed in Phase 5).

---

## Steps

- [ ] **Step 1: Add `dashboardFooters` object to `UI_STRINGS`**

In `src/shared/constants.ts`, add the `dashboardFooters` property to `UI_STRINGS` immediately after `dashboardTitle`. The legacy `dashboardFooter` (singular) and `dashboardBorderChars` must remain — they are still referenced by the current dashboard code and will be removed in Phase 5.

Replace the `UI_STRINGS` declaration with:

```typescript
export const UI_STRINGS = {
  dashboardTitle: "Pi Usage Dashboard",
  // New per-tab footers (used by the tabbed overlay starting Phase 4)
  dashboardFooters: {
    statistics: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[Up/Down] Row",
      "[Enter] Expand",
      "[q/Esc] Close",
    ].join(" • "),
    current: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Provider",
      "[q/Esc] Close",
    ].join(" • "),
    insights: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[q/Esc] Close",
    ].join(" • "),
  },
  // Legacy -- removed in Phase 5 when dashboard.ts stops referencing them
  dashboardFooter: [
    "[Tab/Shift-Tab] Provider",
    "[Left/Right] Period",
    "[Up/Down] Row",
    "[Enter/Space] Expand/Collapse",
    "[v] Insights",
    "[q/Esc] Close",
  ].join(" • "),
  dashboardBorderedSectionTitles: {
    usageStatistics: "Usage Statistics",
    currentUsage: "Current Usage",
    insights: "Insights",
    notes: "Notes",
  },
  dashboardBorderChars: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    separatorLeft: "├",
    separatorRight: "┤",
  },
  dashboardDefaultPeriod: "allTime" as UsageWindow,
} as const;
```

The resulting footer strings are:

- `statistics`: `[Tab/Shift-Tab] Switch tab • [Left/Right] Period • [Up/Down] Row • [Enter] Expand • [q/Esc] Close`
- `current`: `[Tab/Shift-Tab] Switch tab • [Left/Right] Provider • [q/Esc] Close`
- `insights`: `[Tab/Shift-Tab] Switch tab • [Left/Right] Period • [q/Esc] Close`

- [ ] **Step 2: Run all tests to verify no regressions**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass. The new `dashboardFooters` property is additive — no existing code references it yet, and the legacy properties are unchanged.

- [ ] **Step 3: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/shared/constants.ts
git commit -m "feat(constants): add per-tab footer strings

Add dashboardFooters with context-aware key hints for each tab.
Legacy dashboardFooter and dashboardBorderChars retained until
the dashboard render pipeline is refactored.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
