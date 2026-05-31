import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps } from "../src/deps.ts";
import { createUsageExtension } from "../src/index.ts";
import { createProviderRegistry } from "../src/providers.ts";

type CommandContext = { hasUI: boolean; ui?: ReturnType<typeof createUiMock> };

type PiMock = {
  emitted: Array<{ name: string; payload: unknown }>;
  events: {
    emit: ReturnType<typeof vi.fn>;
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
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const emit = vi.fn((name: string, payload: unknown) => {
    emitted.push({ name, payload });
  });
  const registerCommandCalls: string[] = [];

  return {
    emitted,
    events: { emit },
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
  let component:
    | {
        render: (width: number) => string[];
        handleInput?: (data: string) => void;
      }
    | undefined;
  const custom = vi.fn(async (factory: (...args: unknown[]) => unknown) => {
    component = factory(
      { terminal: { columns: 80 } },
      {},
      {},
      () => undefined,
    ) as typeof component;
  });
  return {
    notify,
    custom,
    render: (width = 80) => component?.render(width) ?? [],
    handleInput: (data: string) => component?.handleInput?.(data),
  };
}

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForEvent(pi: PiMock, name: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (pi.emitted.some((event) => event.name === name)) return;
    await waitForMicrotasks();
  }
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
});

describe("usage extension", () => {
  it("registers /usage", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    expect(pi.registerCommandCalls).toEqual(["usage"]);
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
    expect(pi.registerCommandCalls).toEqual(["usage"]);
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

  it("/usage --refresh marks diagnostic", async () => {
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

    await pi.runCommand("usage", "--refresh", { hasUI: true, ui });
    expect(ui.custom).toHaveBeenCalled();
    expect(ui.render().join("\n")).toContain("Periods:");

    const updateCalls = pi.events.emit.mock.calls.filter(
      (call) => call[0] === "usage-core:update-current",
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

  it("unknown args warn and stop", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    await pi.runCommand("usage", "--wat", { hasUI: true, ui });
    expect(ui.notify).toHaveBeenCalled();
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("/usage without UI has no side effects", async () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    pi.trigger("session_start");
    await waitForMicrotasks();

    const before = pi.events.emit.mock.calls.length;
    await pi.runCommand("usage", "--refresh", { hasUI: false });
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
        "Pi Usage Dashboard",
        "No local session usage found.",
        "- OpenAI/Codex: unavailable (Unavailable) • Live cache is unavailable.",
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
    expect(rendered).toContain(
      "- OpenAI/Codex: unavailable (Unavailable) • Live cache is unavailable.",
    );
    expect(rendered).toContain(
      "- MiniMax: unavailable (Unavailable) • Live cache is unavailable.",
    );
    expect(rendered).toContain("- OpenCode Go: unavailable (Unavailable)");
    expect(rendered).toContain("- Command Code: unavailable (Unavailable)");
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
    await waitForEvent(pi, "usage-core:ready");
    expect(pi.events.emit).toHaveBeenCalledWith(
      "usage-core:ready",
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
    await waitForEvent(pi, "usage-core:ready");
    const ready = pi.emitted.find((event) => event.name === "usage-core:ready");
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
    await waitForEvent(pi, "usage-core:ready");

    const ready = pi.emitted.find((event) => event.name === "usage-core:ready");
    const state = (
      ready?.payload as { state: { provider?: string; usage?: unknown } }
    ).state;

    expect(state.provider).toBeUndefined();
    expect(state.usage).toBeUndefined();
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
    await waitForEvent(pi, "usage-core:ready");
    const before = fetchMock.mock.calls.length;

    const context = { model: { provider: "openai-codex", id: "gpt-5-codex" } };
    pi.trigger("turn_start", {}, context);
    pi.trigger("turn_end", {}, context);

    expect(fetchMock).toHaveBeenCalledTimes(before);
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
    await waitForEvent(pi, "usage-core:ready");
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
    await waitForEvent(pi, "usage-core:ready");
    await waitForMicrotasks();
    const updateEventCount = () =>
      pi.events.emit.mock.calls.filter(
        (call) => call[0] === "usage-core:update-current",
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
