# Compact Insights design

## Purpose

The Insights tab shows all-time data, but its period selector suggests unsupported filtering and the current all-category layout exceeds Pi's overlay height at small terminal sizes. The tab will instead show one populated category at a time.

## Current state

Phase 3 is merged, the worktree is clean, and `pnpm check` passes 258 tests. The project resolves `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to 0.82.1 through the existing `^0.82.0` ranges.

Pi 0.82.0 in `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/tui.ts` provides the relevant overlay contract:

- percentage widths and heights use `Math.floor`;
- a 40 by 24 terminal gives the dashboard a width of 36 and a maximum height of 20;
- Pi slices rendered lines after the maximum height, so an oversized component loses its bottom rows.

The installed 0.82.1 packages remain unchanged. This phase only changes the dashboard UI and its tests.

## Behavior

Insight categories have this fixed order:

1. Projects
2. Skills
3. MCP servers
4. Cost patterns

Only populated categories appear. An item without a `category` remains a Cost patterns item. Unknown category strings remain excluded, matching the current renderer.

The first populated category is the effective default. Left and Right cycle through populated categories with wraparound. This state is independent from the Statistics period.

If an external state update removes the selected category, the dashboard stores the first populated category as the new selection. If the removed category later returns, the fallback remains selected.

Insights remain all-time. The Insights tab does not render Today, This Week, Last Week, or All Time controls.

## Architecture

`UsageDashboardComponent` keeps the existing main tabs, frame, category row renderer, and input dispatch. `dashboard.ts` gains a fixed category descriptor list and one selected category ID in place of `insightsPeriodIndex`.

A component method derives populated categories from the current `state.insights`. Both rendering and category input use that result. Rendering resolves the durable selected category, renders the available category labels with the existing `renderTabs` method, and renders only the active category's current rows.

The existing category formatting stays intact:

- Projects, Skills, and MCP servers use the label and percentage table.
- Cost patterns use the currency bullet list.
- Existing item caps and overflow rows remain the responsibility of `buildInsights`.

No public types, dependencies, offline calculations, provider code, scrolling, or overlay options change.

## Empty and changing state

When `state.insights` is empty, or contains no recognized categories, the tab renders `No insights yet.` and category input does nothing. Category derivation reads current state on every render and input event, so asynchronous dashboard updates require no subscription changes.

## Height contract

The maximum populated category has six rows: five capped items plus one overflow item. Including the frame, main tab bar, category tabs, spacing, and footer:

- width 36 must render at most 20 lines;
- widths 73 and 100 must render at most 17 lines.

At width 36, the category tabs may occupy two rows. At widths 73 and 100, all four labels fit on one row. Staying within these budgets prevents Pi from slicing the footer or bottom frame.

## Tests

The dashboard tests will:

- replace the first stale grouped-category test with populated-category and default-selection coverage;
- replace the obsolete independent-period test with category navigation and Statistics-period isolation coverage;
- rewrite the duplicate grouped-category test to inspect the active project format, navigate to Cost patterns, and inspect its bullet format;
- use one `switchToInsights` helper in every relevant test;
- exercise Left and Right navigation, wraparound, omitted categories, durable fallback, and fallback persistence when a category returns;
- verify missing categories still map to Cost patterns;
- enforce the line budgets at widths 36, 73, and 100;
- update dashboard and constant footer assertions from Period to Category.

The focused tests must fail before implementation and pass afterward. Final automated verification runs `pnpm check`.

## Live verification

A 40 by 24 tmux session will start Pi and open `/usage`. The verification command must send Tab twice before capture because Usage Statistics is the default tab. The capture must show the Insights tab, available category tabs, selected rows, footer row, and bottom frame.

The phase ends with `git diff --check`, a clean status, and one atomic UI commit touching only:

- `src/tui/dashboard.ts`
- `src/shared/constants.ts`
- `tests/dashboard.test.ts`
- `tests/constants.test.ts`
