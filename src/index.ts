import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildInsights, scanOfflineUsage } from "./core/offline.ts";
import {
  projectState,
  type InternalState,
} from "./core/state-projections.ts";
import { createProviderRegistry, providerCacheDir } from "./providers/index.ts";
import { createDefaultDeps, type UsageDeps } from "./shared/deps.ts";
import {
  USAGE_CORE_READY_EVENT,
  USAGE_CORE_REQUEST_EVENT,
  USAGE_CORE_UPDATE_CURRENT_EVENT,
  type UsageCoreCurrentRequest,
  type UsageCorePayload,
} from "./shared/events.ts";
import { detectProviderFromModel } from "./shared/provider-detection.ts";
import { buildPeriods } from "./tui/dashboard-model.ts";
import { openDashboard } from "./tui/dashboard.ts";

export { detectProviderFromModel } from "./shared/provider-detection.ts";

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

function createInitialState(): InternalState {
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
    providers: [],
    diagnostics: [],
  };
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
      const payload: UsageCorePayload = {
        state: structuredClone(projectState(state)),
      };
      pi.events.emit(name, payload);
    };

    let providerRefresh: Promise<void> | null = null;
    let providerForcePending = false;
    let periodicRefresh: NodeJS.Timeout | undefined;
    let cacheWatcher: { close: () => void } | undefined;
    let localCommandCodeCost = 0;

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

      state.generatedAt = deps.now();
      state.loading = false;
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
        payload.reply({ state: structuredClone(projectState(state)) });
      },
    );

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
        await openDashboard(ctx, projectState(state), cancelScan);
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
        await openDashboard(ctx, projectState(state), cancelScan);
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
