import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { LiveUsageWindow, UsageProviderAdapter } from "../shared/types.ts";
import {
  clampPercentRounded,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  readJsonObject,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";

const STEPFUN_BASE_URL = "https://platform.stepfun.ai";
const STEPFUN_APP_ID = "10300";

interface StepFunBrowserSession {
  token: string;
  webId: string;
}

function cleanEnvValue(raw: string | undefined): string | undefined {
  let value = raw?.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || undefined;
}

function normalizeStepFunToken(raw: string | undefined): string | undefined {
  const value = cleanEnvValue(raw);
  if (!value) return undefined;
  const match = value.match(/(?:^|;\s*)Oasis-Token=([^;]+)/i);
  return match?.[1]?.trim() || value;
}

function resolveStepFunSession(
  env: NodeJS.ProcessEnv,
): StepFunBrowserSession | undefined {
  const token = normalizeStepFunToken(env.STEPFUN_TOKEN);
  const webId = cleanEnvValue(env.STEPFUN_WEB_ID);
  return token && webId ? { token, webId } : undefined;
}

function baseHeaders(webId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "oasis-appid": STEPFUN_APP_ID,
    "oasis-platform": "web",
    "oasis-webid": webId,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147 Safari/537.36",
  };
}

function buildWindow(
  key: "fiveHour" | "weekly",
  label: "5h" | "Weekly",
  leftRate: unknown,
  resetTime: unknown,
): LiveUsageWindow | undefined {
  const left = toFinite(leftRate);
  const resetAt = parseEpochMs(resetTime);
  if (left == null) return undefined;
  return {
    key,
    label,
    usedPercent: clampPercentRounded((1 - left) * 100),
    resetAt,
  };
}

async function fetchStepFunUsage(
  deps: UsageDeps,
  session: StepFunBrowserSession,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "ok"; windows: LiveUsageWindow[]; planName?: string }
  | { kind: "credentials" }
  | { kind: "rate-limited"; retryAt: number }
  | { kind: "error"; message: string }
> {
  const headers = {
    ...baseHeaders(session.webId),
    Cookie: `Oasis-Token=${session.token}; Oasis-WebId=${session.webId}`,
  };

  const usageRes = await fetchWithTimeout(
    deps,
    `${STEPFUN_BASE_URL}/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`,
    {
      method: "POST",
      headers,
      body: "{}",
      signal,
    },
  );

  if (usageRes.status === 429) {
    return {
      kind: "rate-limited",
      retryAt: deps.now() + retryAfterMs(usageRes.headers, deps.now()),
    };
  }
  if (usageRes.status === 401 || usageRes.status === 403) {
    return { kind: "credentials" };
  }
  if (!usageRes.ok) {
    return { kind: "error", message: "StepFun API unavailable." };
  }

  const payload = await readJsonObject(usageRes);
  if (payload?.status !== 1) {
    return { kind: "error", message: "StepFun response malformed." };
  }

  const windows = [
    buildWindow(
      "fiveHour",
      "5h",
      payload.five_hour_usage_left_rate,
      payload.five_hour_usage_reset_time,
    ),
    buildWindow(
      "weekly",
      "Weekly",
      payload.weekly_usage_left_rate,
      payload.weekly_usage_reset_time,
    ),
  ].filter((window): window is LiveUsageWindow => Boolean(window));

  if (windows.length === 0) {
    return { kind: "error", message: "StepFun response malformed." };
  }

  let planName: string | undefined;
  const planRes = await fetchWithTimeout(
    deps,
    `${STEPFUN_BASE_URL}/api/step.openapi.devcenter.Dashboard/GetStepPlanStatus`,
    {
      method: "POST",
      headers,
      body: "{}",
      signal,
    },
  );
  if (planRes.ok) {
    const planPayload = await readJsonObject(planRes);
    const subscription =
      planPayload?.subscription && typeof planPayload.subscription === "object"
        ? (planPayload.subscription as Record<string, unknown>)
        : undefined;
    if (typeof subscription?.name === "string" && subscription.name.trim()) {
      planName = subscription.name.trim();
    }
  }

  return { kind: "ok", windows, planName };
}

export function createStepFunProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "stepfun",
    label: PROVIDER_LABELS.stepfun,
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "stepfun",
          fetchLive: async ({ now, signal }) => {
            const session = resolveStepFunSession(deps.env);
            if (!session) {
              return {
                kind: "credentials" as const,
                message:
                  "Missing StepFun browser session. Set STEPFUN_TOKEN and STEPFUN_WEB_ID.",
              };
            }

            const usage = await fetchStepFunUsage(deps, session, signal);

            if (usage.kind === "credentials") {
              return {
                kind: "credentials" as const,
                message:
                  "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
              };
            }

            if (usage.kind === "rate-limited") {
              return {
                kind: "rate-limited" as const,
                message: "Rate limited.",
                nextRetryAt: usage.retryAt,
              };
            }

            if (usage.kind === "error") {
              return { kind: "error" as const, message: usage.message };
            }

            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "stepfun",
                providerLabel: PROVIDER_LABELS.stepfun,
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + PROVIDER_TTLS_MS.stepfun,
                balances: [],
                status: "live",
                sourceLabel: "StepFun rate limit API",
                sourceKind: "live",
                windows: usage.windows,
                diagnostics: [],
                planName: usage.planName,
              },
            };
          },
        },
        input,
      ),
  };
}
