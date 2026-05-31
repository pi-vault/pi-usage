import { join } from "node:path";
import {
  OPENAI_MONTHLY_UNAVAILABLE_REASON,
  PROVIDER_LABELS,
  PROVIDER_TTLS_MS,
} from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type { LiveUsageWindow, UsageProviderAdapter } from "../types.ts";
import {
  fetchWithLiveRuntime,
  readJsonSafe,
  retryAfterMs,
} from "./runtime.ts";

async function resolveCodexAuth(
  deps: UsageDeps,
): Promise<{ token?: string; accountId?: string }> {
  const env = deps.env;
  const token = (
    env.OPENAI_CODEX_OAUTH_TOKEN ||
    env.OPENAI_CODEX_ACCESS_TOKEN ||
    env.CODEX_OAUTH_TOKEN ||
    env.CODEX_ACCESS_TOKEN
  )?.trim();
  const accountId = (
    env.OPENAI_CODEX_ACCOUNT_ID || env.CHATGPT_ACCOUNT_ID
  )?.trim();
  if (token) return { token, accountId };

  const piAuth = await readJsonSafe<Record<string, unknown>>(
    deps,
    join(deps.agentDir(), "auth.json"),
  );
  const piCodex = (piAuth?.["openai-codex"] ?? {}) as Record<string, unknown>;
  if (typeof piCodex.access === "string" && piCodex.access) {
    return {
      token: piCodex.access,
      accountId:
        accountId ||
        (typeof piCodex.accountId === "string" ? piCodex.accountId : undefined),
    };
  }

  const codexAuthPath = join(
    env.CODEX_HOME?.trim() || join(deps.homeDir(), ".codex"),
    "auth.json",
  );
  const auth = await readJsonSafe<Record<string, unknown>>(deps, codexAuthPath);
  if (auth) {
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
      return { token: auth.OPENAI_API_KEY, accountId };
    }
    const tokens = (auth.tokens ?? {}) as Record<string, unknown>;
    if (typeof tokens.access_token === "string" && tokens.access_token) {
      return {
        token: tokens.access_token,
        accountId:
          accountId ||
          (typeof tokens.account_id === "string" ? tokens.account_id : undefined),
      };
    }
  }
  return { accountId };
}

function labelFromSeconds(
  seconds: number | undefined,
  fallback: "Primary" | "Secondary",
): string {
  if (!seconds) return fallback;
  if (seconds < 24 * 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 144 * 3600) return "Day";
  return "Week";
}

function parseWindow(
  raw: Record<string, unknown>,
  key: string,
  label: string,
): LiveUsageWindow {
  const sec =
    typeof raw.limit_window_seconds === "number"
      ? raw.limit_window_seconds
      : undefined;
  const resetAt = typeof raw.reset_at === "number" ? raw.reset_at : undefined;
  return {
    key,
    label,
    usedPercent: typeof raw.used_percent === "number" ? raw.used_percent : 0,
    resetAt,
    windowDurationMins: sec ? Math.round(sec / 60) : undefined,
  };
}

function normalizeOpenAIWindows(payload: Record<string, unknown>): LiveUsageWindow[] {
  const windows: LiveUsageWindow[] = [];
  const rate = (payload.rate_limit ?? {}) as Record<string, unknown>;
  const primary = (rate.primary_window ?? {}) as Record<string, unknown>;
  const secondary = (rate.secondary_window ?? {}) as Record<string, unknown>;

  if (Object.keys(primary).length > 0) {
    const sec = primary.limit_window_seconds as number | undefined;
    const key = sec === 5 * 3600 ? "fiveHour" : sec === 7 * 24 * 3600 ? "weekly" : "primary";
    windows.push(parseWindow(primary, key, labelFromSeconds(sec, "Primary")));
  }
  if (Object.keys(secondary).length > 0) {
    const sec = secondary.limit_window_seconds as number | undefined;
    const key = sec === 5 * 3600 ? "fiveHour" : sec === 7 * 24 * 3600 ? "weekly" : "secondary";
    windows.push(parseWindow(secondary, key, labelFromSeconds(sec, "Secondary")));
  }

  const additional = Array.isArray(payload.additional_rate_limits)
    ? payload.additional_rate_limits
    : [];
  additional.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const prefix =
      typeof e.limit_name === "string" && e.limit_name.trim()
        ? e.limit_name.trim()
        : typeof e.metered_feature === "string" && e.metered_feature.trim()
          ? e.metered_feature.trim()
          : "Additional";
    const rateLimit = (e.rate_limit ?? {}) as Record<string, unknown>;
    const p = (rateLimit.primary_window ?? {}) as Record<string, unknown>;
    const s = (rateLimit.secondary_window ?? {}) as Record<string, unknown>;
    if (Object.keys(p).length > 0)
      windows.push(
        parseWindow(
          p,
          `additional:${i}:primary`,
          `${prefix} ${labelFromSeconds(p.limit_window_seconds as number | undefined, "Primary")}`,
        ),
      );
    if (Object.keys(s).length > 0)
      windows.push(
        parseWindow(
          s,
          `additional:${i}:secondary`,
          `${prefix} ${labelFromSeconds(s.limit_window_seconds as number | undefined, "Secondary")}`,
        ),
      );
  });

  windows.push({
    key: "monthly",
    label: "Monthly",
    usedPercent: 0,
    unavailableReason: OPENAI_MONTHLY_UNAVAILABLE_REASON,
  });
  return windows;
}

export function createOpenAICodexProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "openai-codex",
    label: PROVIDER_LABELS["openai-codex"],
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "openai-codex",
          fetchLive: async ({ now, signal }) => {
            const auth = await resolveCodexAuth(deps);
            if (!auth.token) {
              return { kind: "credentials" as const, message: "Missing openai-codex credentials." };
            }

            const timeout = new AbortController();
            const timer = deps.setTimeout(() => timeout.abort(), 5_000);
            const combinedSignal = signal
              ? AbortSignal.any([signal, timeout.signal])
              : timeout.signal;
            const res = await deps
              .fetch("https://chatgpt.com/backend-api/wham/usage", {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${auth.token}`,
                  Accept: "application/json",
                  ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
                },
                signal: combinedSignal,
              })
              .finally(() => deps.clearTimeout(timer));

            if (res.status === 429) {
              return {
                kind: "rate-limited" as const,
                message: "Rate limited.",
                nextRetryAt: now + retryAfterMs(res.headers, now),
              };
            }
            if (res.status === 401 || res.status === 403) {
              return { kind: "credentials" as const, message: "Please log into openai-codex again." };
            }
            if (!res.ok) return { kind: "error" as const, message: "Live source unavailable." };

            const data = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
            if (!data) return { kind: "error" as const, message: "Live source unavailable." };
            const windows = normalizeOpenAIWindows(data);
            if (!windows.some((w) => w.key !== "monthly")) {
              return { kind: "error" as const, message: "Live source unavailable." };
            }
            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "openai-codex",
                providerLabel: PROVIDER_LABELS["openai-codex"],
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + PROVIDER_TTLS_MS["openai-codex"],
                balances: [],
                status: "live",
                sourceLabel: "ChatGPT usage API",
                sourceKind: "live",
                windows,
                diagnostics: [],
              },
            };
          },
        },
        input,
      ),
  };
}
