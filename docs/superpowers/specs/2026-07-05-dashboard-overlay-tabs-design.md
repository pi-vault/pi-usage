# Dashboard Overlay & Tabs Refactor

**Date:** 2026-07-05
**Status:** Approved
**Scope:** `src/tui/` layer only -- no public API changes

## Summary

Refactor the pi-usage dashboard from a vertically-stacked full-custom component into a centered overlay with 3 tabbed panes: Usage Statistics, Current Usage, and Insights. Adopt the overlay and rendering patterns from pi-extension-manager (replicated locally, not imported).

## Motivation

The current dashboard renders all sections stacked vertically in a single scroll, with Insights toggled via the `v` key replacing Usage Statistics. This makes the UI dense and requires the user to mentally separate unrelated data. The pi-extension-manager already establishes an overlay + tab pattern that users are familiar with. Aligning pi-usage to this pattern improves consistency and usability.

## Architecture

### Component Structure

Single `UsageDashboardComponent` class retained (no multi-component decomposition). Internal restructuring around tab state:

**State changes:**

- Add `activeTab: 'statistics' | 'current' | 'insights'` (default: `'statistics'`)
- Add `insightsPeriodIndex: number` -- independent period selector for the Insights tab
- Remove `showInsights: boolean` (replaced by tab state)
- Retain `periodIndex`, `rowIndex`, `expandedProvider`, `currentUsageProviderIndex` unchanged

**Render pipeline:**

```
render(width)
  -> frame(contentLines, width, theme, fixedInnerRows)
       -> renderTabBar(tabs, activeTab, innerWidth, theme)
       -> renderActiveTabContent(innerWidth)
            -> renderUsageStatisticsTab(w, lines)   // tab 0
            -> renderCurrentUsageTab(w, lines)       // tab 1
            -> renderInsightsTab(w, lines)           // tab 2
       -> renderFooter(innerWidth)                   // context-aware keys
```

### Overlay Configuration

The `openDashboard` function passes overlay options to `ctx.ui.custom()`:

```typescript
await ctx.ui.custom<void>(
  (tui, theme, _keys, done) => { ... },
  {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      maxHeight: "85%",
      width: "92%",
    },
  },
);
```

These dimensions match the pi-extension-manager for visual consistency.

## Tab Definitions

### Tab 1: Usage Statistics (default)

Content:

- Period selector tabs (Today, This Week, Last Week, All Time)
- Aggregated provider/model table with expandable rows
- Total row
- Token legend

Contextual keys:

- Left/Right: switch period
- Up/Down: navigate provider rows
- Enter/Space: expand/collapse selected provider

### Tab 2: Current Usage

Content:

- Provider selector tabs (live providers only)
- Provider heading (name, plan, status, age)
- Quota windows with progress bars
- Balances
- Diagnostics/Notes (previously a separate section, now housed here)

Contextual keys:

- Left/Right: switch provider

### Tab 3: Insights

Content:

- Period selector tabs (same as Usage Statistics, independent state)
- Insights grouped by category (Projects, Skills, MCP servers, Cost patterns)

Contextual keys:

- Left/Right: switch period

## Key Bindings

### Global (all tabs)

| Key       | Action                        |
| --------- | ----------------------------- |
| Tab       | Next tab                      |
| Shift-Tab | Previous tab                  |
| q / Esc   | Close dashboard (cancel scan) |

### Per-tab contextual keys

| Key         | Usage Statistics | Current Usage   | Insights      |
| ----------- | ---------------- | --------------- | ------------- |
| Left/Right  | Switch period    | Switch provider | Switch period |
| Up/Down     | Navigate rows    | (unused)        | (unused)      |
| Enter/Space | Expand/collapse  | (unused)        | (unused)      |

### Removed keys

- `v` -- no longer needed; Insights is its own tab

### Footer text (context-aware)

- Usage Statistics: `[Tab/Shift-Tab] Switch tab  [Left/Right] Period  [Up/Down] Row  [Enter] Expand  [q] Close`
- Current Usage: `[Tab/Shift-Tab] Switch tab  [Left/Right] Provider  [q] Close`
- Insights: `[Tab/Shift-Tab] Switch tab  [Left/Right] Period  [q] Close`

## New File: `src/tui/overlay-render.ts`

Local replications of pi-extension-manager rendering utilities. These do not import from the manager -- they replicate the patterns using pi-usage's existing `DashboardTheme` adapter.

### `frame(lines, width, theme, fixedInnerRows?, title?)`

Draws a bordered frame around content lines. Uses the manager's box-drawing characters (`┏━┓┃┗┛`) for visual consistency with other Pi overlays. The existing `UI_STRINGS.dashboardBorderChars` (`╭╮╰╯`) are replaced. Configurable padding: 2px horizontal, 1px vertical. Truncates overflow with `"down-arrow N more line(s)"` indicator when content exceeds `fixedInnerRows`.

### `renderTabBar(tabs, activeTab, width, theme)`

Renders pill-styled tabs within available width:

- Active tab: `theme.fg("accent", theme.inverse(theme.bold(label)))` -- inverted pill
- Inactive tabs: `theme.bg("selectedBg", theme.fg("accent", label))` -- subtle background pill
- Dynamic visibility with `<` / `>` overflow indicators (handles narrow terminals)

These pull colors through the `DashboardTheme` adapter, which delegates to Pi's live theme, ensuring visual consistency with the Pi theme in use.

### `pad(text, width)`

Pads text to exact visible width, ANSI-aware. Wraps `truncateToWidth` + space padding.

## Theme Changes

### `DashboardTheme` interface

Add two methods:

- `inverse(text: string): string` -- for active tab pill styling
- `bg(color: DashboardColor, text: string): string` -- for inactive tab pill background

### `fromPiTheme()` adapter

Add `inverse` and `bg` delegations to Pi's `theme.inverse()` and `theme.bg()`. Colors flow through Pi's live theme -- no hardcoded values. The `DashboardColor` type gains `"selectedBg"` for the inactive pill background.

### `noTheme` passthrough

Add `inverse` and `bg` as identity functions for unit tests.

## Files Changed

| File                         | Change                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/tui/overlay-render.ts`  | New file -- `frame()`, `renderTabBar()`, `pad()`                                                             |
| `src/tui/dashboard.ts`       | Refactor `render()`, `handleInput()`, add tab state, use `frame()` and `renderTabBar()`                      |
| `src/tui/dashboard-theme.ts` | Add `inverse` and `bg` to `DashboardTheme`, `fromPiTheme`, `noTheme`; add `"selectedBg"` to `DashboardColor` |
| `src/shared/constants.ts`    | Update `UI_STRINGS.dashboardFooter` to per-tab footers, remove `v` key reference                             |
| `tests/`                     | Update rendering and input tests for new tab structure                                                       |

## Files Unchanged

| File                         | Reason                                                                     |
| ---------------------------- | -------------------------------------------------------------------------- |
| `src/index.ts`               | `openDashboard` signature unchanged; only overlay options added internally |
| `src/tui/formatters.ts`      | All formatters reused as-is                                                |
| `src/tui/table-layout.ts`    | Table layout reused as-is within Usage Statistics tab                      |
| `src/tui/dashboard-model.ts` | Data model unchanged                                                       |
| `src/core/*`                 | Core logic untouched                                                       |
| `src/providers/*`            | Provider implementations untouched                                         |
| `src/shared/types.ts`        | Types unchanged                                                            |

## Testing

- Existing rendering tests updated to assert per-tab output (tab bar present, only active tab's content rendered)
- Existing `handleInput` tests updated for new key semantics (Tab switches tabs, `v` removed)
- `noTheme` passthrough extended with `inverse` so unit tests work without a real Pi theme
- No new test infrastructure needed -- same `render(width)` + `handleInput(data)` testing pattern
