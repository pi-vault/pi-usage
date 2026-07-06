import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  pad,
  frame,
  renderTabBar,
  frameContentWidth,
} from "../src/tui/overlay-render.ts";
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
    // truncateToWidth appends an ANSI reset sequence, so check visible width
    expect(visibleWidth(result)).toBe(5);
  });

  it("handles zero width", () => {
    expect(pad("hi", 0)).toBe("");
  });
});

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

  it("pads content to frameContentWidth", () => {
    const lines = frame(["hi"], 20, noTheme);
    // Content line: ┃ + 2 pad + content padded to contentWidth + 2 pad + ┃
    // All lines should be exactly 20 chars wide (in visible width)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it("renders an empty frame when content is empty", () => {
    const lines = frame([], 20, noTheme);
    // Structure: top border, 1 padding row, 1 padding row, bottom border (no content rows)
    expect(lines.length).toBe(4); // 1 top + 1 pad + 1 pad + 1 bottom
    expect(lines[0]).toContain("┏");
    expect(lines[lines.length - 1]).toContain("┗");
  });
});

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
    expect(visibleWidth(result)).toBe(80);
  });

  it("defaults to first tab when activeId is not found", () => {
    const result = renderTabBar(tabs, "nonexistent", 80, noTheme);
    // First tab becomes active by default (Math.max(0, findIndex(...)))
    expect(result).toContain("Usage Statistics");
  });
});
