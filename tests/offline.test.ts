import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultDeps } from "../src/shared/deps.ts";
import { buildInsights, scanOfflineUsage } from "../src/core/offline.ts";

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

  it("extracts project name from session header cwd", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions", "proj");
    mkdirSync(sessions, { recursive: true });
    const sessionHeader = JSON.stringify({
      type: "session",
      version: 3,
      id: "test-session",
      timestamp: "2026-05-30T10:00:00Z",
      cwd: "/Users/dev/career-ops",
    });
    const message = JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "2026-05-30T11:00:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "MiniMax-M2.7",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.5 },
      },
    });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${sessionHeader}\n${message}\n`,
      "utf8",
    );
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
      now: () => Date.parse("2026-05-30T12:00:00Z"),
    });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].project).toBe("career-ops");
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to undefined project when no session header", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const message = JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "2026-05-30T11:00:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "m",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
      },
    });
    writeFileSync(join(sessions, "s.jsonl"), `${message}\n`, "utf8");
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
    });
    expect(result.turns[0].project).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts project name from cwd with trailing slash", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const sessionHeader = JSON.stringify({
      type: "session",
      cwd: "/Users/dev/career-ops/",
    });
    const message = JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "2026-05-30T11:00:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "m",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
      },
    });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${sessionHeader}\n${message}\n`,
      "utf8",
    );
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
    });
    expect(result.turns[0].project).toBe("career-ops");
    rmSync(root, { recursive: true, force: true });
  });

  it("tags turns with the active skill from user messages", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const skillMessage = JSON.stringify({
      type: "message",
      id: "u1",
      timestamp: "2026-05-30T10:00:00Z",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: '<skill name="career-ops" location="/path/to/SKILL.md">\nSkill content\n</skill>\nDo the thing',
          },
        ],
      },
    });
    const assistantTurn = JSON.stringify({
      type: "message",
      id: "a1",
      timestamp: "2026-05-30T10:01:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "m",
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
      },
    });
    const secondSkill = JSON.stringify({
      type: "message",
      id: "u2",
      timestamp: "2026-05-30T10:02:00Z",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: '<skill name="writing-plans" location="/p">\ncontent\n</skill>',
          },
        ],
      },
    });
    const assistantTurn2 = JSON.stringify({
      type: "message",
      id: "a2",
      timestamp: "2026-05-30T10:03:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "m",
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 2.0 },
      },
    });
    writeFileSync(
      join(sessions, "s.jsonl"),
      [skillMessage, assistantTurn, secondSkill, assistantTurn2].join("\n") +
        "\n",
      "utf8",
    );
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
      now: () => Date.parse("2026-05-30T12:00:00Z"),
    });
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].activeSkill).toBe("career-ops");
    expect(result.turns[1].activeSkill).toBe("writing-plans");
    rmSync(root, { recursive: true, force: true });
  });

  it("extracts MCP server names from tool call prefixes", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const message = JSON.stringify({
      type: "message",
      id: "a1",
      timestamp: "2026-05-30T10:00:00Z",
      message: {
        role: "assistant",
        provider: "minimax",
        model: "m",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "playwright_browser_click",
            arguments: {},
          },
          { type: "toolCall", id: "c2", name: "read", arguments: {} },
          { type: "toolCall", id: "c3", name: "tavily", arguments: {} },
        ],
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
      },
    });
    writeFileSync(join(sessions, "s.jsonl"), `${message}\n`, "utf8");
    const result = await scanOfflineUsage({
      ...createDefaultDeps(),
      agentDir: () => root,
      now: () => Date.parse("2026-05-30T12:00:00Z"),
    });
    expect(result.turns).toHaveLength(1);
    // "read" is built-in so excluded; "playwright" from prefix; "tavily" is single-word non-built-in
    expect(result.turns[0].mcpTools).toEqual(
      expect.arrayContaining(["playwright", "tavily"]),
    );
    expect(result.turns[0].mcpTools).not.toContain("read");
    rmSync(root, { recursive: true, force: true });
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

  it("produces project breakdown insights", () => {
    const turns = [
      {
        id: "1",
        sessionId: "s1",
        timestamp: 1,
        provider: "p",
        model: "m",
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 20,
        cost: 9,
        project: "career-ops",
      },
      {
        id: "2",
        sessionId: "s2",
        timestamp: 2,
        provider: "p",
        model: "m",
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 20,
        cost: 1,
        project: "dotfiles",
      },
    ];
    const insights = buildInsights(turns);
    const projectInsights = insights.filter((i) => i.category === "project");
    expect(projectInsights.length).toBeGreaterThanOrEqual(2);
    expect(projectInsights[0].label).toBe("career-ops");
    expect(projectInsights[0].detail).toContain("90.0%");
    expect(projectInsights[1].label).toBe("dotfiles");
  });

  it("omits project insights when no projects are set", () => {
    const turns = [
      {
        id: "1",
        sessionId: "s1",
        timestamp: 1,
        provider: "p",
        model: "m",
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 20,
        cost: 1,
      },
    ];
    const insights = buildInsights(turns);
    const projectInsights = insights.filter((i) => i.category === "project");
    expect(projectInsights).toHaveLength(0);
  });

  it("caps project insights at 5 with overflow summary", () => {
    const turns = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      sessionId: `s${i}`,
      timestamp: i,
      provider: "p",
      model: "m",
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 2,
      cost: 7 - i,
      project: `proj-${String.fromCharCode(97 + i)}`,
    }));
    const insights = buildInsights(turns);
    const projectInsights = insights.filter((i) => i.category === "project");
    expect(projectInsights).toHaveLength(6);
    expect(projectInsights[0].label).toBe("proj-a");
    expect(projectInsights[4].label).toBe("proj-e");
    expect(projectInsights[5].label).toBe("+2 more");
    expect(projectInsights[5].cost).toBe(3);
    expect(projectInsights[5].detail).toContain("10.7%");
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
