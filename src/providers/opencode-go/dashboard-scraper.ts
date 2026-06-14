import type { UsageDeps } from "../../shared/deps.ts";
import type { LiveUsageWindow } from "../../shared/types.ts";
import { clampPercent, fetchWithTimeout } from "../runtime.ts";

/** Extract a valid `wrk_*` workspace ID from a raw string or dashboard URL. */
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

/** Strip a cookie header down to only the `auth` / `__Host-auth` pairs needed for the dashboard. */
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

/** Fetch the OpenCode Go dashboard HTML and extract usage windows. Follows redirects manually. */
export async function fetchDashboard(
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
