import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  anchoredMonthWindow,
  collectPiRows,
  rolling5h,
  utcMondayStart,
} from "../src/providers/opencode-go/window-calculator.ts";
import type { CostRow } from "../src/providers/opencode-go/types.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-wincalc-"));
}

function piRow(timestamp: string, cost: number, provider = "opencode-go"): string {
  return JSON.stringify({
    type: "message",
    id: `row-${Date.now()}-${Math.random()}`,
    timestamp,
    message: {
      role: "assistant",
      provider,
      model: "glm",
      usage: { cost: { total: cost } },
    },
  });
}

describe("window-calculator", () => {
  describe("utcMondayStart", () => {
    it("returns previous Monday 00:00 UTC for a Wednesday", () => {
      // 2025-01-08 Wed 12:00 UTC
      const wed = Date.UTC(2025, 0, 8, 12, 0, 0);
      const monday = utcMondayStart(wed);
      const date = new Date(monday);
      expect(date.getUTCDay()).toBe(1); // Monday
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it("returns same day at 00:00 if already Monday", () => {
      const mon = Date.UTC(2025, 0, 6, 15, 30, 0);
      const result = utcMondayStart(mon);
      const date = new Date(result);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCDate()).toBe(6);
      expect(date.getUTCHours()).toBe(0);
    });

    it("handles Sunday (wraps to previous Monday)", () => {
      const sun = Date.UTC(2025, 0, 12, 10, 0, 0);
      const result = utcMondayStart(sun);
      const date = new Date(result);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCDate()).toBe(6);
    });
  });

  describe("rolling5h", () => {
    it("returns 0 for empty rows", () => {
      const now = Date.now();
      const result = rolling5h([], now);
      expect(result.used).toBe(0);
      expect(result.resetAt).toBe(now + 5 * 3600 * 1000);
    });

    it("sums costs in the current 5h bucket", () => {
      const now = 1_000_000_000;
      const rows: CostRow[] = [
        { ts: now - 1_000_000, cost: 0.5 },
        { ts: now - 500_000, cost: 0.3 },
      ];
      const result = rolling5h(rows, now);
      expect(result.used).toBeCloseTo(0.8);
    });

    it("resets bucket when gap exceeds 5h", () => {
      const now = 1_000_000_000;
      const rows: CostRow[] = [
        { ts: now - 20_000_000, cost: 5.0 }, // old bucket (>5h ago)
        { ts: now - 1_000_000, cost: 0.2 }, // current bucket
      ];
      const result = rolling5h(rows, now);
      expect(result.used).toBeCloseTo(0.2);
    });
  });

  describe("anchoredMonthWindow", () => {
    it("returns window anchored to earliest row timestamp", () => {
      const now = Date.UTC(2025, 5, 15, 12, 0, 0); // Jun 15
      const anchor = Date.UTC(2025, 5, 1, 0, 0, 0); // Jun 1
      const result = anchoredMonthWindow(now, anchor);
      expect(result.start).toBeLessThanOrEqual(now);
      expect(result.end).toBeGreaterThan(now);
    });

    it("wraps to previous month if anchor day is in the future", () => {
      const now = Date.UTC(2025, 5, 5, 12, 0, 0); // Jun 5
      const anchor = Date.UTC(2025, 4, 20, 0, 0, 0); // May 20 (anchor day=20 > current day=5)
      const result = anchoredMonthWindow(now, anchor);
      expect(result.start).toBeLessThan(now);
    });
  });

  describe("collectPiRows", () => {
    it("returns opencode-go rows with positive cost", async () => {
      const root = mkTmp();
      const sessions = join(root, "sessions");
      mkdirSync(sessions, { recursive: true });
      writeFileSync(
        join(sessions, "pi.jsonl"),
        `${[
          piRow("2026-06-01T10:00:00Z", 2.5),
          piRow("2026-06-01T11:00:00Z", 1.0),
        ].join("\n")}\n`,
      );
      const deps = { ...createDefaultDeps(), agentDir: () => root };
      const rows = await collectPiRows(deps);
      expect(rows).toHaveLength(2);
      expect(rows[0].cost).toBe(2.5);
      expect(rows[1].cost).toBe(1.0);
      rmSync(root, { recursive: true, force: true });
    });

    it("filters out non-opencode-go providers and zero-cost rows", async () => {
      const root = mkTmp();
      const sessions = join(root, "sessions");
      mkdirSync(sessions, { recursive: true });
      writeFileSync(
        join(sessions, "pi.jsonl"),
        `${[
          piRow("2026-06-01T10:00:00Z", 3.0, "openai-codex"),
          piRow("2026-06-01T11:00:00Z", 0, "opencode-go"),
          piRow("2026-06-01T12:00:00Z", 1.5, "opencode-go"),
        ].join("\n")}\n`,
      );
      const deps = { ...createDefaultDeps(), agentDir: () => root };
      const rows = await collectPiRows(deps);
      expect(rows).toHaveLength(1);
      expect(rows[0].cost).toBe(1.5);
      rmSync(root, { recursive: true, force: true });
    });

    it("returns empty array when no sessions directory exists", async () => {
      const root = mkTmp();
      const deps = { ...createDefaultDeps(), agentDir: () => root };
      const rows = await collectPiRows(deps);
      expect(rows).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    });
  });
});
