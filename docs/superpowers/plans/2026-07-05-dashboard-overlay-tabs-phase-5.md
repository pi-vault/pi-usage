# Phase 5: Legacy Cleanup — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the legacy `dashboardFooter` (singular) and `dashboardBorderChars` properties from `UI_STRINGS`, which were kept for backward compatibility during Phase 3 and are no longer referenced after Phase 4.

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** Phase 4 (core refactor + test updates) is complete. The dashboard no longer references `UI_STRINGS.dashboardFooter` or `UI_STRINGS.dashboardBorderChars`. All tests pass.
**Postconditions:** `UI_STRINGS` contains only the new per-tab `dashboardFooters` object. No dead constants remain. All tests and type checks pass.

---

## Step 1: Remove `dashboardFooter` and `dashboardBorderChars` from `UI_STRINGS`

- [ ] Edit `src/shared/constants.ts` and remove the `dashboardFooter` and `dashboardBorderChars` properties from the `UI_STRINGS` object.

The final `UI_STRINGS` must be exactly:

```typescript
export const UI_STRINGS = {
  dashboardTitle: "Pi Usage Dashboard",
  dashboardFooters: {
    statistics: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[Up/Down] Row",
      "[Enter] Expand",
      "[q/Esc] Close",
    ].join(" \u2022 "),
    current: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Provider",
      "[q/Esc] Close",
    ].join(" \u2022 "),
    insights: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[q/Esc] Close",
    ].join(" \u2022 "),
  },
  dashboardBorderedSectionTitles: {
    usageStatistics: "Usage Statistics",
    currentUsage: "Current Usage",
    insights: "Insights",
    notes: "Notes",
  },
  dashboardDefaultPeriod: "allTime" as UsageWindow,
} as const;
```

Properties to remove:

1. `dashboardFooter` (singular) — the old single-string footer with `[Tab/Shift-Tab] Provider`, `[Enter/Space] Expand/Collapse`, `[v] Insights` hints. Superseded by `dashboardFooters` (plural, per-tab).
2. `dashboardBorderChars` — the old `╭╮╰╯─├┤` border characters. Superseded by `frame()` in `src/tui/overlay-render.ts` which uses `┏┓┗┛━┃`.

---

## Step 2: Grep for stale references

- [ ] Verify no code still references the removed properties.

Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
grep -rn "dashboardFooter[^s]" src/ tests/ || echo "No stale dashboardFooter refs"
grep -rn "dashboardBorderChars" src/ tests/ || echo "No stale dashboardBorderChars refs"
```

Expected: Both commands print the "No stale" message. No files reference either property.

If references are found, fix them before proceeding:
- References to `UI_STRINGS.dashboardFooter` should be replaced with `UI_STRINGS.dashboardFooters[tabId]` (this should already have been done in Phase 4).
- References to `UI_STRINGS.dashboardBorderChars` should be removed entirely (border rendering is now handled by `frame()` in `overlay-render.ts`).

---

## Step 3: Type check

- [ ] Verify the project compiles with no type errors.

Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit
```

Expected: Clean exit, no type errors.

---

## Step 4: Run all tests

- [ ] Verify all tests pass after the removal.

Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass. No test should reference the removed properties (they were updated in Phase 4's Task 6).

---

## Step 5: Commit

- [ ] Stage and commit the change.

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/shared/constants.ts
git commit -m "chore(constants): remove legacy dashboard footer and border chars

Remove dashboardFooter (singular) and dashboardBorderChars from
UI_STRINGS. These were kept for backward compatibility during Phase 3
and are superseded by dashboardFooters (per-tab) and the frame()
utility in overlay-render.ts.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
