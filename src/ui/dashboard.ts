import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { PERIOD_ORDER, UI_STRINGS } from "../constants.ts";
import type { AggregatedUsagePeriod, UsageCoreState, UsageWindow } from "../types.ts";

const PERIODS: UsageWindow[] = PERIOD_ORDER;

function widthSafe(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "…");
}

function formatAge(ageMs: number | undefined): string {
  if (ageMs == null) return "";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s old`;
  return `${Math.floor(ageMs / 60_000)}m old`;
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
              : `${selected} ${row.key} $${row.cost.toFixed(2)} tok:${row.tokens} in:${row.input} out:${row.output} cacheR:${row.cacheRead} cacheW:${row.cacheWrite} msg:${row.messageCount} sess:${row.sessionCount}`;
          lines.push(base);
          if (this.expandedProvider === row.key) {
            for (const model of period.modelsByProvider[row.key] ?? []) {
              lines.push(
                tiny
                  ? `    - ${model.key} $${model.cost.toFixed(2)}`
                  : compact
                    ? `    - ${model.key} $${model.cost.toFixed(2)} tok:${model.tokens} msg:${model.messageCount}`
                    : `    - ${model.key} $${model.cost.toFixed(2)} tok:${model.tokens} in:${model.input} out:${model.output} cacheR:${model.cacheRead} cacheW:${model.cacheWrite} msg:${model.messageCount}`,
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
