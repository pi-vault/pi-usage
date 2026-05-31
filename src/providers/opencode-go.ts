import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import { buildOpenCodeGoSnapshot } from "../opencode-go.ts";
import type { UsageProviderAdapter } from "../types.ts";
import { fetchWithLiveRuntime } from "./runtime.ts";

export function createOpenCodeGoProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "opencode-go",
    label: PROVIDER_LABELS["opencode-go"],
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "opencode-go",
          fetchLive: async ({ now, signal }) => {
            const snapshot = await buildOpenCodeGoSnapshot(deps, now, { signal });
            if (!snapshot.available) {
              return {
                kind: "error" as const,
                message: [snapshot.diagnostic, ...snapshot.diagnostics].join(" "),
              };
            }
            return {
              kind: "ok" as const,
              snapshot: {
                ...snapshot,
                expiresAt: now + PROVIDER_TTLS_MS["opencode-go"],
              },
            };
          },
        },
        input,
      ),
  };
}
