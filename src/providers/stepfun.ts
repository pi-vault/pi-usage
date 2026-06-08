import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { LiveUsageWindow, UsageProviderAdapter } from "../shared/types.ts";
import {
  fetchWithLiveRuntime,
  parseEpochMs,
  retryAfterMs,
  toFinite,
} from "./runtime.ts";

const STEPFUN_BASE_URL = "https://platform.stepfun.com";
const STEPFUN_WEB_ID = "c8a1002d2c457e758785a9979832217c7c0b884c";
const STEPFUN_APP_ID = "10300";
const INVALID_STEPFUN_CREDENTIALS = "Invalid StepFun credentials.";

class StepFunCredentialError extends Error {
  constructor(message = INVALID_STEPFUN_CREDENTIALS) {
    super(message);
    this.name = "StepFunCredentialError";
  }
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

function resolveStepFunAuth(
  env: NodeJS.ProcessEnv,
):
  | { kind: "token"; token: string }
  | { kind: "password"; username: string; password: string }
  | undefined {
  const token = normalizeStepFunToken(env.STEPFUN_TOKEN);
  if (token) return { kind: "token", token };

  const username = cleanEnvValue(env.STEPFUN_USERNAME);
  const password = cleanEnvValue(env.STEPFUN_PASSWORD);
  if (username && password) {
    return { kind: "password", username, password };
  }
  return undefined;
}

function baseHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "oasis-appid": STEPFUN_APP_ID,
    "oasis-platform": "web",
    "oasis-webid": STEPFUN_WEB_ID,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147 Safari/537.36",
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
    usedPercent: clampPercent((1 - left) * 100),
    resetAt,
  };
}

async function readJsonObject(
  res: Response,
): Promise<Record<string, unknown> | undefined> {
  const data = await res.json().catch(() => undefined);
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : undefined;
}

function tokenFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
  const accessToken =
    payload?.accessToken && typeof payload.accessToken === "object"
      ? (payload.accessToken as Record<string, unknown>)
      : undefined;
  return typeof accessToken?.raw === "string" && accessToken.raw.trim()
    ? accessToken.raw.trim()
    : undefined;
}

function isStepFunCredentialError(error: unknown): error is StepFunCredentialError {
  return error instanceof StepFunCredentialError;
}

async function loginStepFun(
  deps: UsageDeps,
  username: string,
  password: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const landing = await deps.fetch(STEPFUN_BASE_URL, {
    method: "GET",
    headers: baseHeaders(),
    signal,
  });
  const ingress = landing.headers
    .get("set-cookie")
    ?.match(/INGRESSCOOKIE=([^;]+)/)?.[1];
  if (!landing.ok || !ingress) {
    throw new StepFunCredentialError();
  }

  const registerRes = await deps.fetch(
    `${STEPFUN_BASE_URL}/passport/proto.api.passport.v1.PassportService/RegisterDevice`,
    {
      method: "POST",
      headers: {
        ...baseHeaders(),
        Cookie: `INGRESSCOOKIE=${ingress}`,
      },
      body: JSON.stringify({ app_id: STEPFUN_APP_ID }),
      signal,
    },
  );
  const anonToken = tokenFromPayload(await readJsonObject(registerRes));
  if (!registerRes.ok || !anonToken) {
    throw new StepFunCredentialError();
  }

  const loginRes = await deps.fetch(
    `${STEPFUN_BASE_URL}/passport/proto.api.passport.v1.PassportService/SignInByPassword`,
    {
      method: "POST",
      headers: {
        ...baseHeaders(),
        Cookie: `Oasis-Token=${anonToken}; Oasis-Webid=${STEPFUN_WEB_ID}; INGRESSCOOKIE=${ingress}`,
      },
      body: JSON.stringify({ username, password }),
      signal,
    },
  );
  const token = tokenFromPayload(await readJsonObject(loginRes));
  if (!loginRes.ok || !token) {
    throw new StepFunCredentialError();
  }

  return token;
}

async function fetchStepFunUsage(
  deps: UsageDeps,
  token: string,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "ok"; windows: LiveUsageWindow[]; planName?: string }
  | { kind: "credentials" }
  | { kind: "rate-limited"; retryAt: number }
  | { kind: "error"; message: string }
> {
  const headers = {
    ...baseHeaders(),
    Cookie: `Oasis-Token=${token}; Oasis-Webid=${STEPFUN_WEB_ID}`,
  };

  const usageRes = await deps.fetch(
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
  const planRes = await deps.fetch(
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
            const timeout = new AbortController();
            const timer = deps.setTimeout(() => timeout.abort(), 5_000);
            const combinedSignal = signal
              ? AbortSignal.any([signal, timeout.signal])
              : timeout.signal;

            try {
              const auth = resolveStepFunAuth(deps.env);
              if (!auth) {
                return {
                  kind: "credentials" as const,
                  message:
                    "Missing StepFun credentials. Set STEPFUN_TOKEN or STEPFUN_USERNAME and STEPFUN_PASSWORD.",
                };
              }

              let token: string;
              try {
                token =
                  auth.kind === "token"
                    ? auth.token
                    : await loginStepFun(
                        deps,
                        auth.username,
                        auth.password,
                        combinedSignal,
                      );
              } catch (error) {
                if (auth.kind === "password" && isStepFunCredentialError(error)) {
                  return {
                    kind: "credentials" as const,
                    message: INVALID_STEPFUN_CREDENTIALS,
                  };
                }
                throw error;
              }

              let usage = await fetchStepFunUsage(deps, token, combinedSignal);
              if (usage.kind === "rate-limited") {
                return {
                  kind: "rate-limited" as const,
                  message: "Rate limited.",
                  nextRetryAt: usage.retryAt,
                };
              }

              if (usage.kind === "credentials" && auth.kind === "password") {
                let retryToken: string;
                try {
                  retryToken = await loginStepFun(
                    deps,
                    auth.username,
                    auth.password,
                    combinedSignal,
                  );
                } catch (error) {
                  if (isStepFunCredentialError(error)) {
                    return {
                      kind: "credentials" as const,
                      message: INVALID_STEPFUN_CREDENTIALS,
                    };
                  }
                  throw error;
                }
                usage = await fetchStepFunUsage(deps, retryToken, combinedSignal);
              }

              if (usage.kind === "credentials") {
                return {
                  kind: "credentials" as const,
                  message:
                    auth.kind === "token"
                      ? "Invalid StepFun token. Refresh STEPFUN_TOKEN."
                      : "Invalid StepFun credentials.",
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
            } finally {
              deps.clearTimeout(timer);
            }
          },
        },
        input,
      ),
  };
}
