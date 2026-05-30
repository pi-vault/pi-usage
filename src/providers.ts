import type { UsageDeps } from "./deps.ts";
import type { ProviderId, UsageProviderAdapter } from "./types.ts";

const phaseByProvider: Record<ProviderId, string> = {
  offline: "Phase 2",
  "openai-codex": "Phase 3",
  minimax: "Phase 4",
  "opencode-go": "Phase 5",
  "command-code": "Phase 6",
};

const labelByProvider: Record<ProviderId, string> = {
  offline: "Offline",
  "openai-codex": "OpenAI/Codex",
  minimax: "MiniMax",
  "opencode-go": "OpenCode Go",
  "command-code": "Command Code",
};

export function createProviderRegistry(deps: UsageDeps): UsageProviderAdapter[] {
  const ids: ProviderId[] = ["offline", "openai-codex", "minimax", "opencode-go", "command-code"];
  return ids.map((id) => ({
    id,
    label: labelByProvider[id],
    strategy: id === "offline" ? "offline" : "api",
    phase: phaseByProvider[id],
    fetch: async () => ({
      snapshot: {
        providerId: id,
        providerLabel: labelByProvider[id],
        available: false,
        phase: phaseByProvider[id],
        diagnostic: `${labelByProvider[id]} will be implemented in ${phaseByProvider[id]}.`,
        fetchedAt: deps.now(),
        balances: [],
      },
    }),
  }));
}
