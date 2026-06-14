import { describe, expect, it } from "vitest";
import {
  labelWidth,
  separator,
  tableColumns,
  tableLine,
} from "../src/tui/table-layout.ts";
import type { AggregatedUsageRow } from "../src/shared/types.ts";

const mockRow: AggregatedUsageRow = {
  key: "test-provider",
  sessionCount: 5,
  messageCount: 42,
  input: 150_000,
  output: 50_000,
  cache: 100_000,
  cacheRead: 80_000,
  cacheWrite: 20_000,
  tokens: 200_000,
  cost: 1.23,
};

describe("tableColumns", () => {
  it("returns 2 columns at width <72", () => {
    const cols = tableColumns(50);
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => c.label)).toEqual(["Cost", "Tokens"]);
  });

  it("returns 3 columns at width 72-93", () => {
    const cols = tableColumns(80);
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.label)).toEqual(["Sessions", "Cost", "Tokens"]);
  });

  it("returns 6 columns at width 94-119", () => {
    const cols = tableColumns(100);
    expect(cols).toHaveLength(6);
  });

  it("returns 8 columns at width >=120", () => {
    const cols = tableColumns(140);
    expect(cols).toHaveLength(8);
    expect(cols[6].label).toBe("CacheR");
    expect(cols[7].label).toBe("CacheW");
  });
});

describe("labelWidth", () => {
  it("returns at least 18", () => {
    const cols = tableColumns(30);
    expect(labelWidth(cols, 30)).toBe(18);
  });

  it("grows with available width", () => {
    const cols = tableColumns(120);
    const lw = labelWidth(cols, 120);
    expect(lw).toBeGreaterThan(18);
  });
});

describe("tableLine", () => {
  it("renders header when row is undefined", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const line = tableLine("Provider", cols, pw);
    expect(line).toContain("Provider");
    expect(line).toContain("Sessions");
    expect(line).toContain("Cost");
  });

  it("renders data row with formatted values", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const line = tableLine("TestProvider", cols, pw, mockRow);
    expect(line).toContain("TestProvider");
    expect(line).toContain("$1.23");
    expect(line).toContain("200k");
  });
});

describe("separator", () => {
  it("produces a line of box-drawing characters", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const sep = separator(cols, pw);
    expect(sep).toMatch(/^─+$/);
    expect(sep.length).toBeGreaterThan(0);
  });
});
