import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../../shared/constants.ts";
import type { UsageDeps } from "../../shared/deps.ts";
import type {
  LiveUsageWindow,
  ProviderUsageSnapshot,
  UsageProviderAdapter,
} from "../../shared/types.ts";
import { clampPercent, fetchWithLiveRuntime } from "../runtime.ts";
import {
  fetchDashboard,
  filterCookieHeader,
  normalizeWorkspaceId,
} from "./dashboard-scraper.ts";
import { collectSqliteRows } from "./sqlite-reader.ts";
import {
  anchoredMonthWindow,
  collectPiRows,
  rolling5h,
  utcMondayStart,
} from "./window-calculator.ts";

export {
  filterCookieHeader,
  normalizeWorkspaceId,
} from "./dashboard-scraper.ts";

export async function buildOpenCodeGoSnapshot(
  deps: UsageDeps,
  now: number,
  input?: { signal?: AbortSignal },
): Promise<ProviderUsageSnapshot> {
  const cookie = filterCookieHeader(deps.env.OPENCODE_GO_COOKIE_HEADER ?? "");
  const workspace = normalizeWorkspaceId(
    deps.env.OPENCODE_GO_WORKSPACE_ID ?? "",
  );
  let dashboardDiagnostic: string | undefined;
  if (cookie && workspace) {
    const dash = await fetchDashboard(deps, workspace, cookie, input?.signal);
    if (dash.windows) {
      return {
        providerId: "opencode-go",
        providerLabel: PROVIDER_LABELS["opencode-go"],
        available: true,
        diagnostic: "",
        fetchedAt: now,
        balances: [],
        status: "live",
        sourceLabel: "OpenCode Go dashboard",
        sourceKind: "live",
        windows: dash.windows,
        diagnostics: [],
      };
    }
    dashboardDiagnostic = dash.diagnostic;
  } else if (
    deps.env.OPENCODE_GO_COOKIE_HEADER ||
    deps.env.OPENCODE_GO_WORKSPACE_ID
  ) {
    dashboardDiagnostic = "OpenCode Go dashboard configuration is invalid.";
  } else {
    dashboardDiagnostic = "OpenCode Go dashboard is not configured.";
  }

  const sqlite = await collectSqliteRows(deps);
  const piRows = await collectPiRows(deps);
  const rows = [...sqlite.rows, ...piRows];
  const diagnostics: string[] = [
    "Local estimate may miss usage from other machines and monthly anchor is approximate.",
  ];
  if (dashboardDiagnostic) diagnostics.push(dashboardDiagnostic);
  if (sqlite.diagnostic) diagnostics.push(sqlite.diagnostic);
  if (rows.length === 0) {
    return {
      providerId: "opencode-go",
      providerLabel: PROVIDER_LABELS["opencode-go"],
      available: false,
      diagnostic: "No local OpenCode Go usage rows found.",
      fetchedAt: now,
      balances: [],
      status: "unavailable",
      sourceLabel: "Unavailable",
      sourceKind: "none",
      windows: [],
      diagnostics,
    };
  }

  const anchor = Math.min(...rows.map((r) => r.ts));
  const five = rolling5h(rows, now);
  const weekStart = utcMondayStart(now);
  const weekEnd = weekStart + 7 * 24 * 3600 * 1000;
  const week = rows
    .filter((r) => r.ts >= weekStart && r.ts < weekEnd)
    .reduce((s, r) => s + r.cost, 0);
  const monthWindow = anchoredMonthWindow(now, anchor);
  const month = rows
    .filter((r) => r.ts >= monthWindow.start && r.ts < monthWindow.end)
    .reduce((s, r) => s + r.cost, 0);

  const mk = (
    key: string,
    label: string,
    used: number,
    limit: number,
    resetAt: number,
  ): LiveUsageWindow => ({
    key,
    label,
    used,
    limit,
    unit: "USD",
    usedPercent: Math.floor(clampPercent((used / limit) * 100)),
    resetAt,
  });

  return {
    providerId: "opencode-go",
    providerLabel: PROVIDER_LABELS["opencode-go"],
    available: true,
    diagnostic: "",
    fetchedAt: now,
    balances: [],
    status: "live",
    sourceLabel: "OpenCode/Pi local estimate",
    sourceKind: "live",
    windows: [
      mk("fiveHour", "5h", five.used, 12, five.resetAt),
      mk("weekly", "Weekly", week, 30, weekEnd),
      mk("monthly", "Monthly", month, 60, monthWindow.end),
    ],
    diagnostics,
  };
}

export function createOpenCodeGoProvider(
  deps: UsageDeps,
): UsageProviderAdapter {
  return {
    id: "opencode-go",
    label: PROVIDER_LABELS["opencode-go"],
    strategy: "api",
    fetch: (input) =>
      fetchWithLiveRuntime(
        deps,
        {
          id: "opencode-go",
          fetchLive: async ({ now, signal }) => {
            const snapshot = await buildOpenCodeGoSnapshot(deps, now, {
              signal,
            });
            if (!snapshot.available) {
              return {
                kind: "error" as const,
                message: [snapshot.diagnostic, ...snapshot.diagnostics].join(
                  " ",
                ),
              };
            }
            return {
              kind: "ok" as const,
              snapshot: {
                ...snapshot,
                expiresAt: now + PROVIDER_TTLS_MS["opencode-go"],
              },
            };
          },
        },
        input,
      ),
  };
}
