# Phase 2: Render Utilities — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `src/tui/overlay-render.ts` with `pad()`, `frame()`, `renderTabBar()`, `frameContentWidth()`, and a `DashboardTab` interface, replicated from the pi-extension-manager pattern using `DashboardTheme`.

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** Phase 1 complete (`DashboardTheme` has `inverse`, `bg`; `DashboardColor` has `"borderAccent"`, `"selectedBg"`)
**Postconditions:** All tests pass. `overlay-render.ts` exports `pad`, `frame`, `renderTabBar`, `frameContentWidth`, and `DashboardTab`. Dashboard is NOT modified.

---

## Steps

- [ ] **Step 1: Write failing tests for `pad`**

Create `tests/overlay-render.test.ts` with the initial `pad` tests:

```typescript
import { describe, expect, it } from "vitest";
import { pad, frame, renderTabBar, frameContentWidth } from "../src/tui/overlay-render.ts";
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
describe("frameContentWidth", () => {
  it("subtracts borders and padding from total width", () => {
    // width - 2 (borders) - PADDING_X * 2 (4) = width - 6
    expect(frameContentWidth(20)).toBe(14);
    expect(frameContentWidth(10)).toBe(4);
  });

  it("returns 1 for very small widths", () => {
    expect(frameContentWidth(1)).toBe(1);
    expect(frameContentWidth(0)).toBe(1);
  });
});

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

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/overlay-render.test.ts
```

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

- [ ] **Step 6: Run overlay-render tests to verify they pass**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/overlay-render.test.ts
```

Expected: All PASS.

- [ ] **Step 7: Run full test suite**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

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
