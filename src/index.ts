import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { createDefaultDeps, type UsageDeps } from "./deps.ts";
import { createProviderRegistry } from "./providers.ts";
import type { UsageCoreState } from "./types.ts";

const GLOBAL_KEY = "__piUsage" as const;
const READY_EVENT = "usage-core:ready";
const UPDATE_CURRENT_EVENT = "usage-core:update-current";

type GlobalUsageState = { initialized: true };

declare global {
  // eslint-disable-next-line no-var
  var __piUsage: GlobalUsageState | undefined;
}

export interface UsageExtensionOptions {
  deps?: Partial<UsageDeps>;
}

function mergeDeps(overrides?: Partial<UsageDeps>): UsageDeps {
  return { ...createDefaultDeps(), ...overrides };
}

function createInitialState(): UsageCoreState {
  return {
    refreshRequested: false,
    generatedAt: 0,
    offline: {
      providerId: "offline",
      totals: [],
    },
    currentProviderId: null,
    currentProviderSnapshot: null,
    providers: [],
    diagnostics: [],
    compatibility: {
      currentLiveProviderId: null,
      currentLiveProviderSnapshot: null,
    },
  };
}

function parseUsageArgs(
  args: string,
): { ok: true; refresh: boolean } | { ok: false; unknown: string[] } {
  const parts = args
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = parts.filter((part) => part !== "--refresh");
  if (unknown.length > 0) {
    return { ok: false, unknown };
  }
  return { ok: true, refresh: parts.includes("--refresh") };
}

function widthSafe(line: string, width: number): string {
  if (width <= 0 || line.length <= width) {
    return line;
  }
  if (width <= 1) {
    return "…";
  }
  return `${line.slice(0, width - 1)}…`;
}

function cloneState(state: UsageCoreState): UsageCoreState {
  return {
    ...state,
    offline: { ...state.offline, totals: [...state.offline.totals] },
    providers: state.providers.map((provider) => ({
      ...provider,
      balances: [...provider.balances],
    })),
    diagnostics: [...state.diagnostics],
    ...(state.usage
      ? { usage: { ...state.usage, windows: [...state.usage.windows] } }
      : {}),
    compatibility: { ...state.compatibility },
  };
}

class UsageDashboardComponent implements Component {
  constructor(
    private readonly state: UsageCoreState,
    private readonly done: () => void,
  ) {}

  render(width: number): string[] {
    const lines = [
      "Pi Usage Dashboard (Phase 1)",
      "",
      ...(this.state.refreshRequested ? ["diag: refresh requested", ""] : []),
      "Offline stats: empty",
      "",
      ...this.state.providers.map(
        (provider) =>
          `- ${provider.providerLabel}: unavailable (${provider.phase})`,
      ),
      "",
      "Press q or Esc to close.",
    ];

    return lines.map((line) => widthSafe(line, Math.max(8, width)));
  }

  handleInput(data: string): void {
    if (data === "q" || data === "\u001B") {
      this.done();
    }
  }

  invalidate(): void {}
}

async function openDashboard(
  ctx: ExtensionCommandContext,
  state: UsageCoreState,
): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, _theme, _keys, done) => new UsageDashboardComponent(state, done),
  );
}

export function createUsageExtension(options?: UsageExtensionOptions) {
  const deps = mergeDeps(options?.deps);
  const injectedMode = Boolean(options?.deps);

  return function usageExtension(pi: ExtensionAPI): void {
    if (!injectedMode && globalThis[GLOBAL_KEY]) {
      return;
    }

    if (!injectedMode) {
      globalThis[GLOBAL_KEY] = { initialized: true };
    }

    const state = createInitialState();
    const providers = createProviderRegistry(deps);

    const emit = (name: string) => {
      pi.events.emit(name, { state: cloneState(state) });
    };

    const bootstrap = async () => {
      state.providers = (
        await Promise.all(
          providers.map(async (provider) => (await provider.fetch()).snapshot),
        )
      ).map((snapshot) => snapshot);
      state.generatedAt = deps.now();
      state.diagnostics = ["phase-1 shell ready"];
      emit(READY_EVENT);
    };

    pi.on("session_start", () => {
      void bootstrap();
    });

    pi.registerCommand("usage", {
      description: "Open the usage dashboard shell",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          return;
        }

        const parsed = parseUsageArgs(args);
        if (!parsed.ok) {
          ctx.ui.notify(
            `Unknown /usage option(s): ${parsed.unknown.join(", ")}. Supported: --refresh`,
            "warning",
          );
          return;
        }

        if (parsed.refresh) {
          state.refreshRequested = true;
          state.diagnostics = [...state.diagnostics, "refresh requested"];
          emit(UPDATE_CURRENT_EVENT);
        }

        await openDashboard(ctx, state);
      },
    });

    pi.on("session_shutdown", () => {
      delete globalThis[GLOBAL_KEY];
    });
  };
}

export default createUsageExtension();
