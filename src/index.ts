import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { createDefaultDeps, type UsageDeps } from "./deps.ts";
import { buildInsights, scanOfflineUsage, type PeriodKey } from "./offline.ts";
import { createProviderRegistry, providerCacheDir } from "./providers.ts";
import type {
  AggregatedUsagePeriod,
  UsageCoreState,
  UsageWindow,
} from "./types.ts";

const GLOBAL_KEY = "__piUsage" as const;
const READY_EVENT = "usage-core:ready";
const UPDATE_CURRENT_EVENT = "usage-core:update-current";
const PERIODS: UsageWindow[] = ["today", "thisWeek", "lastWeek", "allTime"];

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
): "openai-codex" | "minimax" | "opencode-go" | "command-code" | undefined {
  if (!model) return undefined;
  const p = (model.provider ?? "").trim().toLowerCase();
  if (p === "openai-codex") return "openai-codex";
  if (p === "minimax") return "minimax";
  if (p === "opencode-go") return "opencode-go";
  if (p === "command-code" || p === "commandcode") return "command-code";
  if (p) return undefined;
  const n = (model.id ?? model.name ?? "").toLowerCase();
  if (n.includes("codex")) return "openai-codex";
  if (n.includes("minimax")) return "minimax";
  if (n.includes("opencode-go")) return "opencode-go";
  if (n.includes("command-code") || n.includes("commandcode"))
    return "command-code";
  return undefined;
}

function parseUsageArgs(
  args: string,
): { ok: true; refresh: boolean } | { ok: false; unknown: string[] } {
  const parts = args
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const unknown = parts.filter((part) => part !== "--refresh");
  if (unknown.length > 0) return { ok: false, unknown };
  return { ok: true, refresh: parts.includes("--refresh") };
}

function widthSafe(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "…");
}

function formatAge(ageMs: number | undefined): string {
  if (ageMs == null) return "";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s old`;
  return `${Math.floor(ageMs / 60_000)}m old`;
}

function cloneState(state: UsageCoreState): UsageCoreState {
  return JSON.parse(JSON.stringify(state)) as UsageCoreState;
}

function toRow(
  key: string,
  totals: {
    sessions: Set<string>;
    messages: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tokens: number;
    cost: number;
  },
) {
  return {
    key,
    sessionCount: totals.sessions.size,
    messageCount: totals.messages,
    input: totals.input,
    output: totals.output,
    cache: totals.cacheRead + totals.cacheWrite,
    tokens: totals.tokens,
    cost: totals.cost,
  };
}

function buildPeriods(
  result: Awaited<ReturnType<typeof scanOfflineUsage>>,
): AggregatedUsagePeriod[] {
  return PERIODS.map((key) => {
    const source = result.periods[key as PeriodKey];
    const providers = [...source.providers.entries()].map(
      ([provider, totals]) => toRow(provider, totals),
    );
    const modelsByProvider: Record<string, ReturnType<typeof toRow>[]> = {};
    for (const [provider, models] of source.modelsByProvider.entries()) {
      modelsByProvider[provider] = [...models.entries()].map(
        ([model, totals]) => toRow(model, totals),
      );
    }
    providers.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
    for (const p of Object.keys(modelsByProvider)) {
      modelsByProvider[p].sort(
        (a, b) => b.cost - a.cost || b.tokens - a.tokens,
      );
    }
    return {
      key,
      total: toRow("total", source.total),
      providers,
      modelsByProvider,
    };
  });
}

class UsageDashboardComponent implements Component {
  private periodIndex = 0;
  private rowIndex = 0;
  private expandedProvider: string | null = null;
  private showInsights = false;

  constructor(
    private readonly state: UsageCoreState,
    private readonly done: () => void,
    private readonly cancelScan?: () => void,
  ) {}

  private currentPeriod(): AggregatedUsagePeriod | undefined {
    return this.state.offline.periods[this.periodIndex];
  }

  render(width: number): string[] {
    const w = Math.max(8, width);
    const lines: string[] = ["Pi Usage Dashboard", ""];
    const tabs = PERIODS.map((p, i) =>
      i === this.periodIndex ? `[${p}]` : p,
    ).join(" ");
    lines.push(`Periods: ${tabs}`);
    if (this.state.loading) lines.push("Loading session history...");
    lines.push("");

    if (this.showInsights) {
      lines.push("Insights");
      if (this.state.insights.length === 0) lines.push("No insights yet.");
      for (const item of this.state.insights) {
        lines.push(
          `- ${item.label}: $${item.cost.toFixed(4)} (${item.detail})`,
        );
      }
    } else {
      const period = this.currentPeriod();
      if (!period || period.total.messageCount === 0) {
        lines.push("No local session usage found.");
      } else {
        lines.push(
          `Total: $${period.total.cost.toFixed(4)} • ${period.total.tokens} tok • ${period.total.messageCount} msgs • ${period.total.sessionCount} sessions`,
        );
        const compact = w < 90;
        const tiny = w < 65;
        period.providers.forEach((row, index) => {
          const selected = index === this.rowIndex ? ">" : " ";
          const base = tiny
            ? `${selected} ${row.key} $${row.cost.toFixed(2)} ${row.tokens}t`
            : compact
              ? `${selected} ${row.key} $${row.cost.toFixed(2)} ${row.tokens}t ${row.input}in/${row.output}out`
              : `${selected} ${row.key} $${row.cost.toFixed(2)} tok:${row.tokens} in:${row.input} out:${row.output} cache:${row.cache} msg:${row.messageCount} sess:${row.sessionCount}`;
          lines.push(base);
          if (this.expandedProvider === row.key) {
            for (const model of period.modelsByProvider[row.key] ?? []) {
              lines.push(
                tiny
                  ? `    - ${model.key} $${model.cost.toFixed(2)}`
                  : `    - ${model.key} $${model.cost.toFixed(2)} tok:${model.tokens} msg:${model.messageCount}`,
              );
            }
          }
        });
      }
    }

    lines.push("");
    for (const provider of this.state.providers.filter(
      (p) => p.providerId !== "offline",
    )) {
      const status =
        provider.status === "unavailable" ? "unavailable" : provider.status;
      const diag = provider.diagnostics[0] ?? provider.diagnostic;
      const age = formatAge(provider.staleAgeMs);
      lines.push(
        `- ${provider.providerLabel}: ${status} (${provider.sourceLabel})${age ? ` • ${age}` : ""}${diag ? ` • ${diag}` : ""}`,
      );
      if (
        provider.providerId === "openai-codex" ||
        provider.providerId === "minimax" ||
        provider.providerId === "opencode-go" ||
        provider.providerId === "command-code"
      ) {
        for (const w of provider.windows) {
          const text = w.unavailableReason
            ? `${w.label}: ${w.unavailableReason}`
            : w.used != null && w.limit != null && w.unit
              ? `${w.label}: ${w.used}/${w.limit} ${w.unit} (${w.usedPercent}%)${w.resetAt ? ` • resets ${new Date(w.resetAt).toISOString()}` : " • reset unavailable"}`
              : `${w.label}: ${w.usedPercent}%`;
          lines.push(`    - ${text}`);
        }
        if (
          provider.providerId === "minimax" ||
          provider.providerId === "command-code"
        ) {
          lines.push(`    - Plan: ${provider.planName ?? "unavailable"}`);
        }
        for (const balance of provider.balances) {
          lines.push(
            `    - ${balance.label}: ${balance.remaining ?? "unavailable"} ${balance.unit}`,
          );
        }
      }
    }
    lines.push("");
    lines.push(
      "Tab/←→ period • ↑↓ row • Enter expand • v insights • q/Esc close",
    );
    return lines.map((line) => widthSafe(line, w));
  }

  handleInput(data: string): void {
    const period = this.currentPeriod();
    if (data === "q" || matchesKey(data, Key.escape)) {
      this.cancelScan?.();
      this.done();
      return;
    }
    if (data === "v") {
      this.showInsights = !this.showInsights;
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.periodIndex = (this.periodIndex + 1) % PERIODS.length;
      this.rowIndex = 0;
      this.expandedProvider = null;
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.periodIndex =
        (this.periodIndex - 1 + PERIODS.length) % PERIODS.length;
      this.rowIndex = 0;
      this.expandedProvider = null;
      return;
    }
    if (!period) return;
    if (matchesKey(data, Key.down)) {
      this.rowIndex = Math.min(
        this.rowIndex + 1,
        Math.max(0, period.providers.length - 1),
      );
    }
    if (matchesKey(data, Key.up))
      this.rowIndex = Math.max(0, this.rowIndex - 1);
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const p = period.providers[this.rowIndex]?.key;
      if (!p) return;
      this.expandedProvider = this.expandedProvider === p ? null : p;
    }
  }

  invalidate(): void {}
}

async function openDashboard(
  ctx: ExtensionCommandContext,
  state: UsageCoreState,
  cancelScan?: () => void,
): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, _theme, _keys, done) =>
      new UsageDashboardComponent(state, done, cancelScan),
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

    const emit = (name: string) => {
      pi.events.emit(name, { state: cloneState(state) });
    };

    let _activeModelId: string | undefined;
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
      const hasCompatibilityWindows =
        current?.providerId === "openai-codex" &&
        current.windows.some(
          (window) =>
            (window.key === "fiveHour" || window.key === "weekly") &&
            !window.unavailableReason,
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
      emit(UPDATE_CURRENT_EVENT);
      const result = await scanOfflineUsage(deps, {
        refresh,
        shouldCancel: () => token?.cancelled === true,
      });
      if (token?.cancelled) {
        state.loading = false;
        emit(UPDATE_CURRENT_EVENT);
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
    };

    const bootstrap = async () => {
      await Promise.all([populateProviders(false), refreshOffline(false)]);
      state.diagnostics = ["live runtime ready"];
      emit(READY_EVENT);
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
      _activeModelId = model?.id ?? model?.name;
      syncCompatibility();
    };

    const emitProviderUpdate = async (force = false, signal?: AbortSignal) => {
      await populateProviders(force, signal);
      emit(UPDATE_CURRENT_EVENT);
    };

    const startLiveRuntime = () => {
      if (!periodicRefresh) {
        periodicRefresh = deps.setInterval(() => {
          void emitProviderUpdate(false).catch(() => undefined);
        }, 60_000);
        deps.unrefTimer(periodicRefresh);
      }
      if (!cacheWatcher) {
        void deps
          .mkdir(providerCacheDir(deps), { recursive: true })
          .then(() => {
            cacheWatcher = deps.watch(providerCacheDir(deps), (filename) => {
              if (
                filename !== "openai-codex.json" &&
                filename !== "minimax.json" &&
                filename !== "opencode-go.json" &&
                filename !== "command-code.json"
              )
                return;
              void emitProviderUpdate(false).catch(() => undefined);
            });
          })
          .catch(() => undefined);
      }
    };

    pi.on("session_start", (_event, ctx) => {
      updateModelContext(ctx.model);
      startLiveRuntime();
      void bootstrap();
    });

    pi.on("model_select", (event, ctx) => {
      updateModelContext(event.model);
      if (
        state.currentProviderId === "openai-codex" ||
        state.currentProviderId === "minimax" ||
        state.currentProviderId === "opencode-go" ||
        state.currentProviderId === "command-code"
      ) {
        void emitProviderUpdate(true, ctx.signal).catch(() => undefined);
      } else {
        emit(UPDATE_CURRENT_EVENT);
      }
    });
    pi.on("turn_start", (_event, ctx) => {
      updateModelContext(ctx.model);
      emit(UPDATE_CURRENT_EVENT);
    });
    pi.on("turn_end", (_event, ctx) => {
      updateModelContext(ctx.model);
      emit(UPDATE_CURRENT_EVENT);
    });

    pi.registerCommand("usage", {
      description: "Open the usage dashboard",
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;

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

        await populateProviders(parsed.refresh);
        const scanToken: ScanToken = { cancelled: false };
        const shouldScan =
          parsed.refresh ||
          (state.offline.periods.length === 0 && !state.loading);
        const scan = shouldScan
          ? refreshOffline(parsed.refresh, scanToken)
          : undefined;
        await openDashboard(ctx, state, () => {
          scanToken.cancelled = true;
        });
        await scan;
      },
    });

    pi.on("session_shutdown", () => {
      if (periodicRefresh) deps.clearInterval(periodicRefresh);
      periodicRefresh = undefined;
      cacheWatcher?.close();
      cacheWatcher = undefined;
      delete globalThis[GLOBAL_KEY];
    });
  };
}

export default createUsageExtension();
