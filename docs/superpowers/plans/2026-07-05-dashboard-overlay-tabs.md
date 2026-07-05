# Dashboard Overlay & Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the pi-usage dashboard from a vertically-stacked custom component into a centered overlay with 3 tabbed panes (Usage Statistics, Current Usage, Insights).

**Architecture:** Single `UsageDashboardComponent` class restructured around tab state. New `overlay-render.ts` provides `frame()`, `renderTabBar()`, and `pad()` utilities replicated from the pi-extension-manager pattern. The overlay uses `ctx.ui.custom()` with `{ overlay: true, overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" } }`.

**Tech Stack:** TypeScript, `@earendil-works/pi-tui` (Component, Key, matchesKey, visibleWidth, truncateToWidth), `@earendil-works/pi-coding-agent` (Theme), Vitest for tests.

**Reference repos:**

- pi-extension-manager: `/Users/lanh/Developer/pi-packages/vanillagreencom-vstack/pi-extensions/pi-extension-manager` -- overlay pattern, frame/tab bar rendering, pill styling
- pi TUI framework: `/Users/lanh/Developer/pi-packages/pi` -- Component/Theme/TUI/OverlayOptions interfaces

**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

---

## File Map

| File                            | Action | Responsibility                                                           |
| ------------------------------- | ------ | ------------------------------------------------------------------------ |
| `src/tui/dashboard-theme.ts`    | Modify | Add `inverse`, `bg` methods; add `"borderAccent"`, `"selectedBg"` colors |
| `src/tui/overlay-render.ts`     | Create | `frame()`, `renderTabBar()`, `pad()` utilities                           |
| `src/shared/constants.ts`       | Modify | Per-tab footer strings, updated border chars                             |
| `src/tui/dashboard.ts`          | Modify | Tab state, refactored `render()` and `handleInput()`, overlay options    |
| `tests/dashboard-theme.test.ts` | Create | Tests for new theme methods                                              |
| `tests/overlay-render.test.ts`  | Create | Tests for frame, tab bar, pad                                            |
| `tests/dashboard.test.ts`       | Modify | Update all assertions for tabbed overlay output                          |

---

## Task 1: Extend DashboardTheme with `inverse` and `bg`

**Files:**

- Modify: `src/tui/dashboard-theme.ts`
- Create: `tests/dashboard-theme.test.ts`

- [ ] **Step 1: Write failing tests for new theme methods**

Create `tests/dashboard-theme.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  noTheme,
  fromPiTheme,
  type DashboardTheme,
} from "../src/tui/dashboard-theme.ts";

describe("DashboardTheme", () => {
  describe("noTheme", () => {
    it("inverse returns text unchanged", () => {
      expect(noTheme.inverse("hello")).toBe("hello");
    });

    it("bg returns text unchanged", () => {
      expect(noTheme.bg("selectedBg", "hello")).toBe("hello");
    });
  });

  describe("fromPiTheme", () => {
    it("delegates inverse to theme.inverse", () => {
      const piTheme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => `<b>${text}</b>`,
        inverse: (text: string) => `<inv>${text}</inv>`,
        bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
      };
      const theme = fromPiTheme(piTheme as never);
      expect(theme.inverse("test")).toBe("<inv>test</inv>");
    });

    it("delegates bg to theme.bg", () => {
      const piTheme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => `<b>${text}</b>`,
        inverse: (text: string) => `<inv>${text}</inv>`,
        bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
      };
      const theme = fromPiTheme(piTheme as never);
      expect(theme.bg("selectedBg", "test")).toBe("<bg:selectedBg>test</bg>");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/dashboard-theme.test.ts`

Expected: FAIL -- `noTheme.inverse` is not a function, `noTheme.bg` is not a function.

- [ ] **Step 3: Add `inverse` and `bg` to DashboardTheme interface and implementations**

In `src/tui/dashboard-theme.ts`, update the `DashboardTheme` interface:

```typescript
export interface DashboardTheme {
  /** Foreground color for a themed string. */
  fg: (color: DashboardColor, text: string) => string;
  /** Background color for a themed string. */
  bg: (color: DashboardColor, text: string) => string;
  /** Bold modifier. */
  bold: (text: string) => string;
  /** Dim modifier. */
  dim: (text: string) => string;
  /** Inverse modifier (swap fg/bg). */
  inverse: (text: string) => string;
}
```

Update `DashboardColor` to include the new color roles:

```typescript
export type DashboardColor =
  | "accent"
  | "border"
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "muted"
  | "dim"
  | "text";
```

Update `noTheme`:

```typescript
export const noTheme: DashboardTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  inverse: (text) => text,
};
```

Update `fromPiTheme`:

```typescript
export function fromPiTheme(theme: Theme): DashboardTheme {
  return {
    fg: (color, text) => theme.fg(color, text),
    bg: (color, text) => theme.bg(color as never, text),
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    inverse: (text) => theme.inverse(text),
  };
}
```

Note: `bg` casts to `never` because `DashboardColor` is a superset that includes fg-only colors. Only `"selectedBg"` is a valid `ThemeBg` key, but the cast keeps the adapter simple. The caller is responsible for passing valid bg colors.

- [ ] **Step 4: Run new tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/dashboard-theme.test.ts`

Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass. The existing code still compiles because the new methods are additive.

- [ ] **Step 6: Update `makeAnsiTheme` test helper for the new methods**

In `tests/dashboard.test.ts`, update the `makeAnsiTheme` function to include `inverse` and `bg`:

```typescript
function makeAnsiTheme(): DashboardTheme & {
  calls: { method: string; color?: string; text: string }[];
} {
  const calls: { method: string; color?: string; text: string }[] = [];
  const wrap = (open: string) => (text: string) => {
    if (text.length === 0) return text;
    return `${open}${text}${ANSI_ESCAPE}[0m`;
  };
  return {
    calls,
    fg: (color, text) => {
      calls.push({ method: "fg", color, text });
      return wrap(`${ANSI_ESCAPE}[38;5;75m`)(text);
    },
    bg: (color, text) => {
      calls.push({ method: "bg", color, text });
      return wrap(`${ANSI_ESCAPE}[48;5;236m`)(text);
    },
    bold: (text) => {
      calls.push({ method: "bold", text });
      return `${ANSI_ESCAPE}[1m${text}${ANSI_ESCAPE}[22m`;
    },
    dim: (text) => {
      calls.push({ method: "dim", text });
      return wrap(`${ANSI_ESCAPE}[38;5;243m`)(text);
    },
    inverse: (text) => {
      calls.push({ method: "inverse", text });
      return `${ANSI_ESCAPE}[7m${text}${ANSI_ESCAPE}[27m`;
    },
  };
}
```

- [ ] **Step 7: Run all tests again**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/tui/dashboard-theme.ts tests/dashboard-theme.test.ts tests/dashboard.test.ts
git commit -m "feat(tui): add inverse and bg methods to DashboardTheme

Extend the theme adapter with inverse() for active tab pill styling
and bg() for inactive tab pill background. Add selectedBg and
borderAccent to DashboardColor. Update noTheme, fromPiTheme, and
test helper.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 2: Create overlay-render.ts with frame, tab bar, and pad utilities

**Files:**

- Create: `src/tui/overlay-render.ts`
- Create: `tests/overlay-render.test.ts`

**Reference:** The pi-extension-manager's `extensions/manager/render.ts` (frame, renderTabBar, pad, pill helpers) and `extensions/manager/types.ts` (POPUP_PADDING_X/Y constants). Replicate the patterns using `DashboardTheme` instead of Pi's `Theme` directly.

- [ ] **Step 1: Write failing tests for `pad`**

Create `tests/overlay-render.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { pad, frame, renderTabBar } from "../src/tui/overlay-render.ts";
import { noTheme } from "../src/tui/dashboard-theme.ts";

describe("pad", () => {
  it("pads short text with trailing spaces", () => {
    expect(pad("hi", 10)).toBe("hi        ");
  });

  it("returns text unchanged when it fills the width", () => {
    expect(pad("hello", 5)).toBe("hello");
  });

  it("truncates text that exceeds the width", () => {
    const result = pad("hello world", 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("handles zero width", () => {
    expect(pad("hi", 0)).toBe("");
  });
});
```

- [ ] **Step 2: Write failing tests for `frame`**

Append to `tests/overlay-render.test.ts`:

```typescript
describe("frame", () => {
  it("wraps content lines in a bordered box", () => {
    const lines = frame(["hello", "world"], 20, noTheme);
    // Top border
    expect(lines[0]).toContain("┏");
    expect(lines[0]).toContain("┓");
    // Bottom border
    expect(lines[lines.length - 1]).toContain("┗");
    expect(lines[lines.length - 1]).toContain("┛");
    // Content lines have vertical borders
    const contentLine = lines.find((l) => l.includes("hello"));
    expect(contentLine).toBeDefined();
    expect(contentLine).toContain("┃");
  });

  it("includes padding rows above and below content", () => {
    const lines = frame(["test"], 20, noTheme);
    // Structure: top border, 1 padding row, content, 1 padding row, bottom border
    expect(lines.length).toBe(5); // 1 top + 1 pad + 1 content + 1 pad + 1 bottom
  });

  it("truncates overflow with indicator when fixedInnerRows is set", () => {
    const content = ["line1", "line2", "line3", "line4", "line5"];
    const lines = frame(content, 30, noTheme, 3);
    const joined = lines.join("\n");
    expect(joined).toContain("line1");
    expect(joined).toContain("line2");
    expect(joined).toContain("more line(s)");
    expect(joined).not.toContain("line5");
  });

  it("renders a title in the top border when provided", () => {
    const lines = frame(["content"], 30, noTheme, undefined, "My Title");
    expect(lines[0]).toContain("My Title");
    expect(lines[0]).toContain("┏");
  });

  it("pads content to frameContentWidth", () => {
    const lines = frame(["hi"], 20, noTheme);
    // Content line: ┃ + 2 pad + content padded to contentWidth + 2 pad + ┃
    // All lines should be exactly 20 chars wide (in visible width)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });
});
```

- [ ] **Step 3: Write failing tests for `renderTabBar`**

Append to `tests/overlay-render.test.ts`:

```typescript
describe("renderTabBar", () => {
  const tabs = [
    { id: "stats", label: "Usage Statistics" },
    { id: "current", label: "Current Usage" },
    { id: "insights", label: "Insights" },
  ];

  it("renders all tabs with active tab highlighted", () => {
    const result = renderTabBar(tabs, "stats", 80, noTheme);
    expect(result).toContain("Usage Statistics");
    expect(result).toContain("Current Usage");
    expect(result).toContain("Insights");
  });

  it("returns empty padding for no tabs", () => {
    const result = renderTabBar([], "stats", 20, noTheme);
    expect(result.trim()).toBe("");
  });

  it("shows overflow indicators when tabs exceed width", () => {
    const result = renderTabBar(tabs, "insights", 20, noTheme);
    // At 20 chars wide, not all tabs can fit
    expect(result).toContain("Insights");
  });

  it("pads result to the requested width", () => {
    const result = renderTabBar(tabs, "stats", 80, noTheme);
    // Result should be padded to exactly 80 visible chars
    expect(result.length).toBe(80);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/overlay-render.test.ts`

Expected: FAIL -- module `../src/tui/overlay-render.ts` not found.

- [ ] **Step 5: Implement `overlay-render.ts`**

Create `src/tui/overlay-render.ts`:

```typescript
/**
 * Overlay rendering utilities for the usage dashboard.
 *
 * Replicates patterns from the pi-extension-manager's render helpers using
 * the dashboard's own DashboardTheme adapter so colors flow through Pi's
 * live theme.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DashboardTheme, DashboardColor } from "./dashboard-theme.ts";

// ── Layout constants ────────────────────────────────────────────────────

const PADDING_X = 2;
const PADDING_Y = 1;

// ── Frame glyphs ────────────────────────────────────────────────────────

const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

// ── Tab types ───────────────────────────────────────────────────────────

export interface DashboardTab {
  id: string;
  label: string;
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Pad `text` to exactly `width` visible columns. Truncates if wider.
 */
export function pad(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

/**
 * Calculate the content width inside a frame (excluding borders and padding).
 */
export function frameContentWidth(width: number): number {
  return Math.max(1, width - 2 - PADDING_X * 2);
}

// ── Frame ───────────────────────────────────────────────────────────────

/**
 * Wrap content `lines` in a bordered frame box.
 *
 * Matches the pi-extension-manager's frame rendering:
 * - Top/bottom borders with optional title
 * - PADDING_Y blank rows above/below content
 * - PADDING_X space columns on each side of content
 * - Overflow truncation with "↓ N more line(s)" when fixedInnerRows is set
 */
export function frame(
  lines: string[],
  width: number,
  theme: DashboardTheme,
  fixedInnerRows?: number,
  title = "",
): string[] {
  const inner = Math.max(1, width - 2);
  const contentWidth = frameContentWidth(width);
  const border = (s: string) => theme.fg("borderAccent", s);

  let body = lines;
  if (fixedInnerRows !== undefined && body.length > fixedInnerRows) {
    const hidden = body.length - fixedInnerRows + 1;
    body = [
      ...body.slice(0, Math.max(0, fixedInnerRows - 1)),
      theme.fg("dim", `↓ ${hidden} more line(s)`),
    ].slice(0, fixedInnerRows);
  }

  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;

  const top = (): string => {
    if (!title) {
      return `${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`;
    }
    const titleText = ` ${truncateToWidth(title, Math.max(1, inner - 2), "…")} `;
    const fill = Math.max(1, inner - visibleWidth(titleText));
    return `${border(FRAME.tl)}${theme.fg("accent", titleText)}${border(FRAME.h.repeat(fill))}${border(FRAME.tr)}`;
  };

  const out = [top()];
  for (let i = 0; i < PADDING_Y; i += 1) out.push(blank);
  for (const line of body) {
    out.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }
  for (let i = 0; i < PADDING_Y; i += 1) out.push(blank);
  out.push(
    `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`,
  );
  return out.map((line) => truncateToWidth(line, width, ""));
}

// ── Tab bar ─────────────────────────────────────────────────────────────

function activePill(theme: DashboardTheme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: DashboardTheme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

/**
 * Render a tab bar with pill-styled active/inactive tabs.
 *
 * Dynamic visibility: expands tabs around the active tab to fit `width`,
 * showing ‹/› indicators when tabs overflow.
 */
export function renderTabBar(
  tabs: DashboardTab[],
  activeId: string,
  width: number,
  theme: DashboardTheme,
): string {
  const safeWidth = Math.max(1, width);
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2); // " label "

  const sliceWidth = (s: number, e: number): number => {
    let total = 0;
    for (let i = s; i < e; i += 1) total += widths[i]!;
    total += Math.max(0, e - s - 1); // single-space gaps
    total += s > 0 ? 2 : 0; // "‹ "
    total += e < tabs.length ? 2 : 0; // " ›"
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };
    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId
      ? activePill(theme, label)
      : inactivePill(theme, label);
  });
  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return pad(cells.join(" "), safeWidth);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/overlay-render.test.ts`

Expected: All PASS.

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass. The new file is additive -- nothing imports it yet.

- [ ] **Step 8: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/tui/overlay-render.ts tests/overlay-render.test.ts
git commit -m "feat(tui): add overlay rendering utilities

Add frame(), renderTabBar(), and pad() in overlay-render.ts.
Replicates pi-extension-manager patterns using DashboardTheme
for Pi theme integration.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 3: Update constants for tabbed layout

**Files:**

- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Update `UI_STRINGS` with per-tab footers and frame chars**

In `src/shared/constants.ts`, replace the footer and border definitions:

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

Note: The old `dashboardFooter` (singular) and `dashboardBorderChars` are removed. Border rendering is now handled by `frame()` in `overlay-render.ts`.

- [ ] **Step 2: Fix any compile errors from the removal**

Check `src/tui/dashboard.ts` for references to `UI_STRINGS.dashboardFooter` and `UI_STRINGS.dashboardBorderChars`. These will cause type errors -- that's expected. They will be fixed in Task 4 when the dashboard render pipeline is refactored. For now, temporarily keep the old properties alongside the new ones to avoid breaking the build:

```typescript
export const UI_STRINGS = {
  dashboardTitle: "Pi Usage Dashboard",
  // New per-tab footers
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
  // Legacy -- removed in Task 4 when dashboard.ts stops referencing them
  dashboardFooter: [
    "[Tab/Shift-Tab] Provider",
    "[Left/Right] Period",
    "[Up/Down] Row",
    "[Enter/Space] Expand/Collapse",
    "[v] Insights",
    "[q/Esc] Close",
  ].join(" \u2022 "),
  dashboardBorderedSectionTitles: {
    usageStatistics: "Usage Statistics",
    currentUsage: "Current Usage",
    insights: "Insights",
    notes: "Notes",
  },
  dashboardBorderChars: {
    topLeft: "\u256D",
    topRight: "\u256E",
    bottomLeft: "\u2570",
    bottomRight: "\u256F",
    horizontal: "\u2500",
    separatorLeft: "\u251C",
    separatorRight: "\u2524",
  },
  dashboardDefaultPeriod: "allTime" as UsageWindow,
} as const;
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass (legacy properties kept for backward compatibility).

- [ ] **Step 4: Commit**

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

---

## Task 4: Refactor dashboard component to tabbed overlay

This is the main refactor. The component gains tab state, the render pipeline uses `frame()` + `renderTabBar()`, and `handleInput()` is restructured for tab-based navigation.

**Files:**

- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add tab state and type**

At the top of `src/tui/dashboard.ts`, add the tab type and tab definitions:

```typescript
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "./overlay-render.ts";
import { UI_STRINGS } from "../shared/constants.ts";

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

In the `UsageDashboardComponent` class, replace the `showInsights` field and add `activeTab` + `insightsPeriodIndex`:

```typescript
export class UsageDashboardComponent implements Component {
  private activeTab: DashboardTabId = "statistics";
  private periodIndex = DEFAULT_PERIOD_INDEX;
  private insightsPeriodIndex = DEFAULT_PERIOD_INDEX;
  private rowIndex = 0;
  private expandedProvider: string | null = null;
  private currentUsageProviderIndex: number;
  // ... rest unchanged
```

Remove the `private showInsights = false;` line.

- [ ] **Step 2: Add tab switching helper**

Add a `switchTab` method to the component class:

```typescript
private switchTab(delta: number): void {
  const ids = DASHBOARD_TABS.map((t) => t.id);
  const currentIndex = ids.indexOf(this.activeTab);
  const next = (currentIndex + delta + ids.length) % ids.length;
  this.activeTab = ids[next] as DashboardTabId;
}
```

- [ ] **Step 3: Refactor `handleInput` for tab-based navigation**

Replace the `handleInput` method:

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

- [ ] **Step 4: Refactor `render()` to use frame + tab bar + per-tab content**

Replace the `render` method:

```typescript
render(width: number): string[] {
  const w = Math.max(8, width);
  const contentWidth = frameContentWidth(w);
  const lines: string[] = [];

  // Tab bar
  lines.push(renderTabBar(DASHBOARD_TABS, this.activeTab, contentWidth, this.theme));
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

- [ ] **Step 5: Rename section renderers to tab renderers**

Rename `renderUsageStatistics` to `renderUsageStatisticsTab` and remove the insights toggle:

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

Rename `renderCurrentUsage` to `renderCurrentUsageTab` and move diagnostics into it:

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

  // Diagnostics (previously a separate section)
  this.renderDiagnostics(lines);
}
```

Add a new `renderInsightsTab`:

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

- [ ] **Step 6: Update `renderFooter` to be context-aware**

Replace the `renderFooter` method:

```typescript
private renderFooter(width: number): string {
  const footerKey = this.activeTab === "statistics"
    ? "statistics"
    : this.activeTab === "current"
      ? "current"
      : "insights";
  return this.theme.dim(truncateVisible(UI_STRINGS.dashboardFooters[footerKey], width));
}
```

- [ ] **Step 7: Remove dead code**

Remove these methods/fields that are no longer needed:

- `borderLine(width)` method
- `currentUsageHeaderSeparator(width)` method
- `bottomBorder(width)` method
- `sectionTitle(text)` method (section titles are now tab names in the tab bar)
- The old `render()` method body (already replaced in step 4)
- Remove imports of `horizontalBorder` and `borderSeparator` helper functions
- Remove the `horizontalBorder` and `borderSeparator` free functions

- [ ] **Step 8: Update `openDashboard` to use overlay options**

In the `openDashboard` function at the bottom of `dashboard.ts`:

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

- [ ] **Step 9: Verify the build compiles**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit`

Expected: No type errors. If any references to the old `dashboardFooter` or `dashboardBorderChars` remain, fix them.

- [ ] **Step 10: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/tui/dashboard.ts
git commit -m "feat(tui): refactor dashboard to tabbed overlay

Replace vertical stacking with 3 tabs: Usage Statistics, Current
Usage, Insights. Use frame() and renderTabBar() from overlay-render.
Tab/Shift-Tab switches tabs, Left/Right is contextual per tab.
Diagnostics moved into Current Usage tab. Enable overlay mode with
centered anchor, 85% maxHeight, 92% width.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 5: Remove legacy constants

**Files:**

- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Remove legacy footer and border char properties**

In `src/shared/constants.ts`, remove the `dashboardFooter` and `dashboardBorderChars` properties from `UI_STRINGS` that were kept for backward compatibility in Task 3:

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

- [ ] **Step 2: Verify no remaining references**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && grep -r "dashboardFooter[^s]" src/ tests/ || echo "No references"` and `grep -r "dashboardBorderChars" src/ tests/ || echo "No references"`

Expected: No references found (tests not yet updated may still reference them -- if so, do not remove yet and defer to Task 6).

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/shared/constants.ts
git commit -m "chore(constants): remove legacy dashboard footer and border chars

These are superseded by dashboardFooters (per-tab) and the frame()
utility in overlay-render.ts.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 6: Update dashboard tests

**Files:**

- Modify: `tests/dashboard.test.ts`

The tests need to account for:

1. Output is now wrapped in a `frame()` -- top/bottom borders are `┏━┓` / `┗━┛` instead of `╭─╮` / `╰─╯`
2. A tab bar appears at the top with `Usage Statistics`, `Current Usage`, `Insights`
3. Only the active tab's content is rendered (no stacking of all sections)
4. `Tab`/`Shift-Tab` switches tabs instead of cycling providers
5. Provider cycling uses `Left`/`Right` within the Current Usage tab
6. `v` key no longer toggles insights
7. Insights is a separate tab with its own period selector
8. Footer is context-aware per tab
9. Diagnostics appear inside the Current Usage tab

- [ ] **Step 1: Update the main render test**

Replace the `"renders usage statistics + current usage with selected provider details"` test:

```typescript
it("renders Usage Statistics tab by default with table and legend", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  const out = c.render(140).join("\n");

  // Frame borders
  expect(out).toContain("┏");
  expect(out).toContain("┛");

  // Tab bar with Usage Statistics active
  expect(out).toContain("Usage Statistics");
  expect(out).toContain("Current Usage");
  expect(out).toContain("Insights");

  // Default period is All Time
  expect(out).toContain("[All Time]");
  expect(out).toContain("Provider / Model");
  expect(out).toContain("openai-codex");
  expect(out).toContain("428k");

  expect(out).toContain("Tokens = Input + Output + CacheW");

  // Current Usage content should NOT be visible on the Statistics tab
  expect(out).not.toContain("Command Code (Go) \u2022 live \u2022 4s old");
  expect(out).not.toContain("57% left");
});
```

- [ ] **Step 2: Add test for Current Usage tab**

```typescript
it("renders Current Usage tab with provider details and diagnostics", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");
  const out = c.render(140).join("\n");

  expect(out).toContain("Command Code (Go) \u2022 live \u2022 4s old");
  expect(out).toContain("57% left");
  expect(out).toContain(expectedResetText(Date.parse("2026-06-07T11:47:00")));

  // Diagnostics should appear in Current Usage tab
  expect(out).toContain("Subscription endpoint unavailable.");

  // Usage Statistics table should NOT be visible
  expect(out).not.toContain("Provider / Model");
  expect(out).not.toContain("[All Time]");
});
```

- [ ] **Step 3: Add test for Insights tab**

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
});
```

- [ ] **Step 4: Update tab/provider navigation tests**

Replace the `"wraps joined legend and supports tab-based provider navigation"` test:

```typescript
it("supports provider navigation with left/right in Current Usage tab", () => {
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme: noTheme,
  });
  // Switch to Current Usage tab
  c.handleInput("\t");

  // Left arrow cycles providers
  c.handleInput("\u001b[D"); // Left
  let out = c.render(120).join("\n");
  expect(out).toContain("OpenRouter");

  // Right arrow cycles back
  c.handleInput("\u001b[C"); // Right
  out = c.render(120).join("\n");
  expect(out).toContain("Command Code (Go)");
});
```

- [ ] **Step 5: Update the insights toggle test**

Replace the `"uses enter/space for expand, v for insights, and left/right for period changes"` test:

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
});
```

- [ ] **Step 6: Update the insights grouping test**

Replace the `"renders insights grouped by category"` test. This now uses tab switching instead of `v`:

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
  // Switch to Insights tab
  c.handleInput("\t");
  c.handleInput("\t");
  const lines = c.render(100);
  const out = lines.join("\n");
  expect(out).toContain("Projects");
  expect(out).toContain("career-ops");
  expect(out).toContain("90.0%");
  expect(out).toContain("Cost patterns");
  expect(out).toContain("Large context");
  expect(out).toContain("  - Large context:");
});
```

- [ ] **Step 7: Update the "defaults insights without category" test**

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

- [ ] **Step 8: Update themed styling tests**

In the `"dashboard themed styling"` describe block:

Update `"wraps section titles, borders, and dimmed helpers with ANSI escape codes"`:

```typescript
it("renders frame borders and tab bar with themed styling", () => {
  const theme = makeAnsiTheme();
  const c = new UsageDashboardComponent(mkState(), () => undefined, {
    theme,
  });
  const lines = c.render(140);
  const out = lines.join("\n");

  // Frame uses ┏ and ┛ (from overlay-render frame glyphs)
  expect(out).toContain("┏");
  expect(out).toContain("┛");

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

Update `"dims the inactive provider tabs in Current Usage"`:

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

- [ ] **Step 9: Update the footer test**

Replace `"renders the footer in [Shortcut] Action format with dimmed styling"`:

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

- [ ] **Step 10: Update responsive layout tests**

Update `"renders at very narrow widths without breaking the table"`:

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
  expect(lines.join("\n")).toContain("┏");
  expect(lines.join("\n")).toContain("┛");
});
```

- [ ] **Step 11: Remove or update tests that reference the `v` key or old layout**

Remove the test `"renders empty line between Usage Statistics title and period tabs"` -- the section title is now in the tab bar, not a separate line.

Remove the `"dims the inactive provider tabs in Current Usage"` test that checks for provider tab dimming on the Statistics tab -- provider tabs are now only visible on the Current Usage tab.

Update any other tests that assert the old stacked layout (both `"Usage Statistics"` and `"Current Usage"` visible simultaneously).

- [ ] **Step 12: Run all tests**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass. If any fail, fix the assertions to match the new tabbed output structure.

- [ ] **Step 13: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add tests/dashboard.test.ts
git commit -m "test(tui): update dashboard tests for tabbed overlay

Update all render and input assertions for the new tab-based layout.
Remove v-key toggle tests. Add tab switching, per-tab content, and
context-aware footer tests.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```

---

## Task 7: Final verification and cleanup

**Files:**

- All modified files

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Type check**

Run: `cd /Users/lanh/Developer/pi-vault/pi-usage && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Verify no dead references to removed constants**

Run:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
grep -rn "dashboardFooter[^s]" src/ tests/ || echo "No stale footer refs"
grep -rn "dashboardBorderChars" src/ tests/ || echo "No stale border refs"
grep -rn "showInsights" src/ tests/ || echo "No stale showInsights refs"
grep -rn '"v"' src/tui/dashboard.ts || echo "No v-key handler"
```

Expected: No references found for any of these.

- [ ] **Step 4: Verify overlay options are present**

Run: `grep -A5 "overlay:" src/tui/dashboard.ts`

Expected: Shows `overlay: true` with `overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" }`.

- [ ] **Step 5: Commit any remaining fixes**

If any fixes were needed, commit them:

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add -A
git commit -m "fix(tui): address remaining issues from tabbed overlay refactor

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
