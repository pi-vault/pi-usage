export type ProviderId =
  | "offline"
  | "openai-codex"
  | "minimax"
  | "opencode-go"
  | "command-code";

export type UsageWindow = "today" | "thisWeek" | "lastWeek" | "allTime";

export interface ProviderBalance {
  label: string;
  remaining: number | null;
  unit: string;
}

export interface ProviderUsageSnapshot {
  providerId: ProviderId;
  providerLabel: string;
  available: boolean;
  phase: string;
  diagnostic: string;
  fetchedAt: number;
  balances: ProviderBalance[];
}

export type ProviderFetchStrategy = "offline" | "api";

export interface ProviderFetchOutcome {
  snapshot: ProviderUsageSnapshot;
}

export interface UsageProviderAdapter {
  id: ProviderId;
  label: string;
  strategy: ProviderFetchStrategy;
  phase: string;
  fetch(): Promise<ProviderFetchOutcome>;
}

export interface AggregatedUsageRow {
  key: string;
  sessionCount: number;
  messageCount: number;
  input: number;
  output: number;
  cache: number;
  tokens: number;
  cost: number;
}

export interface AggregatedUsagePeriod {
  key: UsageWindow;
  total: AggregatedUsageRow;
  providers: AggregatedUsageRow[];
  modelsByProvider: Record<string, AggregatedUsageRow[]>;
}

export interface OfflineUsageState {
  providerId: "offline";
  totals: ProviderBalance[];
  periods: AggregatedUsagePeriod[];
  scannedFiles: number;
  messageCount: number;
}

export interface RateWindow {
  label: string;
  usedPercent: number;
  resetDescription?: string;
}

export interface CurrentUsageCompatibility {
  provider: string;
  displayName: string;
  windows: RateWindow[];
}

export interface UsageInsight {
  label: string;
  cost: number;
  detail: string;
}

export interface UsageCoreState {
  refreshRequested: boolean;
  generatedAt: number;
  loading: boolean;
  offline: OfflineUsageState;
  insights: UsageInsight[];
  currentProviderId: ProviderId | null;
  currentProviderSnapshot: ProviderUsageSnapshot | null;
  providers: ProviderUsageSnapshot[];
  diagnostics: string[];
  provider?: string;
  usage?: CurrentUsageCompatibility;
  compatibility: {
    currentLiveProviderId: ProviderId | null;
    currentLiveProviderSnapshot: ProviderUsageSnapshot | null;
  };
}

export interface UsageDashboardState {
  title: string;
  state: UsageCoreState;
}

export interface UnavailableProviderState {
  providerId: ProviderId;
  diagnostic: string;
  phase: string;
}
