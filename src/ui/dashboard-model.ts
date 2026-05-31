import { PERIOD_ORDER } from "../constants.ts";
import type { PeriodKey, scanOfflineUsage } from "../offline.ts";
import type { AggregatedUsagePeriod, AggregatedUsageRow, UsageWindow } from "../types.ts";

const PERIODS: UsageWindow[] = PERIOD_ORDER;

type Totals = {
  sessions: Set<string>;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
};

export function toRow(key: string, totals: Totals): AggregatedUsageRow {
  return {
    key,
    sessionCount: totals.sessions.size,
    messageCount: totals.messages,
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    cache: totals.cacheRead + totals.cacheWrite,
    tokens: totals.tokens,
    cost: totals.cost,
  };
}

export function buildPeriods(
  result: Awaited<ReturnType<typeof scanOfflineUsage>>,
): AggregatedUsagePeriod[] {
  return PERIODS.map((key) => {
    const source = result.periods[key as PeriodKey];
    const providers = [...source.providers.entries()].map(([provider, totals]) =>
      toRow(provider, totals),
    );
    const modelsByProvider: Record<string, AggregatedUsageRow[]> = {};
    for (const [provider, models] of source.modelsByProvider.entries()) {
      modelsByProvider[provider] = [...models.entries()].map(([model, totals]) =>
        toRow(model, totals),
      );
    }
    providers.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
    for (const p of Object.keys(modelsByProvider)) {
      modelsByProvider[p].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
    }
    return {
      key,
      total: toRow("total", source.total),
      providers,
      modelsByProvider,
    };
  });
}
