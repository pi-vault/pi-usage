import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultDeps } from "../src/deps.ts";
import { buildInsights, scanOfflineUsage } from "../src/offline.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-"));
}

describe("offline scanner", () => {
  it("parses assistant usage recursively and aggregates periods", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions", "a", "b");
    mkdirSync(sessions, { recursive: true });
    const now = Date.parse("2026-05-30T12:00:00Z");
    const todayRow = JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "2026-05-30T11:00:00Z",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt",
        usage: {
          input: 10,
          output: 20,
          cacheRead: 1,
          cacheWrite: 2,
          cost: 0.5,
        },
      },
    });
    const lastWeekRow = JSON.stringify({
      type: "message",
      id: "m2",
      timestamp: "2026-05-20T11:00:00Z",
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt",
        usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 1, cost: 0.1 },
      },
    });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${todayRow}\n${lastWeekRow}\n`,
      "utf8",
    );

    const deps = createDefaultDeps();
    const result = await scanOfflineUsage({
      ...deps,
      agentDir: () => root,
      now: () => now,
    });
    expect(result.turns).toHaveLength(2);
    expect(result.periods.today.total.messages).toBe(1);
    expect(result.periods.thisWeek.total.messages).toBe(1);
    expect(result.periods.lastWeek.total.messages).toBe(1);
    expect(result.periods.allTime.total.cost).toBeCloseTo(0.6);
    rmSync(root, { recursive: true, force: true });
  });

  it("deduplicates by id and ignores malformed rows", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const row = JSON.stringify({
      type: "message",
      id: "same",
      timestamp: "2026-05-30T11:00:00Z",
      message: {
        role: "assistant",
        provider: "x",
        model: "y",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.01 },
      },
    });
    writeFileSync(join(sessions, "a.jsonl"), `${row}\n${row}\n{bad}\n`, "utf8");
    const deps = createDefaultDeps();
    const result = await scanOfflineUsage({
      ...deps,
      agentDir: () => root,
    });
    expect(result.turns).toHaveLength(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("parses current nested usage costs", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "nested.jsonl"),
      `${JSON.stringify({
        type: "message",
        id: "nested",
        timestamp: "2026-05-30T11:00:00Z",
        message: {
          role: "assistant",
          provider: "opencode-go",
          model: "glm",
          usage: {
            input: 1,
            output: 2,
            cost: { input: 0.1, output: 0.2, total: 0.3 },
          },
        },
      })}\n`,
      "utf8",
    );
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
    });
    expect(result.turns[0].cost).toBe(0.3);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns empty for missing root", async () => {
    const deps = createDefaultDeps();
    const result = await scanOfflineUsage({
      ...deps,
      agentDir: () => "/definitely/missing",
    });
    expect(result.turns).toHaveLength(0);
  });
});

describe("insights", () => {
  it("produces five insight rows", () => {
    const turns = [
      {
        id: "1",
        sessionId: "s1",
        timestamp: 1,
        provider: "p",
        model: "m",
        input: 200000,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 0,
        cost: 1,
      },
      {
        id: "2",
        sessionId: "s1",
        timestamp: 9 * 60 * 60 * 1000,
        provider: "p",
        model: "m",
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 0,
        cost: 1,
      },
    ];
    expect(buildInsights(turns)).toHaveLength(5);
  });

  it("counts parallel sessions by distinct active session ids", () => {
    const sameSessionTurns = [1, 2, 3, 4].map((id) => ({
      id: String(id),
      sessionId: "same",
      timestamp: id,
      provider: "p",
      model: "m",
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 0,
      cost: 1,
    }));
    const distinctSessionTurns = [1, 2, 3, 4].map((id) => ({
      ...sameSessionTurns[id - 1],
      id: `distinct-${id}`,
      sessionId: `s${id}`,
    }));

    expect(buildInsights(sameSessionTurns)[0].cost).toBe(0);
    expect(buildInsights(distinctSessionTurns)[0].cost).toBe(4);
  });
});
