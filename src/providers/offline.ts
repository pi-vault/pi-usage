import { PROVIDER_LABELS } from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type { UsageProviderAdapter } from "../types.ts";
import { unavailableSnapshot } from "./runtime.ts";

export function createOfflineProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "offline",
    label: PROVIDER_LABELS.offline,
    strategy: "offline",
    fetch: async () => ({
      snapshot: unavailableSnapshot(
        deps,
        "offline",
        `${PROVIDER_LABELS.offline} usage source unavailable.`,
      ),
      shouldWriteCache: false,
    }),
  };
}
