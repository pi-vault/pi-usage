import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type {
  LiveUsageWindow,
  ProviderBalance,
  UsageProviderAdapter,
} from "../types.ts";
import { fetchWithLiveRuntime, retryAfterMs, toFinite } from "./runtime.ts";

function resolveBaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.OPENROUTER_API_URL?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "https://openrouter.ai";
}

function resolveHeaders(
  deps: UsageDeps,
  apiKey: string,
): Record<string, string> {
  const title = deps.env.OPENROUTER_X_TITLE?.trim() || "pi-usage";
  const referer = deps.env.OPENROUTER_HTTP_REFERER?.trim();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "X-OpenRouter-Title": title,
    Accept: "application/json",
  };

  if (referer) {
    headers["HTTP-Referer"] = referer;
  }

  return headers;
}

async function fetchCredits(
  deps: UsageDeps,
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "ok"; data: { totalCredits: number; totalUsage: number } }
  | { kind: "rate-limited"; retryAfter: number }
  | { kind: "credentials" }
  | { kind: "error"; message: string }
> {
  const timeout = new AbortController();
  const timer = deps.setTimeout(() => timeout.abort(), 5_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/api/v1/credits`, {
      method: "GET",
      headers,
      signal: combinedSignal,
    });
  } catch {
    deps.clearTimeout(timer);
    return {
      kind: "error",
      message: "OpenRouter credits endpoint unavailable.",
    };
  }
  deps.clearTimeout(timer);

  if (response.status === 429) {
    return {
      kind: "rate-limited",
      retryAfter: retryAfterMs(response.headers, deps.now()),
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "credentials" };
  }

  if (!response.ok) {
    return {
      kind: "error",
      message: "OpenRouter credits endpoint unavailable.",
    };
  }

  const json = await response.json().catch(() => undefined);
  if (!json || typeof json !== "object") {
    return { kind: "error", message: "OpenRouter credits response malformed." };
  }

  const wrapper = json as Record<string, unknown>;
  const data =
    wrapper.data && typeof wrapper.data === "object"
      ? (wrapper.data as Record<string, unknown>)
      : wrapper;
  const totalCredits = toFinite(data.total_credits);
  const totalUsage = toFinite(data.total_usage);

  if (totalCredits === undefined || totalUsage === undefined) {
    return { kind: "error", message: "OpenRouter credits response malformed." };
  }

  return { kind: "ok", data: { totalCredits, totalUsage } };
}

async function fetchKey(
  deps: UsageDeps,
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<
  | {
      kind: "ok";
      data: {
        quotaWindow?: LiveUsageWindow;
        periodBalances: ProviderBalance[];
      };
    }
  | { kind: "error" }
> {
  const timeout = new AbortController();
  const timer = deps.setTimeout(() => timeout.abort(), 5_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/api/v1/key`, {
      method: "GET",
      headers,
      signal: combinedSignal,
    });
  } catch {
    deps.clearTimeout(timer);
    return { kind: "error" };
  }
  deps.clearTimeout(timer);

  if (!response.ok) {
    return { kind: "error" };
  }

  const json = await response.json().catch(() => undefined);
  if (!json || typeof json !== "object") {
    return { kind: "error" };
  }

  const wrapper = json as Record<string, unknown>;
  const data =
    wrapper.data && typeof wrapper.data === "object"
      ? (wrapper.data as Record<string, unknown>)
      : wrapper;

  const limit = toFinite(data.limit);
  const usage = toFinite(data.usage);
  const limitRemaining = toFinite(data.limit_remaining);

  let quotaWindow: LiveUsageWindow | undefined;

  if (limit !== undefined && limit > 0) {
    const used = usage ?? 0;
    const usedPercent = Math.round((used / limit) * 100);
    quotaWindow = {
      key: "key-quota",
      label: "Key quota",
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      used,
      limit,
      unit: "USD",
    };
  } else if (
    usage !== undefined &&
    limitRemaining !== undefined &&
    usage + limitRemaining > 0
  ) {
    const totalLimit = usage + limitRemaining;
    const usedPercent = Math.round((usage / totalLimit) * 100);
    quotaWindow = {
      key: "key-quota",
      label: "Key quota",
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      used: usage,
      limit: totalLimit,
      unit: "USD",
    };
  }

  const periodBalances: ProviderBalance[] = [];

  const todayUsage = toFinite(data.daily_usage ?? data.today_usage);
  if (todayUsage !== undefined) {
    periodBalances.push({
      label: "Today",
      remaining: todayUsage,
      unit: "USD",
    });
  }

  const weeklyUsage = toFinite(data.weekly_usage ?? data.this_week_usage);
  if (weeklyUsage !== undefined) {
    periodBalances.push({
      label: "This week",
      remaining: weeklyUsage,
      unit: "USD",
    });
  }

  const monthlyUsage = toFinite(data.monthly_usage ?? data.this_month_usage);
  if (monthlyUsage !== undefined) {
    periodBalances.push({
      label: "This month",
      remaining: monthlyUsage,
      unit: "USD",
    });
  }

  return { kind: "ok", data: { quotaWindow, periodBalances } };
}

export function createOpenRouterProvider(
  deps: UsageDeps,
): UsageProviderAdapter {
  return {
    id: "openrouter",
    label: PROVIDER_LABELS.openrouter,
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "openrouter",
          fetchLive: async ({ now, signal }) => {
            const apiKey = deps.env.OPENROUTER_API_KEY?.trim();
            if (!apiKey) {
              return {
                kind: "credentials" as const,
                message: "Missing OPENROUTER_API_KEY.",
              };
            }

            const baseUrl = resolveBaseUrl(deps.env);
            const headers = resolveHeaders(deps, apiKey);

            const creditsResult = await fetchCredits(
              deps,
              baseUrl,
              headers,
              signal,
            );

            if (creditsResult.kind === "rate-limited") {
              return {
                kind: "rate-limited" as const,
                message: "Rate limited.",
                nextRetryAt: now + creditsResult.retryAfter,
              };
            }

            if (creditsResult.kind === "credentials") {
              return {
                kind: "credentials" as const,
                message: "Invalid OpenRouter credentials.",
              };
            }

            if (creditsResult.kind === "error") {
              return {
                kind: "error" as const,
                message: creditsResult.message,
              };
            }

            const { totalCredits, totalUsage } = creditsResult.data;
            const remainingBalance = Math.max(0, totalCredits - totalUsage);

            const balances: ProviderBalance[] = [
              {
                label: "Remaining balance",
                remaining: remainingBalance,
                unit: "USD",
              },
              { label: "Total credits", remaining: totalCredits, unit: "USD" },
              { label: "Total usage", remaining: totalUsage, unit: "USD" },
            ];

            const windows: LiveUsageWindow[] = [];
            const diagnostics: string[] = [];

            const keyResult = await fetchKey(deps, baseUrl, headers, signal);

            if (keyResult.kind === "ok") {
              if (keyResult.data.quotaWindow) {
                windows.push(keyResult.data.quotaWindow);
              }
              balances.push(...keyResult.data.periodBalances);
            } else {
              diagnostics.push("Key enrichment unavailable.");
            }

            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "openrouter",
                providerLabel: PROVIDER_LABELS.openrouter,
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + (PROVIDER_TTLS_MS.openrouter ?? 300_000),
                balances,
                status: "live",
                sourceLabel: "OpenRouter credits API",
                sourceKind: "live",
                windows,
                diagnostics,
              },
            };
          },
        },
        input,
      ),
  };
}
