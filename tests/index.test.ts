import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
} from "../src/events.ts";
import { createDefaultDeps } from "../src/deps.ts";
import { createUsageExtension } from "../src/index.ts";
import { createProviderRegistry } from "../src/providers.ts";

type CommandContext = { hasUI: boolean; ui?: ReturnType<typeof createUiMock> };

type PiMock = {
  emitted: Array<{ name: string; payload: unknown }>;
  events: {
    emit: ReturnType<typeof vi.fn<(name: string, payload: unknown) => void>>;
    on: (name: string, handler: (...args: unknown[]) => void) => () => void;
  };
  registerCommandCalls: string[];
  registerCommand: (
    name: string,
    options: { handler: (args: string, ctx: CommandContext) => Promise<void> },
  ) => void;
  on: (name: string, handler: (...args: unknown[]) => void) => void;
  runCommand: (
    name: string,
    args: string,
    ctx: CommandContext,
  ) => Promise<void>;
  trigger: (name: string, ...args: unknown[]) => void;
};

function createPiMock(): PiMock {
  const commands = new Map<
    string,
    { handler: (args: string, ctx: CommandContext) => Promise<void> }
  >();
  const events = new Map<string, Array<(...args: unknown[]) => void>>();
  const busEvents = new Map<string, Array<(...args: unknown[]) => void>>();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const emit = vi.fn<(name: string, payload: unknown) => void>((name, payload) => {
    emitted.push({ name, payload });
    for (const handler of busEvents.get(name) ?? []) {
      handler(payload);
    }
  });
  const registerCommandCalls: string[] = [];

  return {
    emitted,
    events: {
      emit,
      on: (name, handler) => {
        const list = busEvents.get(name) ?? [];
        list.push(handler);
        busEvents.set(name, list);
        return () => {
          const current = busEvents.get(name) ?? [];
          busEvents.set(
            name,
            current.filter((entry) => entry !== handler),
          );
        };
      },
    },
    registerCommandCalls,
    registerCommand: (name, options) => {
      registerCommandCalls.push(name);
      commands.set(name, options);
    },
    on: (name, handler) => {
      const list = events.get(name) ?? [];
      list.push(handler);
      events.set(name, list);
    },
    runCommand: async (name, args, ctx) => {
      const command = commands.get(name);
      if (!command) {
        throw new Error(`missing command ${name}`);
      }
      await command.handler(args, ctx);
    },
    trigger: (name, ...args) => {
      for (const handler of events.get(name) ?? []) {
        handler(...(args.length > 0 ? args : [{}, {}]));
      }
    },
  };
}

function createUiMock() {
  const notify = vi.fn();
  const requestRender = vi.fn();
  let component:
    | {
        render: (width: number) => string[];
        handleInput?: (data: string) => void;
      }
    | undefined;
  const custom = vi.fn(async (factory: (...args: unknown[]) => unknown) => {
    component = factory(
      { terminal: { columns: 80 }, requestRender },
      {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
      {},
      () => undefined,
    ) as typeof component;
  });
  return {
    notify,
    custom,
    requestRender,
    render: (width = 80) => component?.render(width) ?? [],
    handleInput: (data: string) => component?.handleInput?.(data),
  };
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForEvent(pi: PiMock, name: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (pi.emitted.some((event) => event.name === name)) return;
    await waitForMicrotasks();
  }
  throw new Error(`timed out waiting for ${name}`);
}

async function waitForCondition(
  predicate: () => boolean,
  tries = 50,
): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await waitForMicrotasks();
  }
}

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-extension-"));
}

describe("package config", () => {
  it("points pi.extensions to src/index.ts", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi: { extensions: string[] };
    };
    expect(pkg.pi.extensions).toEqual(["./src/index.ts"]);
  });

  it("exports root, events, and types modules", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports).toEqual({
      ".": "./src/index.ts",
      "./events": "./src/events.ts",
      "./types": "./src/types.ts",
    });
  });
});

describe("usage extension", () => {
  it("registers /usage and /usage:refresh", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    expect(pi.registerCommandCalls).toEqual(["usage", "usage:refresh"]);
  });

  it("duplicate real-mode init is ignored", () => {
    delete globalThis.__piUsage;
    const pi1 = createPiMock();
    const pi2 = createPiMock();
    createUsageExtension()(pi1 as never);
    createUsageExtension()(pi2 as never);
    expect(globalThis.__piUsage).toBeDefined();
    expect(pi2.registerCommandCalls).toEqual([]);
    expect(pi2.events.emit).not.toHaveBeenCalled();
  });

  it("injected mode bypasses global guard", () => {
    globalThis.__piUsage = { initialized: true };
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    expect(pi.registerCommandCalls).toEqual(["usage", "usage:refresh"]);
  });

  it("session_shutdown clears guard", () => {
    delete globalThis.__piUsage;
    const pi = createPiMock();
    createUsageExtension()(pi as never);
    expect(globalThis.__piUsage).toBeDefined();
    pi.trigger("session_shutdown");
    expect(globalThis.__piUsage).toBeUndefined();
  });

  it("/usage without UI is no-op", async () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    await pi.runCommand("usage", "", { hasUI: false });
  });

  it("/usage:refresh without UI is no-op", async () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    await pi.runCommand("usage:refresh", "", { hasUI: false });
  });

  it("/usage:refresh marks diagnostic and updates state", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        fetch: vi.fn(async () => {
          throw new Error("network unavailable");
        }) as never,
      },
    })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    await pi.runCommand("usage:refresh", "", { hasUI: true, ui });
    expect(ui.custom).toHaveBeenCalled();
    // The dashboard defaults to the All Time period per the Phase 4 spec.
    expect(ui.render().join("\n")).toContain("[All Time]");

    const updateCalls = pi.events.emit.mock.calls.filter(
      (call) => call[0] === USAGE_CORE_UPDATE_CURRENT_EVENT,
    );
    expect(updateCalls.length).toBeGreaterThan(0);

    const hasRefreshPayload = updateCalls.some((call) => {
      const payload = call[1] as {
        state: { refreshRequested: boolean; diagnostics: string[] };
      };
      return (
        payload.state.refreshRequested &&
        payload.state.diagnostics.includes("refresh requested")
      );
    });

    expect(hasRefreshPayload).toBe(true);
  });

  it("/usage opens the dashboard without marking refresh state", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    const updatesBefore = pi.events.emit.mock.calls.filter(
      (call) => call[0] === USAGE_CORE_UPDATE_CURRENT_EVENT,
    ).length;

    await pi.runCommand("usage", "", { hasUI: true, ui });
    expect(ui.custom).toHaveBeenCalled();

    const updatePayloads = pi.events.emit.mock.calls
      .filter((call) => call[0] === USAGE_CORE_UPDATE_CURRENT_EVENT)
      .slice(updatesBefore)
      .map(
        (call) =>
          (
            call[1] as {
              state: { refreshRequested: boolean; diagnostics: string[] };
            }
          ).state,
      );
    expect(
      updatePayloads.every(
        (state) =>
          state.refreshRequested === false &&
          !state.diagnostics.includes("refresh requested"),
      ),
    ).toBe(true);
  });

  it("/usage rejects non-empty args and does not open the dashboard", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    await pi.runCommand("usage", "--wat", { hasUI: true, ui });
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("/usage:refresh"),
      "warning",
    );
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("/usage:refresh rejects non-empty args and does not open the dashboard", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    await pi.runCommand("usage:refresh", "--wat", { hasUI: true, ui });
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("does not take any arguments"),
      "warning",
    );
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("/usage without UI has no side effects", async () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    const before = pi.events.emit.mock.calls.length;
    await pi.runCommand("usage", "--wat", { hasUI: false });
    const after = pi.events.emit.mock.calls.length;

    expect(after).toBe(before);
  });

  it("/usage:refresh without UI has no side effects", async () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    const before = pi.events.emit.mock.calls.length;
    await pi.runCommand("usage:refresh", "--wat", { hasUI: false });
    const after = pi.events.emit.mock.calls.length;

    expect(after).toBe(before);
  });

  it("/usage renders without files, credentials, or network", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    const forbidden = vi.fn(async () => {
      throw new Error("unexpected dependency access");
    });

    createUsageExtension({
      deps: {
        fetch: forbidden as never,
        writeFile: forbidden as never,
        mkdir: forbidden as never,
        rename: forbidden as never,
        agentDir: (() => "/definitely/missing") as never,
        now: () => 1,
      },
    })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    await pi.runCommand("usage", "", { hasUI: true, ui });

    expect(ui.render()).toEqual(
      expect.arrayContaining([
        "Usage Statistics",
        "No local session usage found.",
        "Current Usage",
        "OpenAI/Codex • unavailable • 0s old",
        "No live usage details.",
        "* OpenAI/Codex: Live cache is unavailable.",
      ]),
    );
    expect(forbidden).toHaveBeenCalled();
  });

  it("/usage shows provider placeholders before session_start", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        agentDir: (() => "/definitely/missing") as never,
      },
    })(pi as never);

    await pi.runCommand("usage", "", { hasUI: true, ui });

    const rendered = ui.render().join("\n");
    expect(rendered).toContain("Current Usage");
    expect(rendered).toContain(
      "[OpenAI/Codex]    OpenRouter    MiniMax    OpenCode Go    Command Code",
    );
    expect(rendered).toContain("OpenAI/Codex • unavailable • 0s old");
    expect(rendered).toContain("No live usage details.");
    expect(rendered).toContain("* OpenAI/Codex: Live cache is unavailable.");
    expect(rendered).toContain("* MiniMax: Live cache is unavailable.");
  });

  it("placeholder providers cover all planned providers and are unavailable", async () => {
    const deps = {
      ...createDefaultDeps(),
      now: () => 1,
      agentDir: () => "/definitely/missing",
      fetch: (async () => {
        throw new Error("no network");
      }) as never,
    };

    const providers = createProviderRegistry(deps);
    expect(providers.map((provider) => provider.label)).toEqual([
      "Offline",
      "OpenAI/Codex",
      "OpenRouter",
      "MiniMax",
      "OpenCode Go",
      "Command Code",
    ]);

    const snapshots = await Promise.all(
      providers.map(async (provider) => (await provider.fetch()).snapshot),
    );
    expect(snapshots.every((snapshot) => snapshot.available === false)).toBe(
      true,
    );
    const minimax = snapshots.find(
      (snapshot) => snapshot.providerId === "minimax",
    );
    expect(minimax?.diagnostic).toContain("Live cache is unavailable");
    const opencode = snapshots.find((s) => s.providerId === "opencode-go");
    expect(opencode?.diagnostic.length).toBeGreaterThan(0);
    expect(
      snapshots
        .filter((snapshot) => snapshot.providerId === "command-code")
        .every((snapshot) => snapshot.diagnostic.length > 0),
    ).toBe(true);
  });

  it("replies synchronously with current state before session_start", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    let reply: unknown;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: (payload: unknown) => {
        reply = payload;
      },
    });

    expect(reply).toEqual(
      expect.objectContaining({
        state: expect.objectContaining({ generatedAt: 0, providers: [] }),
      }),
    );
  });

  it("replies with latest state and clones request payloads", async () => {
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        agentDir: (() => "/definitely/missing") as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    let first: { state: { diagnostics: string[]; generatedAt: number } } | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: (payload: {
        state: { diagnostics: string[]; generatedAt: number };
      }) => {
        first = payload;
      },
    });
    first?.state.diagnostics.push("tampered");

    let second: { state: { diagnostics: string[]; generatedAt: number } } | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: (payload: {
        state: { diagnostics: string[]; generatedAt: number };
      }) => {
        second = payload;
      },
    });

    expect(first?.state.diagnostics).toContain("tampered");
    expect(second?.state.diagnostics).not.toContain("tampered");
    expect(second?.state.generatedAt).toBe(1);
  });

  it("ignores malformed usage-core requests", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    expect(() => {
      pi.events.emit(USAGE_CORE_REQUEST_EVENT, undefined);
      pi.events.emit(USAGE_CORE_REQUEST_EVENT, { type: "current" });
      pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
        type: "unsupported",
        reply: () => undefined,
      });
    }).not.toThrow();
  });

  it("unsubscribes request handler on session_shutdown", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    pi.trigger("session_shutdown");

    const reply = vi.fn();
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, { type: "current", reply });
    expect(reply).not.toHaveBeenCalled();
  });

  it("keeps ready and update event payloads compatible for bus listeners", async () => {
    const pi = createPiMock();
    const ready = vi.fn();
    const update = vi.fn();
    pi.events.on(USAGE_CORE_READY_EVENT, ready);
    pi.events.on(USAGE_CORE_UPDATE_CURRENT_EVENT, update);
    createUsageExtension({
      deps: {
        now: () => 1,
        agentDir: (() => "/definitely/missing") as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    expect(ready).toHaveBeenCalledWith({ state: expect.any(Object) });
    expect(update).toHaveBeenCalledWith({ state: expect.any(Object) });
    pi.trigger("session_shutdown");
  });

  it("emits state payload entries", async () => {
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        agentDir: (() => "/definitely/missing") as never,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                rate_limit: {
                  primary_window: {
                    used_percent: 1,
                    limit_window_seconds: 5 * 3600,
                  },
                },
              }),
              { status: 200 },
            ),
        ) as never,
      },
    })(pi as never);
    pi.trigger("session_start");
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);
    expect(pi.events.emit).toHaveBeenCalledWith(
      USAGE_CORE_READY_EVENT,
      expect.objectContaining({ state: expect.any(Object) }),
    );
  });

  it("uses positive local Command Code rows when web usage is unavailable", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const row = (id: string, provider: string, cost: number) =>
      JSON.stringify({
        type: "message",
        id,
        timestamp: "2026-05-30T11:00:00Z",
        message: {
          role: "assistant",
          provider,
          model: "test",
          usage: { cost: { total: cost } },
        },
      });
    writeFileSync(
      join(sessions, "command-code.jsonl"),
      [
        row("current", "command-code", 1.25),
        row("legacy", "commandcode", 0.75),
        row("negative", "command-code", -10),
      ].join("\n"),
      "utf8",
    );
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-31T00:00:00Z"),
        env: {},
        fetch: vi.fn(async () => {
          throw new Error("network unavailable");
        }) as never,
      },
    })(pi as never);

    pi.trigger("session_start");
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);
    const ready = pi.emitted.find((event) => event.name === USAGE_CORE_READY_EVENT);
    const state = (
      ready?.payload as {
        state: {
          providers: Array<{
            providerId: string;
            status: string;
            sourceKind: string;
            balances: Array<{ label: string; remaining: number | null }>;
          }>;
        };
      }
    ).state;
    const commandCode = state.providers.find(
      (provider) => provider.providerId === "command-code",
    );
    expect(commandCode?.status).toBe("local");
    expect(commandCode?.sourceKind).toBe("local");
    expect(commandCode?.balances).toContainEqual({
      label: "Local Pi session total",
      remaining: 2,
      unit: "USD",
    });
    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });

  it("emits compatibility fields that clear existing powerbar consumers", async () => {
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        agentDir: (() => "/definitely/missing") as never,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                rate_limit: {
                  primary_window: {
                    used_percent: 1,
                    limit_window_seconds: 5 * 3600,
                  },
                },
              }),
              { status: 200 },
            ),
        ) as never,
      },
    })(pi as never);
    pi.trigger("session_start");
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    const ready = pi.emitted.find((event) => event.name === USAGE_CORE_READY_EVENT);
    const state = (
      ready?.payload as { state: { provider?: string; usage?: unknown } }
    ).state;

    expect(state.provider).toBeUndefined();
    expect(state.usage).toBeUndefined();
  });

  it("populates compatibility fields for MiniMax token plan windows", async () => {
    const root = mkTmp();
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        now: () => 1,
        env: { ...createDefaultDeps().env, MINIMAX_API_KEY: "token" },
        agentDir: (() => root) as never,
        fetch: vi.fn(
          async (url) =>
            url.toString().includes("token_plan")
              ? new Response(
                  JSON.stringify({
                    five_hour: { usage_percent: 12 },
                    weekly: { usage_percent: 34 },
                  }),
                  { status: 200 },
                )
              : new Response(JSON.stringify({}), { status: 500 }),
        ) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "minimax", id: "m2" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    pi.trigger(
      "model_select",
      { model: { provider: "minimax", id: "m2" } },
      { model: { provider: "minimax", id: "m2" } },
    );
    await waitForCondition(() =>
      pi.emitted.some((event) => {
        if (event.name !== USAGE_CORE_UPDATE_CURRENT_EVENT) return false;
        const payload = event.payload as {
          state: {
            compatibility: { currentLiveProviderId: string | null };
          };
        };
        return payload.state.compatibility.currentLiveProviderId === "minimax";
      }),
    );

    const update = [...pi.emitted]
      .reverse()
      .find((event) => event.name === USAGE_CORE_UPDATE_CURRENT_EVENT);
    const state = (
      update?.payload as {
        state: {
          provider?: string;
          usage?: { provider: string; windows: Array<{ label: string; usedPercent: number }> };
          compatibility: { currentLiveProviderId: string | null };
        };
      }
    ).state;

    expect(state.compatibility.currentLiveProviderId).toBe("minimax");
    expect(state.provider).toBe("MiniMax");
    expect(state.usage?.provider).toBe("minimax");
    expect(state.usage?.windows).toEqual([
      { label: "5h", usedPercent: 12 },
      { label: "Weekly", usedPercent: 34 },
    ]);
    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });

  it("turn events update context without live fetches", async () => {
    const root = mkTmp();
    const pi = createPiMock();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 1,
                limit_window_seconds: 5 * 3600,
              },
            },
          }),
          { status: 200 },
        ),
    );
    createUsageExtension({
      deps: {
        agentDir: (() => root) as never,
        fetch: fetchMock as never,
      },
    })(pi as never);
    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);
    const before = fetchMock.mock.calls.length;

    const context = { model: { provider: "openai-codex", id: "gpt-5-codex" } };
    pi.trigger("turn_start", {}, context);
    pi.trigger("turn_end", {}, context);

    expect(fetchMock).toHaveBeenCalledTimes(before);
    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });

  it("model_select keeps current model label when only ctx.model is populated", async () => {
    const root = mkTmp();
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: (() => root) as never,
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                rate_limit: {
                  primary_window: {
                    used_percent: 1,
                    limit_window_seconds: 5 * 3600,
                  },
                },
              }),
              { status: 200 },
            ),
        ) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    pi.trigger(
      "model_select",
      { model: undefined },
      { model: { provider: "openai-codex", id: "gpt-5-codex" } },
    );

    await waitForCondition(() =>
      pi.emitted.some((event) => {
        if (event.name !== USAGE_CORE_UPDATE_CURRENT_EVENT) return false;
        const payload = event.payload as {
          state: { currentModelLabel?: string };
        };
        return payload.state.currentModelLabel === "gpt-5-codex";
      }),
    );

    const lastUpdate = [...pi.emitted]
      .reverse()
      .find((event) => event.name === USAGE_CORE_UPDATE_CURRENT_EVENT);
    const state = (
      lastUpdate?.payload as {
        state: {
          currentProviderId: string | null;
          currentModelLabel?: string;
        };
      }
    ).state;

    expect(state.currentProviderId).toBe("openai-codex");
    expect(state.currentModelLabel).toBe("gpt-5-codex");
    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });

  it("ignores provider lock-file watch events", async () => {
    const root = mkTmp();
    const pi = createPiMock();
    let onCacheChange: ((filename?: string) => void) | undefined;
    const fetchMock = vi.fn(async () => {
      throw new Error("socket unavailable");
    });
    createUsageExtension({
      deps: {
        agentDir: (() => root) as never,
        fetch: fetchMock,
        watch: (_path, onChange) => {
          onCacheChange = onChange;
          return { close: () => undefined };
        },
      },
    })(pi as never);
    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);
    await waitForMicrotasks();
    const before = fetchMock.mock.calls.length;

    onCacheChange?.("openai-codex.lock");
    await waitForMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(before);
    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });

  it("refreshes only for live-provider snapshot files", async () => {
    const root = mkTmp();
    const pi = createPiMock();
    let onCacheChange: ((filename?: string) => void) | undefined;
    createUsageExtension({
      deps: {
        agentDir: (() => root) as never,
        fetch: vi.fn(async () => {
          throw new Error("socket unavailable");
        }) as never,
        watch: (_path, onChange) => {
          onCacheChange = onChange;
          return { close: () => undefined };
        },
      },
    })(pi as never);
    pi.trigger("session_start", {}, { model: undefined });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);
    await waitForMicrotasks();
    const updateEventCount = () =>
      pi.events.emit.mock.calls.filter(
        (call) => call[0] === USAGE_CORE_UPDATE_CURRENT_EVENT,
      ).length;
    const before = updateEventCount();

    onCacheChange?.("offline.json");
    await waitForMicrotasks();
    expect(updateEventCount()).toBe(before);

    onCacheChange?.("command-code.json");
    await waitForCondition(() => updateEventCount() > before);
    expect(updateEventCount()).toBeGreaterThan(before);

    pi.trigger("session_shutdown");
    rmSync(root, { recursive: true, force: true });
  });
});
