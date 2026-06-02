import { PROVIDER_ORDER } from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type { UsageProviderAdapter } from "../types.ts";
import { createCommandCodeProvider } from "./command-code.ts";
import { createMiniMaxProvider } from "./minimax.ts";
import { createOfflineProvider } from "./offline.ts";
import { createOpenAICodexProvider } from "./openai-codex.ts";
import { createOpenCodeGoProvider } from "./opencode-go.ts";
import { createOpenRouterProvider } from "./openrouter.ts";

export { providerCacheDir } from "./runtime.ts";

export function createProviderRegistry(
  deps: UsageDeps,
): UsageProviderAdapter[] {
  const providers: Record<UsageProviderAdapter["id"], UsageProviderAdapter> = {
    offline: createOfflineProvider(deps),
    "openai-codex": createOpenAICodexProvider(deps),
    openrouter: createOpenRouterProvider(deps),
    minimax: createMiniMaxProvider(deps),
    "opencode-go": createOpenCodeGoProvider(deps),
    "command-code": createCommandCodeProvider(deps),
  };
  return PROVIDER_ORDER.map((id) => providers[id]);
}
