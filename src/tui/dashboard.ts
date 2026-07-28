import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  type Component,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { PERIOD_ORDER, UI_STRINGS } from "../shared/constants.ts";
import type {
  AggregatedUsagePeriod,
  AggregatedUsageRow,
  ProviderUsageSnapshot,
  UsageCoreState,
  UsageWindow,
} from "../shared/types.ts";
import {
  type DashboardTheme,
  fromPiTheme,
  noTheme,
  padVisible,
  truncateVisible,
  wrapVisible,
} from "./dashboard-theme.ts";
import {
  type DashboardTab,
  frame,
  frameContentWidth,
  renderTabBar,
} from "./overlay-render.ts";
import {
  formatAge,
  formatAbbrev,
  formatCurrency,
  formatRatio,
  formatResetCompact,
} from "./formatters.ts";
import {
  labelWidth,
  separator,
  tableColumns,
  tableLine,
  type TableColumn,
} from "./table-layout.ts";

const PERIODS: UsageWindow[] = PERIOD_ORDER;
const PERIOD_LABELS: Record<UsageWindow, string> = {
  today: "Today",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  allTime: "All Time",
};

const USAGE_CORE_UPDATE_EVENT = "usage-core:update-current";
const SHIFT_TAB_KEY: "shift+tab" = "shift+tab";

const DEFAULT_PERIOD_INDEX = (() => {
  const idx = PERIODS.indexOf(UI_STRINGS.dashboardDefaultPeriod);
  return idx >= 0 ? idx : 0;
})();

type DashboardTabId = "statistics" | "current" | "insights";

const DASHBOARD_TABS: DashboardTab[] = [
  {
    id: "statistics",
    label: UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics,
  },
  {
    id: "current",
    label: UI_STRINGS.dashboardBorderedSectionTitles.currentUsage,
  },
  { id: "insights", label: UI_STRINGS.dashboardBorderedSectionTitles.insights },
];

const INSIGHT_CATEGORIES = [
  { id: "project", label: "Projects" },
  { id: "skill", label: "Skills" },
  { id: "mcp", label: "MCP servers" },
  { id: "cost", label: "Cost patterns" },
] as const;

type InsightCategoryId = (typeof INSIGHT_CATEGORIES)[number]["id"];

type AvailableInsightCategory = {
  id: InsightCategoryId;
  label: string;
  items: UsageCoreState["insights"];
};

function normalizePlan(provider: ProviderUsageSnapshot): string | undefined {
  const raw = provider.planName?.trim();
  if (!raw) return undefined;
  if (provider.providerId === "minimax") {
    return raw.replace(/^MiniMax\s+/i, "").trim() || raw;
  }
  return raw;
}

function providerHeading(
  provider: ProviderUsageSnapshot,
  referenceTime: number,
): string {
  const plan = normalizePlan(provider);
  const name = plan
    ? `${provider.providerLabel} (${plan})`
    : provider.providerLabel;
  const ageMs =
    provider.staleAgeMs ?? Math.max(0, referenceTime - provider.fetchedAt);
  return `${name} • ${provider.status} • ${formatAge(ageMs)}`;
}

function providerDiagnostics(provider: ProviderUsageSnapshot): string[] {
  const notes = [...provider.diagnostics];
  if (provider.diagnostic) notes.unshift(provider.diagnostic);
  return [...new Set(notes.filter(Boolean))];
}

function liveProviders(state: UsageCoreState): ProviderUsageSnapshot[] {
  return state.providers.filter(
    (provider) => provider.providerId !== "offline",
  );
}

function initialLiveProviderIndex(state: UsageCoreState): number {
  const providers = liveProviders(state);
  if (providers.length === 0) return 0;
  const current = state.currentProviderSnapshot;
  if (current?.providerId && current.providerId !== "offline") {
    const idx = providers.findIndex(
      (provider) => provider.providerId === current.providerId,
    );
    if (idx >= 0) return idx;
  }
  const withData = providers.findIndex(
    (provider) => provider.windows.length > 0 || provider.balances.length > 0,
  );
  return withData >= 0 ? withData : 0;
}

export interface UsageDashboardOptions {
  /**
   * Optional TUI instance. When provided, the dashboard subscribes to live
   * state updates and calls `tui.requestRender()` so the open overlay stays
   * visually current.
   */
  tui?: TUI;
  /** Optional theme adapter. Falls back to a passthrough adapter. */
  theme?: DashboardTheme;
  /**
   * Optional cancel callback that the dashboard invokes when the user
   * dismisses the overlay via `q`/`Esc`. Used to short-circuit an
   * in-flight offline scan started by `/usage:refresh`.
   */
  cancelScan?: () => void;
}

export class UsageDashboardComponent implements Component {
  private activeTab: DashboardTabId = "statistics";
  private periodIndex = DEFAULT_PERIOD_INDEX;
  private insightsCategory: InsightCategoryId = "project";
  private rowIndex = 0;
  private expandedProvider: string | null = null;
  private currentUsageProviderIndex: number;
  private readonly theme: DashboardTheme;
  private readonly cancelScan?: () => void;
  private unsubscribeUpdate?: () => void;

  constructor(
    private readonly state: UsageCoreState,
    private readonly done: () => void,
    options: UsageDashboardOptions = {},
  ) {
    this.theme = options.theme ?? noTheme;
    this.cancelScan = options.cancelScan;
    this.currentUsageProviderIndex = initialLiveProviderIndex(state);
    this.subscribeToUpdates(options.tui);
  }

  private subscribeToUpdates(tui: TUI | undefined): void {
    if (!tui || typeof tui.requestRender !== "function") return;
    // The dashboard needs to re-render when async state updates land. We look
    // for a typed event-bus hook on the TUI, falling back to a well-known
    // global hook that the index module can populate.
    const bus = pickEventBus(tui);
    if (!bus) return;
    const handler = () => {
      try {
        tui.requestRender();
      } catch {
        // Render failures must not break the dashboard.
      }
    };
    const off = bus.on(USAGE_CORE_UPDATE_EVENT, handler);
    if (typeof off === "function") {
      this.unsubscribeUpdate = off;
    }
  }

  private currentPeriod(): AggregatedUsagePeriod | undefined {
    return this.state.offline.periods[this.periodIndex];
  }

  private renderBarStyled(usedPercent: number, width = 24): string {
    const leftPercent = Math.max(0, 100 - usedPercent);
    const fill = Math.round((leftPercent / 100) * width);
    const empty = Math.max(0, width - fill);
    const displayPercent = Math.round(leftPercent);
    const fillText = "█".repeat(fill);
    const emptyText = "░".repeat(empty);
    const highlightedFill = this.theme.fg("accent", fillText);
    const dimmedEmpty = this.theme.dim(emptyText);
    const percentText = this.theme.fg("accent", `${displayPercent}% left`);
    return `[${highlightedFill}${dimmedEmpty}] ${percentText}`;
  }

  private renderQuotaWindow(
    window: ProviderUsageSnapshot["windows"][number],
    labelWidth: number,
  ): string {
    if (window.unavailableReason) {
      return `${padVisible(this.theme.dim(window.label), labelWidth, "left")}: ${this.theme.dim(window.unavailableReason)}`;
    }
    const label = padVisible(
      this.theme.dim(window.label),
      labelWidth,
      "left",
    );
    const bar = this.renderBarStyled(window.usedPercent);
    const resetText = this.theme.dim(formatResetCompact(window.resetAt));
    const ratio = formatRatio(window);
    if (ratio) {
      return `${label}: ${bar} ${resetText} - ${this.theme.dim(ratio)}`;
    }
    return `${label}: ${bar} ${resetText}`;
  }

  private renderQuotaWindows(
    windows: ProviderUsageSnapshot["windows"],
  ): string[] {
    const availableWindows = windows.filter((w) => !w.unavailableReason);
    const maxLabelWidth =
      availableWindows.length > 0
        ? Math.max(...availableWindows.map((w) => w.label.length))
        : 0;

    return windows.map((window) =>
      this.renderQuotaWindow(window, maxLabelWidth),
    );
  }

  private renderProviderRow(
    row: AggregatedUsageRow,
    selected: boolean,
    expanded: boolean,
    columns: TableColumn[],
    providerWidth: number,
  ): string {
    const arrow = expanded ? "▾" : "▸";
    const arrowStyled = selected
      ? this.theme.fg("accent", arrow)
      : this.theme.dim(arrow);
    const labelStyled = selected
      ? this.theme.fg("accent", this.theme.bold(row.key))
      : this.theme.dim(row.key);
    const label = `${arrowStyled} ${labelStyled}`;
    const cells = columns.map((column) =>
      padVisible(column.render(row), column.width, "right"),
    );
    return `${padVisible(label, providerWidth, "left")}  ${cells.join("  ")}`;
  }

  private renderModelRow(
    row: AggregatedUsageRow,
    columns: TableColumn[],
    providerWidth: number,
  ): string {
    const label = `  ${this.theme.dim(row.key)}`;
    const cells = columns.map((column) =>
      padVisible(this.theme.dim(column.render(row)), column.width, "right"),
    );
    return `${padVisible(label, providerWidth, "left")}  ${cells.join("  ")}`;
  }

  private renderTabs(
    labels: string[],
    selectedIndex: number,
    width: number,
  ): string[] {
    const segments: string[] = labels.map((label, index) => {
      if (index === selectedIndex) {
        return this.theme.fg("accent", this.theme.bold(`[${label}]`));
      }
      return this.theme.dim(label);
    });
    // Word-aware wrapping: keep each tab on its own visual line. The joined
    // string may exceed `width`; if any single tab is wider than the
    // available width, fall back to `wrapVisible` so ANSI-aware truncation
    // kicks in for the offending line.
    const separator = "    ";
    const lines: string[] = [];
    let current = "";
    for (let i = 0; i < segments.length; i += 1) {
      const candidate = current
        ? `${current}${separator}${segments[i]}`
        : segments[i];
      if (current && visibleWidth(candidate) > width) {
        lines.push(current);
        current = segments[i];
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    return lines.flatMap((line) => {
      if (visibleWidth(line) <= width) return [line];
      return wrapVisible(line, width);
    });
  }

  private renderLegend(width: number): string[] {
    const plain = [
      "Tokens = Input + Output + CacheW",
      "↑In = Input + CacheW",
      "↓Out = Output",
      "CacheR = Cache Read",
      "CacheW = Cache Write",
    ];
    const styled = plain.map((entry) => this.theme.dim(entry));
    const separator = " • ";
    const joinedPlain = plain.join(separator);
    if (joinedPlain.length <= width) return [styled.join(separator)];

    const firstStyled: string[] = [];
    const firstPlain: string[] = [];
    let linePlain = "";
    for (let i = 0; i < plain.length; i += 1) {
      const nextPlain = linePlain
        ? `${linePlain}${separator}${plain[i]}`
        : plain[i];
      if (nextPlain.length <= width || !linePlain) {
        linePlain = nextPlain;
        firstStyled.push(styled[i]);
        firstPlain.push(plain[i]);
        continue;
      }
      break;
    }
    const used = firstPlain.length;
    if (used === 0 || used >= plain.length) {
      return [styled.join(separator)];
    }
    return [
      firstStyled.join(separator),
      styled.slice(used).join(separator),
    ];
  }

  private renderUsageStatisticsTab(w: number, lines: string[]): void {
    lines.push(
      ...this.renderTabs(
        PERIODS.map((period) => PERIOD_LABELS[period]),
        this.periodIndex,
        w,
      ),
    );
    if (this.state.loading) {
      lines.push(this.theme.dim("Loading session history..."));
    }
    lines.push("");

    const period = this.currentPeriod();
    if (!period || period.total.messageCount === 0) {
      lines.push(this.theme.dim("No local session usage found."));
      return;
    }
    const columns = tableColumns(w);
    const providerWidth = labelWidth(columns, w);
    lines.push(tableLine("Provider / Model", columns, providerWidth));
    lines.push(this.theme.fg("borderMuted", separator(columns, providerWidth)));
    period.providers.forEach((row, index) => {
      const expanded = this.expandedProvider === row.key;
      lines.push(
        this.renderProviderRow(
          row,
          index === this.rowIndex,
          expanded,
          columns,
          providerWidth,
        ),
      );
      if (expanded) {
        for (const model of period.modelsByProvider[row.key] ?? []) {
          lines.push(this.renderModelRow(model, columns, providerWidth));
        }
      }
    });
    lines.push(this.theme.fg("borderMuted", separator(columns, providerWidth)));
    lines.push(tableLine("Total", columns, providerWidth, period.total));
    lines.push("");
    lines.push(...this.renderLegend(w));
  }

  private availableInsightCategories(): AvailableInsightCategory[] {
    return INSIGHT_CATEGORIES.map((category) => ({
      ...category,
      items: this.state.insights.filter(
        (item) => (item.category ?? "cost") === category.id,
      ),
    })).filter((category) => category.items.length > 0);
  }

  private activeInsightCategory(
    categories: AvailableInsightCategory[],
  ): AvailableInsightCategory | undefined {
    const active =
      categories.find((category) => category.id === this.insightsCategory) ??
      categories[0];
    if (active) this.insightsCategory = active.id;
    return active;
  }

  private renderInsightCategory(category: AvailableInsightCategory): string[] {
    const lines: string[] = [];
    if (category.id === "cost") {
      lines.push(this.theme.dim(category.label));
      for (const item of category.items) {
        lines.push(
          this.theme.dim(
            `  - ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
          ),
        );
      }
      return lines;
    }

    const maxLabelLen = Math.max(
      ...category.items.map((item) => item.label.length),
      category.label.length,
    );
    lines.push(
      `  ${padVisible(this.theme.dim(category.label), maxLabelLen + 2, "left")}  ${this.theme.dim("% of usage")}`,
    );
    for (const item of category.items) {
      const label = padVisible(
        this.theme.dim(item.label),
        maxLabelLen + 2,
        "left",
      );
      lines.push(`  ${label}  ${this.theme.dim(item.detail)}`);
    }
    return lines;
  }

  private renderInsightsTab(w: number, lines: string[]): void {
    const categories = this.availableInsightCategories();
    const active = this.activeInsightCategory(categories);
    if (!active) {
      lines.push(this.theme.dim("No insights yet."));
      return;
    }

    lines.push(
      ...this.renderTabs(
        categories.map((category) => category.label),
        categories.indexOf(active),
        w,
      ),
    );
    lines.push("");
    lines.push(...this.renderInsightCategory(active));
  }

  private renderCurrentUsageTab(w: number, lines: string[]): void {
    const providers = liveProviders(this.state);
    if (providers.length === 0) {
      lines.push(this.theme.dim("No live usage details."));
      return;
    }
    this.currentUsageProviderIndex = Math.min(
      this.currentUsageProviderIndex,
      Math.max(0, providers.length - 1),
    );
    lines.push(
      ...this.renderTabs(
        providers.map((provider) => provider.providerLabel),
        this.currentUsageProviderIndex,
        w,
      ),
    );
    lines.push("");

    const referenceTime = Math.max(
      this.state.generatedAt,
      ...providers.map((provider) => provider.fetchedAt),
      0,
    );
    const selected = providers[this.currentUsageProviderIndex];
    lines.push(
      this.theme.fg(
        "accent",
        this.theme.bold(providerHeading(selected, referenceTime)),
      ),
    );
    if (selected.windows.length === 0 && selected.balances.length === 0) {
      lines.push(this.theme.dim("No live usage details."));
    } else {
      lines.push(...this.renderQuotaWindows(selected.windows));
      for (const balance of selected.balances) {
        const value =
          balance.unit === "USD"
            ? formatCurrency(balance.remaining ?? undefined)
            : formatAbbrev(balance.remaining ?? undefined);
        const unitSuffix = balance.unit === "USD" ? "" : ` ${balance.unit}`;
        const labelStyled = this.theme.dim(`${balance.label}:`);
        lines.push(`${labelStyled} ${value}${unitSuffix}`);
      }
    }

    // Diagnostics (previously a separate section, now housed in Current Usage)
    this.renderDiagnostics(lines);
  }

  private renderDiagnostics(lines: string[]): void {
    const providers = liveProviders(this.state);
    const diagnosticNotes = providers.flatMap((provider) =>
      providerDiagnostics(provider).map(
        (diagnostic) => `* ${provider.providerLabel}: ${diagnostic}`,
      ),
    );
    if (diagnosticNotes.length === 0) return;
    lines.push("");
    lines.push(
      this.theme.fg(
        "accent",
        this.theme.bold(UI_STRINGS.dashboardBorderedSectionTitles.notes),
      ),
    );
    for (const note of diagnosticNotes) {
      lines.push(this.theme.dim(note));
    }
  }

  private renderFooter(width: number): string {
    return this.theme.dim(
      truncateVisible(UI_STRINGS.dashboardFooters[this.activeTab], width),
    );
  }

  render(width: number): string[] {
    const w = Math.max(8, width);
    const contentWidth = frameContentWidth(w);
    const lines: string[] = [];

    // Tab bar
    lines.push(
      renderTabBar(DASHBOARD_TABS, this.activeTab, contentWidth, this.theme),
    );
    lines.push("");

    // Active tab content
    switch (this.activeTab) {
      case "statistics":
        this.renderUsageStatisticsTab(contentWidth, lines);
        break;
      case "current":
        this.renderCurrentUsageTab(contentWidth, lines);
        break;
      case "insights":
        this.renderInsightsTab(contentWidth, lines);
        break;
    }

    // Footer
    lines.push("");
    lines.push(this.renderFooter(contentWidth));

    return frame(lines, w, this.theme);
  }

  private movePeriod(delta: number): void {
    const next = (this.periodIndex + delta + PERIODS.length) % PERIODS.length;
    this.periodIndex = next;
    this.rowIndex = 0;
    this.expandedProvider = null;
  }

  private moveProvider(delta: number): void {
    const providers = liveProviders(this.state);
    if (providers.length === 0) return;
    this.currentUsageProviderIndex =
      (this.currentUsageProviderIndex + delta + providers.length) %
      providers.length;
  }

  private switchTab(delta: number): void {
    const i = DASHBOARD_TABS.findIndex((t) => t.id === this.activeTab);
    this.activeTab = DASHBOARD_TABS[
      (i + delta + DASHBOARD_TABS.length) % DASHBOARD_TABS.length
    ].id as DashboardTabId;
  }

  private handleStatisticsInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.movePeriod(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.movePeriod(1);
      return;
    }
    const period = this.currentPeriod();
    if (!period) return;
    if (matchesKey(data, Key.down)) {
      this.rowIndex = Math.min(
        this.rowIndex + 1,
        Math.max(0, period.providers.length - 1),
      );
    }
    if (matchesKey(data, Key.up)) {
      this.rowIndex = Math.max(0, this.rowIndex - 1);
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const provider = period.providers[this.rowIndex]?.key;
      if (!provider) return;
      this.expandedProvider =
        this.expandedProvider === provider ? null : provider;
    }
  }

  private handleCurrentUsageInput(data: string): void {
    if (matchesKey(data, Key.left)) {
      this.moveProvider(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.moveProvider(1);
      return;
    }
  }

  private handleInsightsInput(data: string): void {
    const delta = matchesKey(data, Key.left)
      ? -1
      : matchesKey(data, Key.right)
        ? 1
        : 0;
    if (!delta) return;

    const categories = this.availableInsightCategories();
    const active = this.activeInsightCategory(categories);
    if (!active) return;
    const index = categories.indexOf(active);
    this.insightsCategory =
      categories[(index + delta + categories.length) % categories.length].id;
  }

  handleInput(data: string): void {
    // Global keys
    if (data === "q" || matchesKey(data, Key.escape)) {
      this.invalidate();
      this.cancelScan?.();
      this.done();
      return;
    }
    if (matchesKey(data, Key.tab)) {
      this.switchTab(1);
      return;
    }
    if (matchesKey(data, SHIFT_TAB_KEY)) {
      this.switchTab(-1);
      return;
    }

    // Per-tab contextual keys
    switch (this.activeTab) {
      case "statistics":
        this.handleStatisticsInput(data);
        break;
      case "current":
        this.handleCurrentUsageInput(data);
        break;
      case "insights":
        this.handleInsightsInput(data);
        break;
    }
  }

  invalidate(): void {
    this.unsubscribeUpdate?.();
    this.unsubscribeUpdate = undefined;
  }

  dispose(): void {
    this.invalidate();
  }
}

interface EventBusLike {
  on: (event: string, handler: (...args: unknown[]) => void) => () => void;
}

function pickEventBus(tui: TUI): EventBusLike | undefined {
  // Pi does not currently expose the event bus on the TUI instance directly,
  // but a few components store a reference for the same effect. Probe a few
  // well-known shapes and fall back to a global hook the index module can set
  // up when the dashboard opens.
  const candidates: unknown[] = [
    (tui as unknown as { eventBus?: unknown }).eventBus,
    (tui as unknown as { events?: unknown }).events,
    (tui as unknown as { bus?: unknown }).bus,
    (globalThis as { __piUsageBus?: unknown }).__piUsageBus,
  ];
  for (const candidate of candidates) {
    if (isEventBus(candidate)) return candidate;
  }
  return undefined;
}

function isEventBus(value: unknown): value is EventBusLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { on?: unknown }).on === "function"
  );
}

export async function openDashboard(
  ctx: ExtensionCommandContext,
  state: UsageCoreState,
  cancelScan?: () => void,
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, _keys, done) => {
      const piTheme = theme as unknown as Parameters<typeof fromPiTheme>[0];
      const dashboardTheme: DashboardTheme =
        piTheme &&
        typeof (piTheme as { fg?: unknown }).fg === "function" &&
        typeof (piTheme as { bold?: unknown }).bold === "function"
          ? fromPiTheme(piTheme)
          : noTheme;
      return new UsageDashboardComponent(state, done, {
        tui,
        theme: dashboardTheme,
        cancelScan,
      });
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        maxHeight: "85%",
        width: "92%",
      },
    },
  );
}
