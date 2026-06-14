import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
} from "../src/shared/events.ts";
import { createDefaultDeps } from "../src/shared/deps.ts";
import { createUsageExtension } from "../src/index.ts";
import { createProviderRegistry } from "../src/providers/index.ts";

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
      "./events": "./src/shared/events.ts",
      "./types": "./src/shared/types.ts",
    });
  });

  it("requires Node 22.19 or newer", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      engines: { node: string };
    };
    expect(pkg.engines.node).toBe(">=22.19");
  });

  it("documents shared export entrypoints", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./events"]).toBe("./src/shared/events.ts");
    expect(pkg.exports["./types"]).toBe("./src/shared/types.ts");
  });
});

describe("usage extension", () => {
  it("registers /usage and /usage:refresh", () => {
    const pi = createPiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);
    expect(pi.registerCommandCalls).toEqual(["usage", "usage:refresh"]);
  });

  it("starts live runtime with a 30 minute polling interval", () => {
    const pi = createPiMock();
    const setInterval = vi.fn(() => ({ unref() {} } as unknown as NodeJS.Timeout));
    createUsageExtension({
      deps: {
        now: () => 1,
        setInterval,
        clearInterval: vi.fn(),
        unrefTimer: vi.fn(),
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: undefined });
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 1_800_000);
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
        agentDir: (() => "/definitely/missing") as never,
        fetch: vi.fn(async () => {
          throw new Error("network unavailable");
        }) as never,
      },
    })(pi as never);

    await pi.runCommand("usage:refresh", "", { hasUI: true, ui });
    await waitForCondition(() =>
      pi.emitted.some((event) => event.name === USAGE_CORE_UPDATE_CURRENT_EVENT),
    );
    const payload = pi.emitted.at(-1)?.payload as
      | { state?: { refreshRequested?: boolean; diagnostics?: string[] } }
      | undefined;
    expect(payload?.state?.refreshRequested).toBe(true);
    expect(payload?.state?.diagnostics).toContain("refresh requested");
  });

  it("rejects unexpected /usage args with a warning", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    await pi.runCommand("usage", "oops", { hasUI: true, ui });

    expect(ui.notify).toHaveBeenCalledWith(
      "Unknown /usage arguments. Use /usage with no args, or /usage:refresh to force a refresh.",
      "warning",
    );
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("rejects unexpected /usage:refresh args with a warning", async () => {
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({ deps: { now: () => 1 } })(pi as never);

    await pi.runCommand("usage:refresh", "oops", { hasUI: true, ui });

    expect(ui.notify).toHaveBeenCalledWith(
      "Unknown /usage:refresh arguments. /usage:refresh does not take any arguments.",
      "warning",
    );
    expect(ui.custom).not.toHaveBeenCalled();
  });

  it("bootstraps state and answers current-state requests", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-05-30T11:00:00Z",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5-codex",
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
        },
      })}\n`,
      "utf8",
    );
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "openai-codex" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    let replyState:
      | {
          currentProviderId?: string | null;
          offline?: { periods?: Array<unknown>; messageCount?: number };
        }
      | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: ({ state }: { state: typeof replyState }) => {
        replyState = state;
      },
    });

    expect(replyState?.currentProviderId).toBe("openai-codex");
    expect(replyState?.offline?.messageCount).toBe(1);
    expect(replyState?.offline?.periods?.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("respects model_select and turn events for provider detection", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "minimax" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    pi.trigger(
      "model_select",
      { model: { provider: "command-code" } },
      { model: { provider: "command-code" }, signal: undefined },
    );
    await waitForCondition(() =>
      pi.emitted.some((event) => event.name === USAGE_CORE_UPDATE_CURRENT_EVENT),
    );

    let state:
      | {
          currentProviderId?: string | null;
        }
      | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: ({ state: current }: { state: typeof state }) => {
        state = current;
      },
    });
    expect(state?.currentProviderId).toBe("command-code");

    pi.trigger("turn_start", {}, { model: { id: "gpt-5-codex" } });
    pi.trigger("turn_end", {}, { model: { provider: "stepfun" } });
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: ({ state: current }: { state: typeof state }) => {
        state = current;
      },
    });
    expect(state?.currentProviderId).toBe("stepfun");
    rmSync(root, { recursive: true, force: true });
  });

  it("watches cache updates after session start", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const providers = createProviderRegistry(
      createDefaultDeps(),
    ).filter((provider) => provider.strategy === "api");
    const watch = vi.fn(() => ({ close() {} }));
    const mkdir = vi.fn(async () => undefined);
    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as never,
        mkdir,
        watch,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "openai-codex" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    expect(mkdir).toHaveBeenCalled();
    expect(watch).toHaveBeenCalledWith(
      expect.stringContaining("cache/pi-usage/providers"),
      expect.any(Function),
    );
    expect(providers.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("opens dashboard and completes offline scan in background", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(
      join(sessions, "s.jsonl"),
      `${JSON.stringify({
        type: "message",
        id: "m1",
        timestamp: "2026-05-30T11:00:00Z",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5-codex",
          usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.1 },
        },
      })}\n`,
      "utf8",
    );
    const pi = createPiMock();
    const ui = createUiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as never,
      },
    })(pi as never);

    await pi.runCommand("usage", "", { hasUI: true, ui });
    await waitForCondition(() => ui.custom.mock.calls.length > 0);

    expect(ui.custom).toHaveBeenCalledTimes(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("emits derived compatibility fields when provider has valid windows", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });

    const codexResponse = {
      rate_limit: {
        primary_window: {
          limit_window_seconds: 5 * 3600,
          used_percent: 42,
          reset_at: Date.parse("2026-05-30T17:00:00Z") / 1000,
        },
        secondary_window: {
          limit_window_seconds: 7 * 24 * 3600,
          used_percent: 15,
          reset_at: Date.parse("2026-06-06T00:00:00Z") / 1000,
        },
      },
    };

    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        env: { OPENAI_CODEX_OAUTH_TOKEN: "test-token" },
        fetch: vi.fn(async () => ({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => codexResponse,
          text: async () => JSON.stringify(codexResponse),
        })) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "openai-codex" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    let state:
      | {
          currentProviderId?: string | null;
          currentProviderSnapshot?: { providerId?: string; windows?: Array<{ key?: string }> } | null;
          provider?: string;
          usage?: { provider?: string; displayName?: string; windows?: Array<{ label?: string; usedPercent?: number }> };
          compatibility?: {
            currentLiveProviderId?: string | null;
            currentLiveProviderSnapshot?: { providerId?: string } | null;
          };
        }
      | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: ({ state: current }: { state: typeof state }) => {
        state = current;
      },
    });

    // currentProviderSnapshot is always populated when provider matches
    expect(state?.currentProviderSnapshot).not.toBeNull();
    expect(state?.currentProviderSnapshot?.providerId).toBe("openai-codex");
    expect(state?.currentProviderSnapshot?.windows?.length).toBeGreaterThan(0);

    // compatibility gate passes (has fiveHour + weekly windows)
    expect(state?.compatibility?.currentLiveProviderId).toBe("openai-codex");
    expect(state?.compatibility?.currentLiveProviderSnapshot?.providerId).toBe(
      "openai-codex",
    );

    // provider label
    expect(state?.provider).toBe("OpenAI/Codex");

    // usage compat with filtered windows (only fiveHour + weekly, mapped to RateWindow)
    expect(state?.usage?.provider).toBe("openai-codex");
    expect(state?.usage?.displayName).toBe("OpenAI/Codex");
    expect(state?.usage?.windows).toHaveLength(2);
    expect(state?.usage?.windows?.[0]?.label).toBe("5h");
    expect(state?.usage?.windows?.[0]?.usedPercent).toBe(42);
    expect(state?.usage?.windows?.[1]?.label).toBe("Week");
    expect(state?.usage?.windows?.[1]?.usedPercent).toBe(15);

    rmSync(root, { recursive: true, force: true });
  });

  it("emits null compatibility when provider has no valid compat windows", async () => {
    const root = mkTmp();
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });

    const pi = createPiMock();
    createUsageExtension({
      deps: {
        agentDir: () => root,
        now: () => Date.parse("2026-05-30T12:00:00Z"),
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }) as never,
      },
    })(pi as never);

    pi.trigger("session_start", {}, { model: { provider: "openai-codex" } });
    await waitForEvent(pi, USAGE_CORE_READY_EVENT);

    let state:
      | {
          currentProviderId?: string | null;
          currentProviderSnapshot?: unknown;
          provider?: string;
          usage?: unknown;
          compatibility?: {
            currentLiveProviderId?: string | null;
            currentLiveProviderSnapshot?: unknown;
          };
        }
      | undefined;
    pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
      type: "current",
      reply: ({ state: current }: { state: typeof state }) => {
        state = current;
      },
    });

    expect(state?.currentProviderId).toBe("openai-codex");
    // Provider lookup still works but returns unavailable snapshot
    // compatibility gate fails (no valid fiveHour/weekly windows)
    expect(state?.compatibility?.currentLiveProviderId).toBeNull();
    expect(state?.compatibility?.currentLiveProviderSnapshot).toBeNull();
    expect(state?.provider).toBeUndefined();
    expect(state?.usage).toBeUndefined();

    rmSync(root, { recursive: true, force: true });
  });
});
