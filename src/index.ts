import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createDefaultDeps, type UsageDeps } from "./deps.ts";
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCoreCurrentRequest,
  type UsageCorePayload,
} from "./events.ts";
import { buildInsights, scanOfflineUsage } from "./offline.ts";
import { createProviderRegistry, providerCacheDir } from "./providers.ts";
import type { UsageCoreState } from "./types.ts";
import { buildPeriods } from "./ui/dashboard-model.ts";
import { openDashboard } from "./ui/dashboard.ts";

const GLOBAL_KEY = "__piUsage" as const;

type GlobalUsageState = { initialized: true };
type ScanToken = { cancelled: boolean };

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
    loading: false,
    offline: {
      providerId: "offline",
      totals: [],
      periods: [],
      scannedFiles: 0,
      messageCount: 0,
    },
    insights: [],
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

export function detectProviderFromModel(
  model: { provider?: string; id?: string; name?: string } | undefined,
):
  | "openai-codex"
  | "minimax"
  | "stepfun"
  | "opencode-go"
  | "command-code"
  | "openrouter"
  | undefined {
  if (!model) return undefined;
  const p = (model.provider ?? "").trim().toLowerCase();
  if (p === "openai-codex") return "openai-codex";
  if (p === "minimax") return "minimax";
  if (p === "stepfun") return "stepfun";
  if (p === "opencode-go") return "opencode-go";
  if (p === "command-code" || p === "commandcode") return "command-code";
  if (p === "openrouter") return "openrouter";
  if (p) return undefined;
  const n = (model.id ?? model.name ?? "").toLowerCase();
  if (n.includes("codex")) return "openai-codex";
  if (n.includes("minimax")) return "minimax";
  if (n.includes("stepfun")) return "stepfun";
  if (n.includes("opencode-go")) return "opencode-go";
  if (n.includes("command-code") || n.includes("commandcode")) {
    return "command-code";
  }
  return undefined;
}

function cloneState(state: UsageCoreState): UsageCoreState {
  return JSON.parse(JSON.stringify(state)) as UsageCoreState;
}

function isCurrentRequest(value: unknown): value is UsageCoreCurrentRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "current" &&
    typeof (value as { reply?: unknown }).reply === "function"
  );
}

export function createUsageExtension(options?: UsageExtensionOptions) {
  const deps = mergeDeps(options?.deps);
  const injectedMode = Boolean(options?.deps);

  return function usageExtension(pi: ExtensionAPI): void {
    if (!injectedMode && globalThis[GLOBAL_KEY]) return;
    if (!injectedMode) globalThis[GLOBAL_KEY] = { initialized: true };

    const state = createInitialState();
    const providers = createProviderRegistry(deps);
    const liveProviderIds = new Set(
      providers
        .filter((provider) => provider.strategy === "api")
        .map((provider) => provider.id),
    );
    const liveProviderSnapshotFiles = new Set(
      [...liveProviderIds].map((id) => `${id}.json`),
    );

    const emit = (name: string) => {
      const payload: UsageCorePayload = { state: cloneState(state) };
      pi.events.emit(name, payload);
    };

    let providerRefresh: Promise<void> | null = null;
    let providerForcePending = false;
    let periodicRefresh: NodeJS.Timeout | undefined;
    let cacheWatcher: { close: () => void } | undefined;
    let localCommandCodeCost = 0;

    const syncCompatibility = () => {
      const current =
        state.providers.find((s) => s.providerId === state.currentProviderId) ??
        null;
      state.currentProviderSnapshot = current;
      const hasCompatibilityWindows = Boolean(
        current?.windows.some(
          (window) =>
            (window.key === "fiveHour" || window.key === "weekly") &&
            !window.unavailableReason,
        ),
      );
      state.compatibility.currentLiveProviderId =
        hasCompatibilityWindows && current ? current.providerId : null;
      state.compatibility.currentLiveProviderSnapshot = state.compatibility
        .currentLiveProviderId
        ? current
        : null;
      if (state.compatibility.currentLiveProviderId && current) {
        state.provider = current.providerLabel;
        state.usage = {
          provider: current.providerId,
          displayName: current.providerLabel,
          windows: current.windows
            .filter((w) => w.key === "fiveHour" || w.key === "weekly")
            .filter((w) => !w.unavailableReason)
            .map((w) => ({ label: w.label, usedPercent: w.usedPercent })),
        };
      } else {
        state.provider = undefined;
        state.usage = undefined;
      }
    };

    const applyCommandCodeLocalFallback = () => {
      const ccIndex = state.providers.findIndex(
        (p) => p.providerId === "command-code",
      );
      if (
        ccIndex < 0 ||
        localCommandCodeCost <= 0 ||
        state.providers[ccIndex].available
      ) {
        return;
      }
      state.providers[ccIndex] = {
        ...state.providers[ccIndex],
        available: true,
        status: "local",
        sourceKind: "local",
        sourceLabel: "Local Pi sessions",
        diagnostic: "Live unavailable; showing local Pi session history.",
        diagnostics: [
          "Snapshot reflects only local Pi session history.",
          ...state.providers[ccIndex].diagnostics,
        ],
        windows: [],
        balances: [
          {
            label: "Local Pi session total",
            remaining: localCommandCodeCost,
            unit: "USD",
          },
        ],
      };
    };

    const populateProviders = async (force = false, signal?: AbortSignal) => {
      if (providerRefresh) {
        if (force) providerForcePending = true;
        await providerRefresh;
        if (force && providerForcePending) {
          providerForcePending = false;
          await populateProviders(true, signal);
        }
        return;
      }
      const mapWithLimit = async <T, R>(
        items: T[],
        limit: number,
        fn: (item: T) => Promise<R>,
      ): Promise<R[]> => {
        const out: R[] = new Array(items.length);
        let index = 0;
        const workers = Array.from(
          { length: Math.min(limit, items.length) },
          async () => {
            while (index < items.length) {
              const i = index;
              index += 1;
              out[i] = await fn(items[i]);
            }
          },
        );
        await Promise.all(workers);
        return out;
      };

      providerRefresh = mapWithLimit(
        providers,
        3,
        async (provider) =>
          (
            await provider.fetch({
              force,
              signal,
            })
          ).snapshot,
      )
        .then((snapshots) => {
          state.providers = snapshots;
          applyCommandCodeLocalFallback();
          syncCompatibility();
        })
        .finally(() => {
          providerRefresh = null;
        });
      return providerRefresh;
    };

    const refreshOffline = async (refresh: boolean, token?: ScanToken) => {
      state.loading = true;
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
      const result = await scanOfflineUsage(deps, {
        refresh,
        shouldCancel: () => token?.cancelled === true,
      });
      if (token?.cancelled) {
        state.loading = false;
        emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
        return;
      }
      state.offline.periods = buildPeriods(result);
      state.offline.scannedFiles = result.scannedFiles;
      state.offline.messageCount = result.turns.length;
      state.insights = buildInsights(result.turns);
      localCommandCodeCost = result.turns
        .filter(
          (turn) =>
            (turn.provider === "command-code" ||
              turn.provider === "commandcode") &&
            turn.cost > 0,
        )
        .reduce((sum, turn) => sum + turn.cost, 0);

      applyCommandCodeLocalFallback();
      syncCompatibility();

      state.generatedAt = deps.now();
      state.loading = false;
      // Notify subscribers (including the open dashboard) that the offline
      // snapshot is now current. The existing event path is the single source
      // of truth for usage-core updates.
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    };

    const bootstrap = async () => {
      await Promise.all([populateProviders(false), refreshOffline(false)]);
      state.diagnostics = ["live runtime ready"];
      emit(USAGE_CORE_READY_EVENT);
    };

    const updateModelContext = (
      model:
        | {
            provider?: string;
            id?: string;
            name?: string;
          }
        | undefined,
    ) => {
      state.currentProviderId = detectProviderFromModel(model) ?? null;
      state.currentModelLabel = model?.id ?? model?.name;
      syncCompatibility();
    };

    const emitProviderUpdate = async (force = false, signal?: AbortSignal) => {
      await populateProviders(force, signal);
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    };

    const startLiveRuntime = () => {
      if (!periodicRefresh) {
        periodicRefresh = deps.setInterval(() => {
          void emitProviderUpdate(false).catch(() => undefined);
        }, 1_800_000);
        deps.unrefTimer(periodicRefresh);
      }
      if (!cacheWatcher) {
        void deps
          .mkdir(providerCacheDir(deps), { recursive: true })
          .then(() => {
            cacheWatcher = deps.watch(providerCacheDir(deps), (filename) => {
              if (!filename || !liveProviderSnapshotFiles.has(filename)) return;
              void emitProviderUpdate(false).catch(() => undefined);
            });
          })
          .catch(() => undefined);
      }
    };

    const unsubscribeRequestCurrent = pi.events.on(
      USAGE_CORE_REQUEST_EVENT,
      (payload: unknown) => {
        if (!isCurrentRequest(payload)) return;
        payload.reply({ state: cloneState(state) });
      },
    );

    // Expose the event bus on a well-known global hook so the dashboard
    // component can wire a repaint subscription when the overlay is open.
    // The hook is replaced atomically; the dashboard's `unsubscribeUpdate`
    // remains valid even if the bus is replaced while the overlay is open.
    const dashboardBus = {
      on: (event: string, handler: (...args: unknown[]) => void) =>
        pi.events.on(event, handler as (...args: unknown[]) => void),
    };
    (globalThis as { __piUsageBus?: unknown }).__piUsageBus = dashboardBus;

    pi.on("session_start", (_event, ctx) => {
      updateModelContext(ctx.model);
      startLiveRuntime();
      void bootstrap();
    });

    pi.on("model_select", (event, ctx) => {
      updateModelContext(event.model ?? ctx.model);
      if (
        state.currentProviderId &&
        liveProviderIds.has(state.currentProviderId)
      ) {
        void emitProviderUpdate(true, ctx.signal).catch(() => undefined);
      } else {
        emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
      }
    });
    pi.on("turn_start", (_event, ctx) => {
      updateModelContext(ctx.model);
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    });
    pi.on("turn_end", (_event, ctx) => {
      updateModelContext(ctx.model);
      emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
    });

    const rejectArgs = (args: string) => args.trim() !== "";

    const prepareUsageDashboard = async (refresh: boolean) => {
      if (refresh) {
        state.refreshRequested = true;
        state.diagnostics = [...state.diagnostics, "refresh requested"];
        emit(USAGE_CORE_UPDATE_CURRENT_EVENT);
      }

      await populateProviders(refresh);
      const scanToken: ScanToken = { cancelled: false };
      const shouldScan =
        refresh || (state.offline.periods.length === 0 && !state.loading);
      const scan = shouldScan ? refreshOffline(refresh, scanToken) : undefined;
      return {
        cancelScan: () => {
          scanToken.cancelled = true;
        },
        scan,
      };
    };

    pi.registerCommand("usage", {
      description: "Open the usage dashboard",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        if (rejectArgs(args)) {
          ctx.ui.notify(
            "Unknown /usage arguments. Use /usage with no args, or /usage:refresh to force a refresh.",
            "warning",
          );
          return;
        }
        const { cancelScan, scan } = await prepareUsageDashboard(false);
        await openDashboard(ctx, state, cancelScan);
        await scan;
      },
    });

    pi.registerCommand("usage:refresh", {
      description: "Refresh provider usage and open the usage dashboard",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        if (rejectArgs(args)) {
          ctx.ui.notify(
            "Unknown /usage:refresh arguments. /usage:refresh does not take any arguments.",
            "warning",
          );
          return;
        }
        const { cancelScan, scan } = await prepareUsageDashboard(true);
        await openDashboard(ctx, state, cancelScan);
        await scan;
      },
    });

    pi.on("session_shutdown", () => {
      if (periodicRefresh) deps.clearInterval(periodicRefresh);
      periodicRefresh = undefined;
      cacheWatcher?.close();
      cacheWatcher = undefined;
      unsubscribeRequestCurrent();
      delete globalThis[GLOBAL_KEY];
      delete (globalThis as { __piUsageBus?: unknown }).__piUsageBus;
    });
  };
}

export default createUsageExtension();
