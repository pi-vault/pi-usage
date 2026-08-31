import type { LiveUsageWindow, ProviderUsageSnapshot } from "../../shared/types.ts";
import { clampPercent, parseEpochMs, toFinite } from "../runtime.ts";

export interface CommandCodePayloads {
  summary?: Record<string, unknown>;
  credits?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

const PLAN_NAMES: Record<string, string> = {
  "individual-go": "Go",
  "individual-goat": "GOAT",
  "individual-pro": "Pro",
  "individual-pro-v1": "Pro",
  "individual-max": "Max",
  "individual-ultra": "Ultra",
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function strictFinite(value: unknown): number | undefined {
  return typeof value === "string" && !value.trim() ? undefined : toFinite(value);
}

function parseTimestamp(value: unknown): number | undefined {
  const numeric = strictFinite(value);
  if (numeric != null) return numeric > 0 ? parseEpochMs(numeric) : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRateWindow(
  value: unknown,
  key: string,
  label: string,
  windowDurationMins: number,
): LiveUsageWindow | undefined {
  const record = asRecord(value);
  const limit = strictFinite(record?.cap);
  if (limit == null || limit <= 0) return undefined;
  const used = strictFinite(record?.used) ?? 0;
  return {
    key,
    label,
    usedPercent: clampPercent((used / limit) * 100),
    resetAt: parseTimestamp(record?.resetAt),
    windowDurationMins,
  };
}

export function parseCommandCodeUsage(
  payloads: CommandCodePayloads,
): Pick<ProviderUsageSnapshot, "windows" | "balances" | "planName"> {
  const credits = asRecord(payloads.credits?.credits);
  const windowLimits = asRecord(payloads.credits?.windowLimits) ?? asRecord(credits?.windowLimits);
  const subscription = asRecord(payloads.subscription?.data);

  const windows: LiveUsageWindow[] = [];
  const fiveHour = parseRateWindow(windowLimits?.fiveHour, "fiveHour", "5h", 5 * 60);
  const weekly = parseRateWindow(windowLimits?.weekly, "weekly", "Weekly", 7 * 24 * 60);
  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  const balances: ProviderUsageSnapshot["balances"] = [];
  const monthlyCredits = strictFinite(credits?.monthlyCredits);
  const purchasedCredits = strictFinite(credits?.purchasedCredits) ?? 0;
  if (monthlyCredits != null) {
    balances.push({
      label: "Monthly remaining",
      remaining: monthlyCredits,
      unit: "USD",
    });
  }
  if (purchasedCredits > 0) {
    balances.push({
      label: "Purchased remaining",
      remaining: purchasedCredits,
      unit: "USD",
    });
  }

  const totalCount = strictFinite(payloads.summary?.totalCount);
  const totalTokens = strictFinite(payloads.summary?.totalTokens);
  const totalTokensIn = strictFinite(payloads.summary?.totalTokensIn);
  const totalTokensOut = strictFinite(payloads.summary?.totalTokensOut);
  if (totalCount != null) {
    balances.push({ label: "Requests", remaining: totalCount, unit: "count" });
  }
  if (totalTokens != null) {
    balances.push({ label: "Tokens", remaining: totalTokens, unit: "tok" });
  } else {
    if (totalTokensIn != null) {
      balances.push({
        label: "Tokens in",
        remaining: totalTokensIn,
        unit: "tok",
      });
    }
    if (totalTokensOut != null) {
      balances.push({
        label: "Tokens out",
        remaining: totalTokensOut,
        unit: "tok",
      });
    }
  }

  const planId = typeof subscription?.planId === "string" ? subscription.planId : undefined;
  return {
    windows,
    balances,
    planName: planId ? (PLAN_NAMES[planId.toLowerCase()] ?? planId) : undefined,
  };
}
