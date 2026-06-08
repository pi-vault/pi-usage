import { PROVIDER_LABELS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { UsageProviderAdapter } from "../shared/types.ts";
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
