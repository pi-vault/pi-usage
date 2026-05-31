import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type { LiveUsageWindow, UsageProviderAdapter } from "../types.ts";
import {
  fetchWithLiveRuntime,
  parseDurationMs,
  parseEpochMs,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";

function normalizeMiniMaxWindows(
  payload: Record<string, unknown>,
  now: number,
): { windows: LiveUsageWindow[]; planName?: string } {
  const root = (
    payload.data && typeof payload.data === "object" ? payload.data : payload
  ) as Record<string, unknown>;
  const fromCategory = Array.isArray(root.category_remains)
    ? root.category_remains
    : [];
  const fromModel = Array.isArray(root.model_remains) ? root.model_remains : [];
  const rows = fromCategory.length > 0 ? fromCategory : fromModel;

  const planRaw = [
    root.current_subscribe_title,
    root.currentSubscribeTitle,
    root.plan_name,
    root.planName,
    root.combo_title,
    root.comboTitle,
    root.current_plan_title,
    root.currentPlanTitle,
    root.package_name,
    root.packageName,
  ].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  const windows: LiveUsageWindow[] = [];
  rows.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const service =
      (typeof row.display_name === "string" && row.display_name.trim()) ||
      (typeof row.category === "string" && row.category.trim()) ||
      (typeof row.model_name === "string" && row.model_name.trim()) ||
      `Service ${idx + 1}`;

    const mk = (
      key: "interval" | "weekly",
      totalField: string,
      remainsField: string,
      resetField: string,
      durationField: string,
      label: string,
    ) => {
      const total = toFinite(row[totalField]);
      const remaining = toFinite(row[remainsField]);
      if (!total || total <= 0 || remaining == null) return;
      const used = Math.max(0, Math.min(total, total - remaining));
      const resetAt = parseEpochMs(row[resetField]);
      const remainsMs = parseDurationMs(row[durationField]);
      windows.push({
        key: `${service}:${key}`,
        label: `${service} ${label}`,
        used,
        limit: total,
        unit: "requests",
        usedPercent: Math.round((used / total) * 100),
        resetAt: resetAt ?? (remainsMs ? now + remainsMs : undefined),
      });
    };

    mk(
      "interval",
      "current_interval_total_count",
      "current_interval_usage_count",
      "end_time",
      "remains_time",
      "Interval",
    );
    mk(
      "weekly",
      "current_weekly_total_count",
      "current_weekly_usage_count",
      "weekly_end_time",
      "weekly_remains_time",
      "Weekly",
    );
  });

  const planName = planRaw?.trim();
  return {
    windows,
    planName: planName?.replace(/^MiniMax\s+/i, "").trim() || planName,
  };
}

function miniMaxResponseError(
  payload: Record<string, unknown>,
): { kind: "credentials" | "error"; message: string } | undefined {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const base = (
    data?.base_resp && typeof data.base_resp === "object"
      ? data.base_resp
      : payload.base_resp && typeof payload.base_resp === "object"
        ? payload.base_resp
        : undefined
  ) as Record<string, unknown> | undefined;
  const status = toFinite(base?.status_code);
  if (status == null || status === 0) return undefined;

  const message =
    typeof base?.status_msg === "string" ? base.status_msg.toLowerCase() : "";
  if (
    status === 1004 ||
    message.includes("cookie") ||
    message.includes("log in") ||
    message.includes("login") ||
    message.includes("unauthorized") ||
    message.includes("credential")
  ) {
    return { kind: "credentials", message: "Invalid minimax credentials." };
  }
  return { kind: "error", message: "MiniMax API rejected the request." };
}

function resolveMiniMaxHost(env: NodeJS.ProcessEnv): {
  host: string;
  explicitCustom: boolean;
} {
  const raw = env.MINIMAX_API_HOST?.trim();
  if (!raw) return { host: "https://api.minimax.io", explicitCustom: false };
  const host = raw.replace(/\/+$/, "");
  return {
    host,
    explicitCustom:
      host !== "https://api.minimax.io" && host !== "https://api.minimaxi.com",
  };
}

export function createMiniMaxProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "minimax",
    label: PROVIDER_LABELS.minimax,
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "minimax",
          fetchLive: async ({ now, signal }) => {
            const token =
              deps.env.MINIMAX_CODING_API_KEY?.trim() ||
              deps.env.MINIMAX_API_KEY?.trim();
            if (!token) {
              return {
                kind: "credentials" as const,
                message: "Missing minimax credentials.",
              };
            }

            const { host, explicitCustom } = resolveMiniMaxHost(deps.env);
            const chinaHost = "https://api.minimaxi.com";
            const endpoint = "/v1/api/openplatform/coding_plan/remains";

            const request = async (baseHost: string) => {
              const timeout = new AbortController();
              const timer = deps.setTimeout(() => timeout.abort(), 5_000);
              const combinedSignal = signal
                ? AbortSignal.any([signal, timeout.signal])
                : timeout.signal;
              return deps
                .fetch(`${baseHost}${endpoint}`, {
                  method: "GET",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "MM-API-Source": "pi-coding-agent",
                  },
                  signal: combinedSignal,
                })
                .finally(() => deps.clearTimeout(timer));
            };

            let res = await request(host);
            let fallbackUsed = false;
            if (
              (res.status === 401 || res.status === 403) &&
              host === "https://api.minimax.io" &&
              !explicitCustom
            ) {
              res = await request(chinaHost);
              fallbackUsed = true;
            }

            if (res.status === 429) {
              return {
                kind: "rate-limited" as const,
                message: "Rate limited.",
                nextRetryAt: now + retryAfterMs(res.headers, now),
              };
            }

            if (res.status === 401 || res.status === 403) {
              return {
                kind: "credentials" as const,
                message: fallbackUsed
                  ? "Invalid minimax credentials (global and China hosts)."
                  : "Invalid minimax credentials.",
              };
            }

            if (!res.ok)
              return {
                kind: "error" as const,
                message: "Live source unavailable.",
              };
            const data = (await res.json().catch(() => undefined)) as
              | Record<string, unknown>
              | undefined;
            if (!data)
              return {
                kind: "error" as const,
                message: "Unsupported response shape.",
              };
            const responseError = miniMaxResponseError(data);
            if (responseError) return responseError;

            const normalized = normalizeMiniMaxWindows(data, now);
            if (normalized.windows.length === 0) {
              return {
                kind: "error" as const,
                message: "Unsupported response shape.",
              };
            }

            const diagnostics = fallbackUsed
              ? ["Retried against api.minimaxi.com."]
              : [];
            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "minimax",
                providerLabel: PROVIDER_LABELS.minimax,
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + PROVIDER_TTLS_MS.minimax,
                balances: [],
                status: "live",
                sourceLabel: "MiniMax coding plan API",
                sourceKind: "live",
                windows: normalized.windows,
                diagnostics,
                planName: normalized.planName,
              },
            };
          },
        },
        input,
      ),
  };
}
