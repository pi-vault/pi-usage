import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { LiveUsageWindow, UsageProviderAdapter } from "../shared/types.ts";
import {
  fetchWithLiveRuntime,
  parseEpochMs,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";

function finiteFrom(
  row: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = toFinite(row[key]);
    if (value != null) return value;
  }
  return undefined;
}

function objectFrom(
  root: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = root[key];
    if (value && typeof value === "object")
      return value as Record<string, unknown>;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseDateLike(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const at = Date.parse(value.trim());
  return Number.isFinite(at) ? at : undefined;
}

function durationFromFields(row: Record<string, unknown>): number | undefined {
  const msFields = ["remains_time", "remains_ms", "remaining_ms", "ttl_ms"];
  for (const key of msFields) {
    const value = toFinite(row[key]);
    if (value != null && value > 0) return Math.round(value);
  }

  const secFields = [
    "reset_in_sec",
    "reset_in_seconds",
    "remaining_seconds",
    "ttl_seconds",
  ];
  for (const key of secFields) {
    const value = toFinite(row[key]);
    if (value != null && value > 0) return Math.round(value * 1000);
  }

  return undefined;
}

function normalizeTokenWindow(
  key: "fiveHour" | "weekly",
  label: string,
  row: Record<string, unknown>,
  now: number,
): LiveUsageWindow | undefined {
  const total = finiteFrom(row, [
    "total_credits",
    "total_credit",
    "total",
    "quota",
    "limit",
    "total_count",
  ]);
  const usedDirect = finiteFrom(row, [
    "used_credits",
    "used_credit",
    "used",
    "usage",
    "used_count",
  ]);
  const remaining = finiteFrom(row, [
    "remaining_credits",
    "remain_credits",
    "remaining",
    "remains",
    "balance",
    "left",
  ]);

  let used = usedDirect;
  let limit = total;

  if (limit != null && used == null && remaining != null) {
    used = limit - remaining;
  }
  if (limit == null && used != null && remaining != null) {
    limit = used + remaining;
  }

  const resetAt =
    parseEpochMs(
      row.reset_at ??
        row.resetAt ??
        row.resets_at ??
        row.resetsAt ??
        row.end_time ??
        row.expires_at ??
        row.expire_time,
    ) ??
    parseDateLike(
      row.reset_at ??
        row.resetAt ??
        row.resets_at ??
        row.resetsAt ??
        row.end_time ??
        row.expires_at ??
        row.expire_time,
    ) ??
    (() => {
      const duration = durationFromFields(row);
      return duration ? now + duration : undefined;
    })();

  if (limit != null && limit > 0 && used != null) {
    const boundedUsed = Math.max(0, Math.min(limit, used));
    return {
      key,
      label,
      used: boundedUsed,
      limit,
      unit: "credits",
      usedPercent: clampPercent((boundedUsed / limit) * 100),
      resetAt,
    };
  }

  const percent = finiteFrom(row, [
    "used_percent",
    "usage_percent",
    "percent",
    "usedRate",
    "utilization",
  ]);
  if (percent == null) return undefined;

  return {
    key,
    label,
    usedPercent: clampPercent(percent),
    resetAt,
  };
}

function windowFromRemainsRow(
  row: Record<string, unknown>,
  key: "fiveHour" | "weekly",
  now: number,
): LiveUsageWindow | undefined {
  const config =
    key === "fiveHour"
      ? {
          label: "5h",
          totalField: "current_interval_total_count",
          usedField: "current_interval_usage_count",
          resetField: row.end_time,
          remainsField: row.remains_time,
          remainingPercentField: "current_interval_remaining_percent",
        }
      : {
          label: "Weekly",
          totalField: "current_weekly_total_count",
          usedField: "current_weekly_usage_count",
          resetField: row.weekly_end_time,
          remainsField: row.weekly_remains_time,
          remainingPercentField: "current_weekly_remaining_percent",
        };

  const total = toFinite(row[config.totalField]);
  const used = toFinite(row[config.usedField]);
  const resetAt =
    parseEpochMs(config.resetField) ??
    (() => {
      const duration = durationFromFields({
        remains_time: config.remainsField,
      });
      return duration ? now + duration : undefined;
    })();

  if (total != null && total > 0 && used != null) {
    const boundedUsed = Math.max(0, Math.min(total, used));
    return {
      key,
      label: config.label,
      used: boundedUsed,
      limit: total,
      unit: "credits",
      usedPercent: clampPercent((boundedUsed / total) * 100),
      resetAt,
    };
  }

  const remainingPercent = toFinite(row[config.remainingPercentField]);
  if (remainingPercent == null) return undefined;

  return {
    key,
    label: config.label,
    usedPercent: clampPercent(100 - remainingPercent),
    resetAt,
  };
}

function chooseRemainsWindow(
  rows: Record<string, unknown>[],
  key: "fiveHour" | "weekly",
  now: number,
): LiveUsageWindow | undefined {
  const windows = rows
    .map((row) => windowFromRemainsRow(row, key, now))
    .filter((window): window is LiveUsageWindow => Boolean(window));
  if (windows.length === 0) return undefined;

  const withCounts = windows.find(
    (window) => window.limit != null && window.used != null,
  );
  return withCounts ?? windows[0];
}

function normalizeMiniMaxWindows(
  payload: Record<string, unknown>,
  now: number,
): { windows: LiveUsageWindow[]; planName?: string } {
  const root = (
    payload.data && typeof payload.data === "object" ? payload.data : payload
  ) as Record<string, unknown>;
  const rowsRaw = Array.isArray(root.category_remains)
    ? root.category_remains
    : Array.isArray(root.model_remains)
      ? root.model_remains
      : [];
  const rows = rowsRaw.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object",
  );

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

  const fiveHourRow = objectFrom(root, [
    "five_hour",
    "fiveHour",
    "five_hour_remains",
    "fiveHourRemains",
  ]);
  const weeklyRow = objectFrom(root, [
    "weekly",
    "weekly_remains",
    "weeklyRemains",
  ]);

  const windows: LiveUsageWindow[] = [];
  const fiveHour = fiveHourRow
    ? normalizeTokenWindow("fiveHour", "5h", fiveHourRow, now)
    : chooseRemainsWindow(rows, "fiveHour", now);
  const weekly = weeklyRow
    ? normalizeTokenWindow("weekly", "Weekly", weeklyRow, now)
    : chooseRemainsWindow(rows, "weekly", now);

  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

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
            const endpoint = "/v1/token_plan/remains";

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
                sourceLabel: "MiniMax token plan API",
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
