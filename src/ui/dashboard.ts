import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { PERIOD_ORDER, UI_STRINGS } from "../constants.ts";
import type {
  AggregatedUsagePeriod,
  AggregatedUsageRow,
  ProviderUsageSnapshot,
  UsageCoreState,
  UsageWindow,
} from "../types.ts";

const PERIODS: UsageWindow[] = PERIOD_ORDER;
const PERIOD_LABELS: Record<UsageWindow, string> = {
  today: "Today",
  thisWeek: "This Week",
  lastWeek: "Last Week",
  allTime: "All Time",
};

type TableColumn = {
  label: string;
  width: number;
  render: (row: AggregatedUsageRow) => string;
};

function widthSafe(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "…");
}

function formatAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s old`;
  return `${Math.floor(ageMs / 60_000)}m old`;
}

function formatCurrency(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function formatAbbrev(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const n = Math.round(value);
  if (Math.abs(n) < 1000) return `${n}`;
  const abs = Math.abs(n);
  const format = (v: number, suffix: string) => {
    const digits = v >= 100 ? 0 : 1;
    const text = v.toFixed(digits).replace(/\.0$/, "");
    return `${n < 0 ? "-" : ""}${text}${suffix}`;
  };
  if (abs < 1_000_000) return format(abs / 1_000, "k");
  if (abs < 1_000_000_000) return format(abs / 1_000_000, "M");
  return format(abs / 1_000_000_000, "B");
}

function formatReset(resetAt: number | undefined): string {
  if (!resetAt) return "Reset unavailable";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(resetAt));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `Resets ${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

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
  return `${name} • ${provider.status} (${provider.sourceLabel}) • ${formatAge(ageMs)}`;
}

function focusedProvider(state: UsageCoreState): ProviderUsageSnapshot | null {
  if (state.currentProviderSnapshot?.providerId !== "offline") {
    return state.currentProviderSnapshot;
  }
  const nonOffline = state.providers.filter((p) => p.providerId !== "offline");
  return (
    nonOffline.find((p) => p.windows.length > 0 || p.balances.length > 0) ??
    nonOffline[0] ??
    null
  );
}

function renderBar(usedPercent: number, width = 24): string {
  const leftPercent = Math.max(0, 100 - usedPercent);
  const fill = Math.round((leftPercent / 100) * width);
  return `[${"█".repeat(fill)}${"░".repeat(Math.max(0, width - fill))}] ${leftPercent}% left`;
}

function formatRatio(
  window: ProviderUsageSnapshot["windows"][number],
): string | undefined {
  if (window.used == null || window.limit == null || !window.unit) {
    return undefined;
  }
  if (window.unit === "USD") {
    return `${formatCurrency(window.used)}/${formatCurrency(window.limit)}`;
  }
  if (window.unit === "requests") {
    return `${formatAbbrev(window.used)}/${formatAbbrev(window.limit)} requests`;
  }
  return `${formatAbbrev(window.used)}/${formatAbbrev(window.limit)} ${window.unit}`;
}

function renderWindow(
  window: ProviderUsageSnapshot["windows"][number],
): string[] {
  if (window.unavailableReason) {
    return [`${window.label}: ${window.unavailableReason}`];
  }
  const ratio = formatRatio(window);
  const summary = ratio
    ? `${window.label}: ${ratio} ${renderBar(window.usedPercent)}`
    : `${window.label}: ${renderBar(window.usedPercent)}`;
  return [summary, `  ${formatReset(window.resetAt)}`];
}

function providerDiagnostics(provider: ProviderUsageSnapshot): string[] {
  const notes = [...provider.diagnostics];
  if (provider.diagnostic) notes.unshift(provider.diagnostic);
  return [...new Set(notes.filter(Boolean))];
}

function pad(value: string, width: number, align: "left" | "right"): string {
  const text = truncateToWidth(value, Math.max(0, width), "…");
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

function tableColumns(width: number): TableColumn[] {
  if (width >= 120) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Msgs", width: 6, render: (row) => `${row.messageCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
      { label: "↑In", width: 7, render: (row) => formatAbbrev(row.input) },
      { label: "↓Out", width: 7, render: (row) => formatAbbrev(row.output) },
      { label: "CacheR", width: 7, render: (row) => formatAbbrev(row.cacheRead) },
      { label: "CacheW", width: 7, render: (row) => formatAbbrev(row.cacheWrite) },
    ];
  }
  if (width >= 94) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Msgs", width: 6, render: (row) => `${row.messageCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
      { label: "↑In", width: 7, render: (row) => formatAbbrev(row.input) },
      { label: "↓Out", width: 7, render: (row) => formatAbbrev(row.output) },
    ];
  }
  if (width >= 72) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
    ];
  }
  return [
    { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
    { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
  ];
}

function labelWidth(columns: TableColumn[], width: number): number {
  const columnWidth =
    columns.reduce((sum, column) => sum + column.width, 0) +
    Math.max(0, (columns.length - 1) * 2);
  return Math.max(18, width - columnWidth - 2);
}

function tableLine(
  label: string,
  columns: TableColumn[],
  providerWidth: number,
  row?: AggregatedUsageRow,
): string {
  const cells = columns.map((column) =>
    pad(row ? column.render(row) : column.label, column.width, "right"),
  );
  return `${pad(label, providerWidth, "left")}  ${cells.join("  ")}`;
}

function separator(columns: TableColumn[], providerWidth: number): string {
  const width =
    providerWidth +
    2 +
    columns.reduce((sum, column) => sum + column.width, 0) +
    Math.max(0, (columns.length - 1) * 2);
  return "─".repeat(width);
}

function rowLabel(
  row: AggregatedUsageRow,
  selected: boolean,
  expanded: boolean,
  model = false,
): string {
  if (model) return `  ${row.key}`;
  return `${selected ? ">" : " "} ${expanded ? "▾" : "▸"} ${row.key}`;
}

function summaryCardWidth(lines: string[], width: number): number {
  const contentWidth = Math.max(...lines.map((line) => line.length), 20);
  return Math.min(contentWidth, Math.max(20, width - 4));
}

function renderBalanceLine(
  label: string,
  remaining: number | null,
  unit: string,
): string {
  const value =
    unit === "USD" ? formatCurrency(remaining ?? undefined) : formatAbbrev(remaining ?? undefined);
  return `${label}: ${value}${unit === "USD" ? "" : ` ${unit}`}`;
}

export class UsageDashboardComponent implements Component {
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
    const lines: string[] = [UI_STRINGS.dashboardTitle, ""];
    const referenceTime = Math.max(
      this.state.generatedAt,
      ...this.state.providers.map((provider) => provider.fetchedAt),
      0,
    );

    const focus = focusedProvider(this.state);
    if (focus) {
      const cardLines = [
        ">_ Pi Usage",
        `Provider: ${providerHeading(focus, referenceTime)}`,
      ];
      if (this.state.currentModelLabel) {
        cardLines.push(`Model: ${this.state.currentModelLabel}`);
      }
      if (this.state.loading || this.state.refreshRequested) {
        cardLines.push(
          `State: ${this.state.loading ? "Loading session history..." : "Refresh requested"}`,
        );
      }
      cardLines.push(
        `Offline: ${this.state.offline.scannedFiles} files • ${this.state.offline.messageCount} msgs`,
      );
      if (focus.windows.length === 0) {
        cardLines.push("No live windows.");
      }
      for (const window of focus.windows) {
        cardLines.push(...renderWindow(window));
      }
      for (const balance of focus.balances) {
        cardLines.push(
          renderBalanceLine(balance.label, balance.remaining, balance.unit),
        );
      }

      const cardWidth = summaryCardWidth(cardLines, w);
      lines.push(`┌${"─".repeat(cardWidth + 2)}┐`);
      for (const line of cardLines) {
        lines.push(`│ ${pad(line, cardWidth, "left")} │`);
      }
      lines.push(`└${"─".repeat(cardWidth + 2)}┘`);
      lines.push("");
    }

    lines.push(
      PERIODS.map((period, index) =>
        index === this.periodIndex
          ? `[${PERIOD_LABELS[period]}]`
          : PERIOD_LABELS[period],
      ).join("    "),
    );
    if (this.state.loading) lines.push("Loading session history...");
    lines.push("");

    if (this.showInsights) {
      lines.push("Insights");
      if (this.state.insights.length === 0) lines.push("No insights yet.");
      for (const item of this.state.insights) {
        lines.push(`- ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`);
      }
    } else {
      const period = this.currentPeriod();
      if (!period || period.total.messageCount === 0) {
        lines.push("No local session usage found.");
      } else {
        const columns = tableColumns(w);
        const providerWidth = labelWidth(columns, w);
        lines.push(tableLine("Provider / Model", columns, providerWidth));
        lines.push(separator(columns, providerWidth));
        period.providers.forEach((row, index) => {
          const expanded = this.expandedProvider === row.key;
          lines.push(
            tableLine(
              rowLabel(row, index === this.rowIndex, expanded),
              columns,
              providerWidth,
              row,
            ),
          );
          if (expanded) {
            for (const model of period.modelsByProvider[row.key] ?? []) {
              lines.push(
                tableLine(rowLabel(model, false, false, true), columns, providerWidth, model),
              );
            }
          }
        });
        lines.push(separator(columns, providerWidth));
        lines.push(tableLine("Total", columns, providerWidth, period.total));
        lines.push("");
        lines.push("Tokens = Input + Output + CacheW");
        lines.push("↑In = Input + CacheW");
        lines.push("↓Out = Output");
        if (columns.some((column) => column.label === "CacheR")) {
          lines.push("CacheR = Cache Read");
          lines.push("CacheW = Cache Write");
        }
      }
    }

    const diagnosticNotes = this.state.providers
      .filter((provider) => provider.providerId !== "offline")
      .flatMap((provider) =>
        providerDiagnostics(provider).map(
          (diagnostic) => `* ${provider.providerLabel}: ${diagnostic}`,
        ),
      );
    if (diagnosticNotes.length > 0) {
      lines.push("");
      lines.push("Notes");
      lines.push(...diagnosticNotes);
    }

    lines.push("");
    lines.push("Live providers");
    for (const provider of this.state.providers.filter(
      (item) => item.providerId !== "offline",
    )) {
      lines.push(`- ${providerHeading(provider, referenceTime)}`);
      for (const window of provider.windows) {
        for (const line of renderWindow(window)) {
          lines.push(`    ${line}`);
        }
      }
      for (const balance of provider.balances) {
        lines.push(
          `    ${renderBalanceLine(balance.label, balance.remaining, balance.unit)}`,
        );
      }
    }

    lines.push("");
    lines.push(UI_STRINGS.dashboardFooter);
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
    if (matchesKey(data, Key.up)) {
      this.rowIndex = Math.max(0, this.rowIndex - 1);
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const provider = period.providers[this.rowIndex]?.key;
      if (!provider) return;
      this.expandedProvider = this.expandedProvider === provider ? null : provider;
    }
  }

  invalidate(): void {}
}

export async function openDashboard(
  ctx: ExtensionCommandContext,
  state: UsageCoreState,
  cancelScan?: () => void,
): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, _theme, _keys, done) =>
      new UsageDashboardComponent(state, done, cancelScan),
  );
}
