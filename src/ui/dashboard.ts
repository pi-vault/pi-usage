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

function formatResetCompact(
  resetAt: number | undefined,
  now = Date.now(),
): string {
  if (!resetAt) return "(reset unavailable)";
  const resetDate = new Date(resetAt);
  const nowDate = new Date(now);
  const hours = String(resetDate.getHours()).padStart(2, "0");
  const minutes = String(resetDate.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;
  const isSameDay =
    resetDate.getFullYear() === nowDate.getFullYear() &&
    resetDate.getMonth() === nowDate.getMonth() &&
    resetDate.getDate() === nowDate.getDate();
  if (isSameDay) {
    return `(resets ${timeStr})`;
  }
  const monthStr = resetDate.toLocaleDateString("en-US", { month: "short" });
  const day = resetDate.getDate();
  return `(resets ${timeStr} on ${day} ${monthStr})`;
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
  return `${name} • ${provider.status} • ${formatAge(ageMs)}`;
}

function renderBar(usedPercent: number, width = 24): string {
  const leftPercent = Math.max(0, 100 - usedPercent);
  const fill = Math.round((leftPercent / 100) * width);
  const displayPercent = Math.round(leftPercent);
  return `[${"█".repeat(fill)}${"░".repeat(Math.max(0, width - fill))}] ${displayPercent}% left`;
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

function renderQuotaWindows(
  windows: ProviderUsageSnapshot["windows"],
): string[] {
  const availableWindows = windows.filter((w) => !w.unavailableReason);
  const maxLabelWidth =
    availableWindows.length > 0
      ? Math.max(...availableWindows.map((w) => w.label.length))
      : 0;

  return windows.map((window) => {
    if (window.unavailableReason) {
      return `${window.label}: ${window.unavailableReason}`;
    }
    const labelPad = window.label.padEnd(maxLabelWidth);
    const bar = renderBar(window.usedPercent);
    const resetText = formatResetCompact(window.resetAt);
    const ratio = formatRatio(window);
    if (ratio) {
      return `${labelPad}: ${bar} ${resetText} - ${ratio}`;
    }
    return `${labelPad}: ${bar} ${resetText}`;
  });
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
      {
        label: "CacheR",
        width: 7,
        render: (row) => formatAbbrev(row.cacheRead),
      },
      {
        label: "CacheW",
        width: 7,
        render: (row) => formatAbbrev(row.cacheWrite),
      },
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

function renderBalanceLine(
  label: string,
  remaining: number | null,
  unit: string,
): string {
  const value =
    unit === "USD"
      ? formatCurrency(remaining ?? undefined)
      : formatAbbrev(remaining ?? undefined);
  return `${label}: ${value}${unit === "USD" ? "" : ` ${unit}`}`;
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

function legendLines(width: number): string[] {
  const segments = [
    "Tokens = Input + Output + CacheW",
    "↑In = Input + CacheW",
    "↓Out = Output",
    "CacheR = Cache Read",
    "CacheW = Cache Write",
  ];
  const separatorText = " • ";
  const joined = segments.join(separatorText);
  if (joined.length <= width) return [joined];

  const first: string[] = [];
  let line = "";
  for (const segment of segments) {
    const next = line ? `${line}${separatorText}${segment}` : segment;
    if (next.length <= width || !line) {
      line = next;
      first.push(segment);
      continue;
    }
    break;
  }

  const used = first.length;
  if (used === 0 || used >= segments.length) return [joined];
  const firstLine = first.join(separatorText);
  const secondLine = segments.slice(used).join(separatorText);
  return [firstLine, secondLine];
}

function tabLines(
  labels: string[],
  selectedIndex: number,
  width: number,
): string[] {
  const tabs = labels.map((label, index) =>
    index === selectedIndex ? `[${label}]` : label,
  );
  const separatorText = "    ";
  const lines: string[] = [];
  let line = "";

  for (const tab of tabs) {
    const next = line ? `${line}${separatorText}${tab}` : tab;
    if (next.length <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = tab;
  }

  if (line) lines.push(line);
  return lines;
}

export class UsageDashboardComponent implements Component {
  private periodIndex = 0;
  private rowIndex = 0;
  private expandedProvider: string | null = null;
  private showInsights = false;
  private currentUsageProviderIndex: number;

  constructor(
    private readonly state: UsageCoreState,
    private readonly done: () => void,
    private readonly cancelScan?: () => void,
  ) {
    this.currentUsageProviderIndex = initialLiveProviderIndex(state);
  }

  private currentPeriod(): AggregatedUsagePeriod | undefined {
    return this.state.offline.periods[this.periodIndex];
  }

  render(width: number): string[] {
    const w = Math.max(8, width);
    const lines: string[] = ["Usage Statistics", ""];

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
        lines.push(
          `- ${item.label}: ${formatCurrency(item.cost)} (${item.detail})`,
        );
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
                tableLine(
                  rowLabel(model, false, false, true),
                  columns,
                  providerWidth,
                  model,
                ),
              );
            }
          }
        });
        lines.push(separator(columns, providerWidth));
        lines.push(tableLine("Total", columns, providerWidth, period.total));
        lines.push("");
        lines.push(...legendLines(w));
      }
    }

    lines.push("");
    lines.push("Current Usage");

    const providers = liveProviders(this.state);
    if (providers.length === 0) {
      lines.push("No live usage details.");
    } else {
      this.currentUsageProviderIndex = Math.min(
        this.currentUsageProviderIndex,
        Math.max(0, providers.length - 1),
      );
      lines.push(
        ...tabLines(
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
      lines.push(providerHeading(selected, referenceTime));
      if (selected.windows.length === 0 && selected.balances.length === 0) {
        lines.push("No live usage details.");
      } else {
        lines.push(...renderQuotaWindows(selected.windows));
        for (const balance of selected.balances) {
          lines.push(
            renderBalanceLine(balance.label, balance.remaining, balance.unit),
          );
        }
      }
    }

    const diagnosticNotes = providers.flatMap((provider) =>
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
    if (matchesKey(data, Key.tab)) {
      this.periodIndex = (this.periodIndex + 1) % PERIODS.length;
      this.rowIndex = 0;
      this.expandedProvider = null;
      return;
    }
    if (matchesKey(data, Key.left)) {
      const providers = liveProviders(this.state);
      if (providers.length > 0) {
        this.currentUsageProviderIndex =
          (this.currentUsageProviderIndex - 1 + providers.length) %
          providers.length;
      }
      return;
    }
    if (matchesKey(data, Key.right)) {
      const providers = liveProviders(this.state);
      if (providers.length > 0) {
        this.currentUsageProviderIndex =
          (this.currentUsageProviderIndex + 1) % providers.length;
      }
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
      this.expandedProvider =
        this.expandedProvider === provider ? null : provider;
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
