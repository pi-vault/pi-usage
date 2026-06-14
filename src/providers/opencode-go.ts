import { join, resolve } from "node:path";
import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../shared/constants.ts";
import type { UsageDeps } from "../shared/deps.ts";
import { scanOfflineUsage } from "../core/offline.ts";
import type {
  LiveUsageWindow,
  ProviderUsageSnapshot,
  UsageProviderAdapter,
} from "../shared/types.ts";
import {
  clampPercent,
  fetchWithLiveRuntime,
  fetchWithTimeout,
  parseEpochMs,
  toFinite,
} from "./runtime.ts";

type CostRow = { ts: number; cost: number };

export function normalizeWorkspaceId(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (/^wrk_[a-zA-Z0-9]+$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.hostname !== "opencode.ai")
      return undefined;
    const m = u.pathname.match(/\/workspace\/(wrk_[a-zA-Z0-9]+)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export function filterCookieHeader(raw: string): string | undefined {
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      if (i < 1) return undefined;
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    })
    .filter((p): p is readonly [string, string] => Boolean(p));
  const keep = parts.filter(
    ([k, v]) => (k === "auth" || k === "__Host-auth") && v,
  );
  if (keep.length === 0) return undefined;
  return keep.map(([k, v]) => `${k}=${v}`).join("; ");
}

function addSecs(now: number, sec: number | undefined): number | undefined {
  if (!sec || sec <= 0) return undefined;
  return now + Math.round(sec * 1000);
}

function parseDashboardWindows(
  html: string,
  now: number,
): LiveUsageWindow[] | undefined {
  const normalized = html.replaceAll('\\"', '"').replaceAll("&quot;", '"');
  const parse = (key: string): [number, number] | undefined => {
    const body = normalized.match(
      new RegExp(`["']?${key}["']?\\s*:\\s*\\{([^}]*)\\}`),
    )?.[1];
    if (!body) return undefined;
    const percent = body.match(/["']?usagePercent["']?\s*:\s*([\d.]+)/)?.[1];
    const reset = body.match(/["']?resetInSec["']?\s*:\s*([\d.]+)/)?.[1];
    if (percent == null || reset == null) return undefined;
    return [Number(percent), Number(reset)];
  };
  const rolling = parse("rollingUsage");
  const weekly = parse("weeklyUsage");
  if (!rolling || !weekly) return undefined;
  const monthly = parse("monthlyUsage");
  const windows: LiveUsageWindow[] = [
    {
      key: "fiveHour",
      label: "5h",
      usedPercent: clampPercent(rolling[0]),
      resetAt: addSecs(now, rolling[1]),
    },
    {
      key: "weekly",
      label: "Weekly",
      usedPercent: clampPercent(weekly[0]),
      resetAt: addSecs(now, weekly[1]),
    },
  ];
  if (monthly) {
    windows.push({
      key: "monthly",
      label: "Monthly",
      usedPercent: clampPercent(monthly[0]),
      resetAt: addSecs(now, monthly[1]),
    });
  }
  return windows;
}

async function fetchDashboard(
  deps: UsageDeps,
  workspaceId: string,
  cookieHeader: string,
  signal: AbortSignal | undefined,
): Promise<{ windows?: LiveUsageWindow[]; diagnostic?: string }> {
  let url = `https://opencode.ai/workspace/${workspaceId}/go`;
  const maxRedirects = 3;
  for (let i = 0; i <= maxRedirects; i += 1) {
    let res: Response;
    try {
      res = await fetchWithTimeout(deps, url, {
        method: "GET",
        redirect: "manual",
        headers: {
          Cookie: cookieHeader,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/137 Safari/537.36",
        },
        signal,
      });
    } catch {
      return { diagnostic: "OpenCode Go dashboard network unavailable." };
    }

    if (res.status === 401 || res.status === 403) {
      return { diagnostic: "OpenCode Go dashboard authentication failed." };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc)
        return { diagnostic: "OpenCode Go dashboard redirect invalid." };
      const next = new URL(loc, url);
      if (next.protocol !== "https:" || next.hostname !== "opencode.ai") {
        return { diagnostic: "OpenCode Go dashboard redirect blocked." };
      }
      if (i === maxRedirects) {
        return { diagnostic: "OpenCode Go dashboard redirect limit reached." };
      }
      url = next.toString();
      continue;
    }

    if (!res.ok) return { diagnostic: "OpenCode Go dashboard unavailable." };
    const html = await res.text().catch(() => "");
    if (html.includes("Sign in") || html.includes("sign in")) {
      return { diagnostic: "OpenCode Go dashboard signed out." };
    }
    const windows = parseDashboardWindows(html, deps.now());
    if (!windows) {
      return { diagnostic: "OpenCode Go dashboard payload unsupported." };
    }
    return { windows };
  }
  return { diagnostic: "OpenCode Go dashboard unavailable." };
}

async function resolveOpencodeDbPath(
  deps: UsageDeps,
): Promise<{ path?: string; diagnostic?: string }> {
  const dataDir = join(
    deps.env.XDG_DATA_HOME?.trim() || join(deps.homeDir(), ".local/share"),
    "opencode",
  );
  const override = deps.env.OPENCODE_DB?.trim();
  if (override) {
    if (override === ":memory:") {
      return { diagnostic: "OPENCODE_DB=:memory: is unsupported." };
    }
    return {
      path: override.startsWith("/") ? override : resolve(dataDir, override),
    };
  }
  const stable = join(dataDir, "opencode.db");
  if (deps.exists(stable)) return { path: stable };
  let files: string[] = [];
  try {
    const entries = (await deps.readDir(dataDir, {
      withFileTypes: true,
    } as never)) as unknown as Array<{ name: string; isFile: () => boolean }>;
    files = entries
      .filter((e) => e.isFile() && /^opencode-.*\.db$/.test(e.name))
      .map((e) => join(dataDir, e.name));
  } catch {
    return { diagnostic: "OpenCode DB not found." };
  }
  if (files.length === 1) return { path: files[0] };
  if (files.length > 1) {
    return { diagnostic: "Multiple OpenCode DB files found. Set OPENCODE_DB." };
  }
  return { diagnostic: "OpenCode DB not found." };
}

async function collectSqliteRows(
  deps: UsageDeps,
): Promise<{ rows: CostRow[]; diagnostic?: string }> {
  const resolved = await resolveOpencodeDbPath(deps);
  if (!resolved.path) return { rows: [], diagnostic: resolved.diagnostic };
  let db: ReturnType<UsageDeps["openReadonlySqlite"]> | undefined;
  try {
    db = deps.openReadonlySqlite(resolved.path);
    const hasTable = (name: string) =>
      Boolean(
        db
          ?.prepare(
            "select name from sqlite_master where type='table' and name=?",
          )
          .get(name),
      );
    const parseData = (value: unknown): Record<string, unknown> | undefined => {
      if (typeof value !== "string") return undefined;
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    };
    let malformed = false;

    if (hasTable("session_message")) {
      const current = db
        .prepare(
          "select data, time_created from session_message where type='assistant'",
        )
        .all() as Array<Record<string, unknown>>;
      const rows: CostRow[] = [];
      for (const row of current) {
        const data = parseData(row.data);
        if (!data) {
          malformed = true;
          continue;
        }
        const model = data.model as Record<string, unknown> | undefined;
        const cost = toFinite(data.cost);
        const time = data.time as Record<string, unknown> | undefined;
        const ts = parseEpochMs(time?.created ?? row.time_created);
        if (model?.providerID === "opencode-go" && cost && cost > 0 && ts) {
          rows.push({ ts, cost });
        }
      }
      if (rows.length > 0) {
        return {
          rows,
          diagnostic: malformed
            ? "Skipped malformed OpenCode SQLite rows."
            : undefined,
        };
      }
    }

    if (!hasTable("message")) {
      return { rows: [], diagnostic: "OpenCode SQLite schema unsupported." };
    }
    const legacy = db
      .prepare("select id, data, time_created from message")
      .all() as Array<Record<string, unknown>>;
    const direct: CostRow[] = [];
    const partFallback = new Map<string, CostRow>();
    for (const row of legacy) {
      const data = parseData(row.data);
      if (!data) {
        malformed = true;
        continue;
      }
      const time = data.time as Record<string, unknown> | undefined;
      const ts = parseEpochMs(time?.created ?? row.time_created);
      if (
        data.role !== "assistant" ||
        data.providerID !== "opencode-go" ||
        !ts
      ) {
        continue;
      }
      const cost = toFinite(data.cost);
      if (cost && cost > 0) {
        direct.push({ ts, cost });
      } else if (typeof row.id === "string") {
        partFallback.set(row.id, { ts, cost: 0 });
      }
    }
    if (partFallback.size > 0 && hasTable("part")) {
      const parts = db
        .prepare("select message_id, data from part")
        .all() as Array<Record<string, unknown>>;
      for (const row of parts) {
        if (
          typeof row.message_id !== "string" ||
          !partFallback.has(row.message_id)
        ) {
          continue;
        }
        const data = parseData(row.data);
        if (!data) {
          malformed = true;
          continue;
        }
        const cost = toFinite(data.cost);
        if (data.type === "step-finish" && cost && cost > 0) {
          const fallback = partFallback.get(row.message_id);
          if (fallback) fallback.cost += cost;
        }
      }
    }
    const rows = [
      ...direct,
      ...[...partFallback.values()].filter((row) => row.cost > 0),
    ];
    return {
      rows,
      diagnostic:
        malformed && rows.length > 0
          ? "Skipped malformed OpenCode SQLite rows."
          : undefined,
    };
  } catch {
    return { rows: [], diagnostic: "OpenCode SQLite unavailable." };
  } finally {
    db?.close();
  }
}

async function collectPiRows(deps: UsageDeps): Promise<CostRow[]> {
  const result = await scanOfflineUsage(deps);
  return result.turns
    .filter((row) => row.provider === "opencode-go" && row.cost > 0)
    .map((row) => ({ ts: row.timestamp, cost: row.cost }));
}

function utcMondayStart(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  return midnight - day * 24 * 3600 * 1000;
}

function anchoredMonthWindow(
  now: number,
  anchor: number,
): { start: number; end: number } {
  const a = new Date(anchor);
  const n = new Date(now);
  const day = a.getUTCDate();
  const hh = a.getUTCHours();
  const mm = a.getUTCMinutes();
  const ss = a.getUTCSeconds();
  const ms = a.getUTCMilliseconds();
  const build = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(day, last), hh, mm, ss, ms);
  };
  let start = build(n.getUTCFullYear(), n.getUTCMonth());
  if (start > now)
    start = build(
      n.getUTCMonth() === 0 ? n.getUTCFullYear() - 1 : n.getUTCFullYear(),
      n.getUTCMonth() === 0 ? 11 : n.getUTCMonth() - 1,
    );
  const s = new Date(start);
  const end = build(
    s.getUTCMonth() === 11 ? s.getUTCFullYear() + 1 : s.getUTCFullYear(),
    s.getUTCMonth() === 11 ? 0 : s.getUTCMonth() + 1,
  );
  return { start, end };
}

function rolling5h(
  rows: CostRow[],
  now: number,
): { used: number; resetAt: number } {
  if (rows.length === 0) return { used: 0, resetAt: now + 5 * 3600 * 1000 };
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  let bucketStart = sorted[0].ts;
  let bucketSum = 0;
  for (const row of sorted) {
    if (row.ts > bucketStart + 5 * 3600 * 1000) {
      bucketStart = row.ts;
      bucketSum = 0;
    }
    bucketSum += row.cost;
  }
  const end = bucketStart + 5 * 3600 * 1000;
  if (end < now) return { used: 0, resetAt: now + 5 * 3600 * 1000 };
  return { used: bucketSum, resetAt: end };
}

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
