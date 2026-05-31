import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultDeps,
  type ReadonlySqliteDb,
  type UsageDeps,
} from "../src/deps.ts";
import {
  buildOpenCodeGoSnapshot,
  filterCookieHeader,
  normalizeWorkspaceId,
} from "../src/providers/opencode-go.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-opencode-"));
}

function row(timestamp: string, cost: number, id = "pi-row"): string {
  return JSON.stringify({
    type: "message",
    id,
    timestamp,
    message: {
      role: "assistant",
      provider: "opencode-go",
      model: "glm",
      usage: { cost: { total: cost } },
    },
  });
}

function depsFor(root: string, overrides?: Partial<UsageDeps>): UsageDeps {
  return {
    ...createDefaultDeps(),
    agentDir: () => root,
    homeDir: () => root,
    env: {},
    now: () => Date.parse("2026-05-30T12:00:00Z"),
    ...overrides,
  };
}

describe("OpenCode Go source", () => {
  it("normalizes dashboard configuration and filters unrelated cookies", () => {
    expect(normalizeWorkspaceId("wrk_abc123")).toBe("wrk_abc123");
    expect(
      normalizeWorkspaceId("https://opencode.ai/workspace/wrk_abc123/go"),
    ).toBe("wrk_abc123");
    expect(
      normalizeWorkspaceId("https://example.test/workspace/wrk_a/go"),
    ).toBe(undefined);
    expect(normalizeWorkspaceId("http://opencode.ai/workspace/wrk_a/go")).toBe(
      undefined,
    );
    expect(filterCookieHeader("x=1; auth=a=b; __Host-auth=h; y=2")).toBe(
      "auth=a=b; __Host-auth=h",
    );
  });

  it("uses dashboard hydration when manually configured", async () => {
    const root = mkTmp();
    const fetch = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      expect(new Headers(init?.headers).get("cookie")).toBe("auth=secret");
      return new Response(
        `<script>{rollingUsage:{resetInSec:60,usagePercent:12.4},weeklyUsage:{usagePercent:50,resetInSec:120},monthlyUsage:{resetInSec:180,usagePercent:75}}</script>`,
      );
    });
    const now = Date.parse("2026-05-30T12:00:00Z");
    const snapshot = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        fetch,
        env: {
          OPENCODE_GO_COOKIE_HEADER: "other=x; auth=secret",
          OPENCODE_GO_WORKSPACE_ID: "wrk_test",
        },
      }),
      now,
    );
    expect(snapshot.sourceLabel).toBe("OpenCode Go dashboard");
    expect(snapshot.windows.map((window) => window.usedPercent)).toEqual([
      12.4, 50, 75,
    ]);
    expect(snapshot.windows[0].resetAt).toBe(now + 60_000);
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to legacy SQLite and Pi rows without double counting parts", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "pi.jsonl"),
      `${row("2026-05-30T11:30:00Z", 3)}\n`,
    );
    let closed = false;
    const db: ReadonlySqliteDb = {
      close: () => {
        closed = true;
      },
      prepare: (sql) => ({
        get: (...params) =>
          sql.includes("sqlite_master") &&
          ["session_message", "message", "part"].includes(String(params[0]))
            ? { name: params[0] }
            : undefined,
        all: () => {
          if (sql.includes("from session_message")) return [];
          if (sql.includes("from message")) {
            return [
              {
                id: "direct",
                time_created: Date.parse("2026-05-30T10:00:00Z"),
                data: JSON.stringify({
                  role: "assistant",
                  providerID: "opencode-go",
                  cost: 2,
                }),
              },
              {
                id: "parts",
                time_created: Date.parse("2026-05-30T10:30:00Z"),
                data: JSON.stringify({
                  role: "assistant",
                  providerID: "opencode-go",
                }),
              },
            ];
          }
          if (sql.includes("from part")) {
            return [
              {
                message_id: "direct",
                data: JSON.stringify({ type: "step-finish", cost: 99 }),
              },
              {
                message_id: "parts",
                data: JSON.stringify({ type: "step-finish", cost: 1 }),
              },
            ];
          }
          return [];
        },
      }),
    };
    const dbPath = join(root, "opencode.db");
    writeFileSync(dbPath, "");
    const snapshot = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: { OPENCODE_DB: dbPath },
        openReadonlySqlite: () => db,
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(snapshot.sourceLabel).toBe("OpenCode/Pi local estimate");
    expect(snapshot.windows[0].used).toBe(6);
    expect(snapshot.diagnostics.join(" ")).toContain("not configured");
    expect(closed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("distinguishes invalid vs missing dashboard config diagnostics", async () => {
    const root = mkTmp();
    const dbPath = join(root, "opencode.db");
    writeFileSync(dbPath, "");
    const mkDb = (): ReadonlySqliteDb => ({
      close: () => undefined,
      prepare: (sql) => ({
        get: (...params) =>
          sql.includes("sqlite_master") &&
          ["session_message"].includes(String(params[0]))
            ? { name: params[0] }
            : undefined,
        all: () =>
          sql.includes("from session_message")
            ? [
                {
                  data: JSON.stringify({
                    model: { providerID: "opencode-go" },
                    cost: 1,
                    time: { created: Date.parse("2026-05-30T11:30:00Z") },
                  }),
                  time_created: Date.parse("2026-05-30T11:30:00Z"),
                },
              ]
            : [],
      }),
    });

    const invalid = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: {
          OPENCODE_DB: dbPath,
          OPENCODE_GO_COOKIE_HEADER: "auth=secret",
          OPENCODE_GO_WORKSPACE_ID: "bad-workspace",
        },
        openReadonlySqlite: mkDb,
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(invalid.diagnostics.join(" ")).toContain("configuration is invalid");

    const missing = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: { OPENCODE_DB: dbPath },
        openReadonlySqlite: mkDb,
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(missing.diagnostics.join(" ")).toContain("is not configured");
    rmSync(root, { recursive: true, force: true });
  });

  it("reports dashboard auth failure and signed-out HTML", async () => {
    const root = mkTmp();
    const baseEnv = {
      OPENCODE_GO_COOKIE_HEADER: "auth=secret",
      OPENCODE_GO_WORKSPACE_ID: "wrk_test",
    };
    const authFailed = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: baseEnv,
        fetch: async () => new Response("", { status: 401 }),
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(authFailed.diagnostics.join(" ")).toContain("authentication failed");

    const signedOut = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: baseEnv,
        fetch: async () =>
          new Response("<html>Sign in</html>", { status: 200 }),
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(signedOut.diagnostics.join(" ")).toContain("signed out");
    rmSync(root, { recursive: true, force: true });
  });

  it("reports unsupported SQLite schema", async () => {
    const root = mkTmp();
    const dbPath = join(root, "opencode.db");
    writeFileSync(dbPath, "");
    const snapshot = await buildOpenCodeGoSnapshot(
      depsFor(root, {
        env: { OPENCODE_DB: dbPath },
        openReadonlySqlite: () => ({
          close: () => undefined,
          prepare: (sql) => ({
            get: (...params) =>
              sql.includes("sqlite_master") && params[0] === "session_message"
                ? { name: "session_message" }
                : undefined,
            all: () => [],
          }),
        }),
      }),
      Date.parse("2026-05-30T12:00:00Z"),
    );
    expect(snapshot.diagnostics.join(" ")).toContain("schema unsupported");
    rmSync(root, { recursive: true, force: true });
  });

  it("normalizes local estimate windows for 5h weekly monthly", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "pi.jsonl"),
      `${row("2026-05-28T10:00:00Z", 4, "a")}\n${row("2026-05-30T11:30:00Z", 3, "b")}\n`,
    );
    const now = Date.parse("2026-05-30T12:00:00Z");
    const snapshot = await buildOpenCodeGoSnapshot(depsFor(root), now);
    const [fiveHour, weekly, monthly] = snapshot.windows;
    expect(fiveHour.key).toBe("fiveHour");
    expect(fiveHour.label).toBe("5h");
    expect(fiveHour.used).toBe(3);
    expect(weekly.key).toBe("weekly");
    expect(weekly.label).toBe("Weekly");
    expect(weekly.used).toBe(7);
    expect(monthly.key).toBe("monthly");
    expect(monthly.label).toBe("Monthly");
    expect(monthly.used).toBe(7);
    rmSync(root, { recursive: true, force: true });
  });
});
