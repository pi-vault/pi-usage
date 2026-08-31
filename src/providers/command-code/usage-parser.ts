import type {
  LiveUsageWindow,
  ProviderUsageSnapshot,
} from "../../shared/types.ts";
import { clampPercent, parseEpochMs, toFinite } from "../runtime.ts";

export interface CommandCodePayloads {
  summary?: Record<string, unknown>;
  credits?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}

export type ParsedCommandCodeUsage = Pick<
  ProviderUsageSnapshot,
  "windows" | "balances" | "planName"
>;

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

function parseTimestamp(value: unknown): number | undefined {
  const epoch = parseEpochMs(value);
  if (epoch != null) return epoch;
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
  const limit = toFinite(record?.cap);
  if (limit == null || limit <= 0) return undefined;
  const used = toFinite(record?.used) ?? 0;
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
): ParsedCommandCodeUsage {
  const credits = asRecord(payloads.credits?.credits);
  const windowLimits =
    asRecord(payloads.credits?.windowLimits) ?? asRecord(credits?.windowLimits);
  const subscription = asRecord(payloads.subscription?.data);

  const windows: LiveUsageWindow[] = [];
  const fiveHour = parseRateWindow(
    windowLimits?.fiveHour,
    "fiveHour",
    "5h",
    5 * 60,
  );
  const weekly = parseRateWindow(
    windowLimits?.weekly,
    "weekly",
    "Weekly",
    7 * 24 * 60,
  );
  if (fiveHour) windows.push(fiveHour);
  if (weekly) windows.push(weekly);

  const balances: ProviderUsageSnapshot["balances"] = [];
  const monthlyCredits = toFinite(credits?.monthlyCredits);
  const purchasedCredits = toFinite(credits?.purchasedCredits) ?? 0;
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

  const totalCount = toFinite(payloads.summary?.totalCount);
  const totalTokens = toFinite(payloads.summary?.totalTokens);
  const totalTokensIn = toFinite(payloads.summary?.totalTokensIn);
  const totalTokensOut = toFinite(payloads.summary?.totalTokensOut);
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

  const planId =
    typeof subscription?.planId === "string" ? subscription.planId : undefined;
  return {
    windows,
    balances,
    planName: planId ? (PLAN_NAMES[planId.toLowerCase()] ?? planId) : undefined,
  };
}