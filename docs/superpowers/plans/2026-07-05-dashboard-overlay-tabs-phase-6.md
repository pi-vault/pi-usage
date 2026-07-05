# Phase 6: Verification — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Final verification sweep confirming no stale references, no type errors, and all tests pass after the full dashboard overlay refactor.

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** Phases 1-5 are complete. The dashboard is a tabbed overlay using `frame()` and `renderTabBar()`. Legacy constants have been removed.
**Postconditions:** The codebase is confirmed clean — no dead references, no type errors, all tests green. The refactor is fully complete.

---

## Step 1: Run full test suite

- [ ] Run all tests and confirm they pass.

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass with exit code 0. No skipped or failing tests.

---

## Step 2: Type check

- [ ] Run the TypeScript compiler in check-only mode.

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit
```

Expected: Clean exit, no type errors.

---

## Step 3: Grep for stale references to removed identifiers

- [ ] Verify no code references identifiers that were removed during the refactor.

Run each command and confirm no matches are found:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage

# Legacy singular footer (should be dashboardFooters plural)
grep -rn "dashboardFooter[^s]" src/ tests/ || echo "OK: No stale dashboardFooter refs"

# Legacy border characters (replaced by frame() in overlay-render.ts)
grep -rn "dashboardBorderChars" src/ tests/ || echo "OK: No stale dashboardBorderChars refs"

# Legacy insights toggle field (replaced by activeTab === "insights")
grep -rn "showInsights" src/ tests/ || echo "OK: No stale showInsights refs"

# Legacy "v" key handler in dashboard (insights is now a tab, not a toggle)
grep -rn '"v"' src/tui/dashboard.ts || echo "OK: No v-key handler in dashboard"
```

Expected: All four commands print their "OK" message. No matches found.

If any stale references are found, fix them before proceeding to Step 4.

---

## Step 4: Verify overlay options are present in `dashboard.ts`

- [ ] Confirm the overlay configuration is correctly set in the `openDashboard` function.

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
grep -A5 "overlay:" src/tui/dashboard.ts
```

Expected output should include:

```
overlay: true,
overlayOptions: {
  anchor: "center",
  maxHeight: "85%",
  width: "92%",
}
```

---

## Step 5: Commit any remaining fixes (if needed)

- [ ] If any issues were found and fixed in Steps 1-4, stage and commit them.

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add -A
git commit -m "fix(tui): address remaining issues from tabbed overlay refactor

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

If no fixes were needed, skip this step — the refactor is complete.
