import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import type { UsageProviderAdapter } from "../shared/types.ts";
import { parseCommandCodeUsage } from "./command-code/usage-parser.ts";
import {
  fetchWithLiveRuntime,
  fetchWithTimeout,
  readJsonObject,
  retryAfterMs,
} from "./runtime.ts";

function normalizeCookieHeader(raw: string | undefined): string | undefined {
  const input = raw?.trim();
  if (!input) return undefined;
  const bare = input.replace(/^cookie\s*:\s*/i, "").trim();
  const cookieNames = [
    "__Secure-commandcode_prod_.session_token",
    "commandcode_prod_.session_token",
    "__Host-commandcode_prod_.session_token",
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

  if (
    parts.length === 1 &&
    !parts[0].includes("=") &&
    !/[\s,]/.test(parts[0])
  ) {
    return `__Secure-commandcode_prod_.session_token=${parts[0]}`;
  }
  return undefined;
}

export function createCommandCodeProvider(
  deps: UsageDeps,
): UsageProviderAdapter {
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
                return await fetchWithTimeout(deps, url, { headers, signal });
              } catch {
                diagnostics.push(`${label} endpoint unavailable.`);
                return undefined;
              }
            };
            const [summaryRes, creditsRes, subsRes] = await Promise.all([
              request(
                "https://api.commandcode.ai/internal/usage/summary",
                "Summary",
              ),
              request(
                "https://api.commandcode.ai/internal/billing/credits",
                "Credits",
              ),
              request(
                "https://api.commandcode.ai/internal/billing/subscriptions",
                "Subscription",
              ),
            ]);

            const readJson = async (
              res: Response | undefined,
              label: string,
            ) => {
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
              const json = await readJsonObject(res);
              if (!json) {
                diagnostics.push(`${label} response shape unsupported.`);
                return undefined;
              }
              return json;
            };

            const summary = await readJson(summaryRes, "Summary");
            const creditsPayload = await readJson(creditsRes, "Credits");
            const subsPayload = await readJson(subsRes, "Subscription");

            const parsed = parseCommandCodeUsage({
              summary,
              credits: creditsPayload,
              subscription: subsPayload,
            });

            if (parsed.windows.length === 0 && parsed.balances.length === 0) {
              const primaryResponses = [summaryRes, creditsRes].filter(
                (res): res is Response => Boolean(res),
              );
              const rateLimited = primaryResponses.find(
                (res) => res.status === 429,
              );
              if (rateLimited) {
                return {
                  kind: "rate-limited" as const,
                  message: "Rate limited.",
                  nextRetryAt: now + retryAfterMs(rateLimited.headers, now),
                };
              }
              if (
                primaryResponses.some(
                  (res) => res.status === 401 || res.status === 403,
                )
              ) {
                return {
                  kind: "credentials" as const,
                  message:
                    "Command Code session expired. Update COMMAND_CODE_COOKIE_HEADER.",
                };
              }
              return {
                kind: "error" as const,
                message: diagnostics[0] ?? "Live source unavailable.",
              };
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
                status: "live",
                sourceLabel: "Command Code web usage API",
                sourceKind: "live",
                diagnostics,
                ...parsed,
              },
            };
          },
        },
        input,
      ),
  };
}
