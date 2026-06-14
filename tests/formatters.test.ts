import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatAbbrev,
  formatCurrency,
  formatRatio,
  formatResetCompact,
} from "../src/tui/formatters.ts";

describe("formatAge", () => {
  it("shows seconds for <60s", () => {
    expect(formatAge(0)).toBe("0s old");
    expect(formatAge(5_000)).toBe("5s old");
    expect(formatAge(59_999)).toBe("59s old");
  });

  it("shows minutes for >=60s", () => {
    expect(formatAge(60_000)).toBe("1m old");
    expect(formatAge(90_000)).toBe("1m old");
    expect(formatAge(3_600_000)).toBe("60m old");
  });
});

describe("formatCurrency", () => {
  it("returns - for null/undefined/NaN/Infinity", () => {
    expect(formatCurrency(null)).toBe("-");
    expect(formatCurrency(undefined)).toBe("-");
    expect(formatCurrency(NaN)).toBe("-");
    expect(formatCurrency(Infinity)).toBe("-");
  });

  it("formats valid numbers with 2 decimal places", () => {
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(1.1)).toBe("$1.10");
    expect(formatCurrency(99.999)).toBe("$100.00");
    expect(formatCurrency(-5.5)).toBe("$-5.50");
  });
});

describe("formatAbbrev", () => {
  it("returns - for null/undefined/NaN/Infinity", () => {
    expect(formatAbbrev(null)).toBe("-");
    expect(formatAbbrev(undefined)).toBe("-");
    expect(formatAbbrev(NaN)).toBe("-");
    expect(formatAbbrev(Infinity)).toBe("-");
  });

  it("shows raw number for <1000", () => {
    expect(formatAbbrev(0)).toBe("0");
    expect(formatAbbrev(999)).toBe("999");
    expect(formatAbbrev(-500)).toBe("-500");
  });

  it("shows k suffix for 1k-999k", () => {
    expect(formatAbbrev(1_000)).toBe("1k");
    expect(formatAbbrev(1_500)).toBe("1.5k");
    expect(formatAbbrev(150_000)).toBe("150k");
  });

  it("shows M suffix for 1M-999M", () => {
    expect(formatAbbrev(1_000_000)).toBe("1M");
    expect(formatAbbrev(2_500_000)).toBe("2.5M");
  });

  it("shows B suffix for 1B+", () => {
    expect(formatAbbrev(1_000_000_000)).toBe("1B");
    expect(formatAbbrev(7_500_000_000)).toBe("7.5B");
  });
});

describe("formatResetCompact", () => {
  it("returns (reset unavailable) for undefined", () => {
    expect(formatResetCompact(undefined)).toBe("(reset unavailable)");
  });

  it("shows HH:MM only for same-day reset", () => {
    const now = new Date(2025, 5, 14, 10, 0, 0).getTime();
    const resetAt = new Date(2025, 5, 14, 15, 30, 0).getTime();
    const result = formatResetCompact(resetAt, now);
    expect(result).toBe("(resets 15:30)");
  });

  it("includes date for different-day reset", () => {
    const now = new Date(2025, 5, 14, 23, 0, 0).getTime();
    const resetAt = new Date(2025, 5, 15, 8, 0, 0).getTime();
    const result = formatResetCompact(resetAt, now);
    expect(result).toMatch(/^\(resets 08:00 on 15 Jun\)$/);
  });
});

describe("formatRatio", () => {
  it("returns undefined when used or limit is null", () => {
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: null,
        limit: 100,
        unit: "USD",
      } as never),
    ).toBeUndefined();
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: 50,
        limit: null,
        unit: "USD",
      } as never),
    ).toBeUndefined();
  });

  it("returns undefined when unit is missing", () => {
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: 50,
        limit: 100,
      } as never),
    ).toBeUndefined();
  });

  it("formats USD with currency symbols", () => {
    const result = formatRatio({
      key: "k",
      label: "l",
      usedPercent: 50,
      used: 5,
      limit: 10,
      unit: "USD",
    });
    expect(result).toBe("$5.00/$10.00");
  });

  it("formats requests with abbreviations", () => {
    const result = formatRatio({
      key: "k",
      label: "l",
      usedPercent: 50,
      used: 1500,
      limit: 3000,
      unit: "requests",
    });
    expect(result).toBe("1.5k/3k requests");
  });
});
