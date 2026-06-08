import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { LiveUsageWindow, ProviderUsageSnapshot, UsageProviderAdapter } from "../shared/types.ts";
import { fetchWithLiveRuntime, retryAfterMs, toFinite } from "./runtime.ts";

function normalizeCookieHeader(raw: string | undefined): string | undefined {
  const input = raw?.trim();
  if (!input) return undefined;
  const bare = input.replace(/^cookie\s*:\s*/i, "").trim();
  const cookieNames = [
    "__Secure-commandcode_prod_.session_token",
    "__Host-better-auth.session_token",
    "__Secure-better-auth.session_token",
    "better-auth.session_token",
  ];

  const parts = bare
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const name of cookieNames) {
    const found = parts.find((part) => part.startsWith(`${name}=`));
    if (found?.slice(name.length + 1).trim()) return found;
  }

  if (parts.length === 1 && !parts[0].includes("=") && !/[\s,]/.test(parts[0])) {
    return `__Secure-commandcode_prod_.session_token=${parts[0]}`;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function createCommandCodeProvider(deps: UsageDeps): UsageProviderAdapter {
  return {
    id: "command-code",
    label: PROVIDER_LABELS["command-code"],
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "command-code",
          fetchLive: async ({ now, signal }) => {
            const configuredCookie = deps.env.COMMAND_CODE_COOKIE_HEADER;
            const cookie = normalizeCookieHeader(configuredCookie);
            if (!cookie) {
              return {
                kind: "credentials" as const,
                message: configuredCookie?.trim()
                  ? "Malformed COMMAND_CODE_COOKIE_HEADER."
                  : "Missing COMMAND_CODE_COOKIE_HEADER.",
              };
            }

            const timeout = new AbortController();
            const timer = deps.setTimeout(() => timeout.abort(), 5_000);
            const combinedSignal = signal
              ? AbortSignal.any([signal, timeout.signal])
              : timeout.signal;
            const headers = {
              Cookie: cookie,
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137 Safari/537.36",
              Origin: "https://commandcode.ai",
              Referer: "https://commandcode.ai/",
            };

            const diagnostics: string[] = [];
            const request = async (url: string, label: string) => {
              try {
                return await deps.fetch(url, { headers, signal: combinedSignal });
              } catch {
                diagnostics.push(`${label} endpoint unavailable.`);
                return undefined;
              }
            };
            const [summaryRes, creditsRes, subsRes] = await Promise.all([
              request("https://api.commandcode.ai/internal/usage/summary", "Summary"),
              request("https://api.commandcode.ai/internal/billing/credits", "Credits"),
              request("https://api.commandcode.ai/internal/billing/subscriptions", "Subscription"),
            ]).finally(() => deps.clearTimeout(timer));

            const readJson = async (res: Response | undefined, label: string) => {
              if (!res) return undefined;
              if (res.status === 401 || res.status === 403) {
                diagnostics.push(`${label} rejected the Command Code session.`);
                return undefined;
              }
              if (res.status === 429) {
                diagnostics.push(`${label} endpoint rate limited.`);
                return undefined;
              }
              if (!res.ok) {
                diagnostics.push(`${label} endpoint unavailable.`);
                return undefined;
              }
              const json = await res.json().catch(() => undefined);
              if (!json || typeof json !== "object") {
                diagnostics.push(`${label} response shape unsupported.`);
                return undefined;
              }
              return json as Record<string, unknown>;
            };

            const summary = await readJson(summaryRes, "Summary");
            const creditsPayload = await readJson(creditsRes, "Credits");
            const subsPayload = await readJson(subsRes, "Subscription");

            const totalCost = toFinite(summary?.totalCost);
            const totalCount = toFinite(summary?.totalCount);
            const totalTokens = toFinite(summary?.totalTokens);
            const totalTokensIn = toFinite(summary?.totalTokensIn);
            const totalTokensOut = toFinite(summary?.totalTokensOut);

            const credits = asRecord(creditsPayload?.credits);
            const monthlyCredits = toFinite(credits?.monthlyCredits);
            const purchasedCredits = toFinite(credits?.purchasedCredits) ?? 0;

            const subsData = asRecord(subsPayload?.data);
            const planId = typeof subsData?.planId === "string" ? subsData.planId : undefined;
            const planName =
              planId === "individual-go"
                ? "Go"
                : planId === "individual-pro"
                  ? "Pro"
                  : planId === "individual-max"
                    ? "Max"
                    : planId === "individual-ultra"
                      ? "Ultra"
                      : planId;
            const resetAt =
              typeof subsData?.currentPeriodEnd === "string"
                ? Date.parse(subsData.currentPeriodEnd)
                : undefined;

            const windows: LiveUsageWindow[] = [];
            if (totalCost != null && monthlyCredits != null) {
              const remaining = monthlyCredits + purchasedCredits;
              const limit = totalCost + remaining;
              windows.push({
                key: "current-cycle",
                label: "Current cycle",
                used: totalCost,
                limit,
                unit: "USD",
                usedPercent: limit > 0 ? Math.round((totalCost / limit) * 100) : 0,
                resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
              });
            } else if (totalCost != null) {
              windows.push({
                key: "current-cycle-used",
                label: "Current cycle",
                used: totalCost,
                unit: "USD",
                usedPercent: 0,
                unavailableReason: "Remaining balance unavailable",
              });
            } else if (monthlyCredits != null) {
              windows.push({
                key: "current-cycle-remaining",
                label: "Current cycle",
                unit: "USD",
                usedPercent: 0,
                unavailableReason: "Consumed cost unavailable",
              });
            }

            const balances = [] as ProviderUsageSnapshot["balances"];
            if (monthlyCredits != null) balances.push({ label: "Monthly remaining", remaining: monthlyCredits, unit: "USD" });
            if (purchasedCredits > 0) balances.push({ label: "Purchased remaining", remaining: purchasedCredits, unit: "USD" });
            if (totalCount != null) balances.push({ label: "Requests", remaining: totalCount, unit: "count" });
            if (totalTokens != null) {
              balances.push({ label: "Tokens", remaining: totalTokens, unit: "tok" });
            } else if (totalTokensIn != null || totalTokensOut != null) {
              if (totalTokensIn != null) balances.push({ label: "Tokens in", remaining: totalTokensIn, unit: "tok" });
              if (totalTokensOut != null) balances.push({ label: "Tokens out", remaining: totalTokensOut, unit: "tok" });
            }

            if (windows.length === 0 && balances.length === 0) {
              const primaryResponses = [summaryRes, creditsRes].filter((res): res is Response => Boolean(res));
              const rateLimited = primaryResponses.find((res) => res.status === 429);
              if (rateLimited) {
                return {
                  kind: "rate-limited" as const,
                  message: "Rate limited.",
                  nextRetryAt: now + retryAfterMs(rateLimited.headers, now),
                };
              }
              if (primaryResponses.some((res) => res.status === 401 || res.status === 403)) {
                return {
                  kind: "credentials" as const,
                  message: "Command Code session expired. Update COMMAND_CODE_COOKIE_HEADER.",
                };
              }
              return { kind: "error" as const, message: diagnostics[0] ?? "Live source unavailable." };
            }

            return {
              kind: "ok" as const,
              snapshot: {
                providerId: "command-code",
                providerLabel: PROVIDER_LABELS["command-code"],
                available: true,
                diagnostic: "",
                fetchedAt: now,
                expiresAt: now + PROVIDER_TTLS_MS["command-code"],
                balances,
                status: "live",
                sourceLabel: "Command Code web usage API",
                sourceKind: "live",
                windows,
                diagnostics,
                planName,
              },
            };
          },
        },
        input,
      ),
  };
}
