import type {
  CurrentUsageCompatibility,
  ProviderId,
  ProviderUsageSnapshot,
  UsageCoreState,
} from "../shared/types.ts";

/**
 * Internal state shape — source-of-truth fields only.
 * Not exported from the package.
 */
export interface InternalState {
  refreshRequested: boolean;
  generatedAt: number;
  loading: boolean;
  offline: UsageCoreState["offline"];
  insights: UsageCoreState["insights"];
  currentProviderId: ProviderId | null;
  currentModelLabel?: string;
  providers: ProviderUsageSnapshot[];
  diagnostics: string[];
}

/**
 * Compute the full UsageCoreState (with all derived fields) from internal state.
 * Pure function — no side effects.
 *
 * Replicates the logic of the former syncCompatibility() function:
 * - currentProviderSnapshot: lookup from providers[]
 * - compatibility.currentLiveProviderId: only set if provider has valid
 *   "fiveHour" or "weekly" windows without unavailableReason
 * - compatibility.currentLiveProviderSnapshot: only set when above is set
 * - provider: label string, only when compatibility is set
 * - usage: CurrentUsageCompatibility with filtered windows, only when compatibility is set
 */
export function projectState(state: InternalState): UsageCoreState {
  const currentSnapshot =
    state.providers.find((p) => p.providerId === state.currentProviderId) ??
    null;

  const hasCompatibilityWindows = Boolean(
    currentSnapshot?.windows.some(
      (w) =>
        (w.key === "fiveHour" || w.key === "weekly") && !w.unavailableReason,
    ),
  );

  const compatProviderId =
    hasCompatibilityWindows && currentSnapshot
      ? currentSnapshot.providerId
      : null;

  const compatSnapshot = compatProviderId ? currentSnapshot : null;

  return {
    refreshRequested: state.refreshRequested,
    generatedAt: state.generatedAt,
    loading: state.loading,
    offline: state.offline,
    insights: state.insights,
    currentProviderId: state.currentProviderId,
    currentModelLabel: state.currentModelLabel,
    currentProviderSnapshot: currentSnapshot,
    providers: state.providers,
    diagnostics: state.diagnostics,
    provider: compatSnapshot ? compatSnapshot.providerLabel : undefined,
    usage: compatSnapshot ? buildUsageCompat(compatSnapshot) : undefined,
    compatibility: {
      currentLiveProviderId: compatProviderId,
      currentLiveProviderSnapshot: compatSnapshot,
    },
  };
}

function buildUsageCompat(
  snapshot: ProviderUsageSnapshot,
): CurrentUsageCompatibility {
  return {
    provider: snapshot.providerId,
    displayName: snapshot.providerLabel,
    windows: snapshot.windows
      .filter((w) => w.key === "fiveHour" || w.key === "weekly")
      .filter((w) => !w.unavailableReason)
      .map((w) => ({ label: w.label, usedPercent: w.usedPercent })),
  };
}
