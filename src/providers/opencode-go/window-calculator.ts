import type { UsageDeps } from "../../shared/deps.ts";
import { scanOfflineUsage } from "../../core/offline.ts";
import type { CostRow } from "./types.ts";

/** Return the epoch-ms of the most recent Monday 00:00 UTC on or before `now`. */
export function utcMondayStart(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  return midnight - day * 24 * 3600 * 1000;
}

/** Compute the current monthly billing window anchored to the day-of-month of the earliest row. */
export function anchoredMonthWindow(
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

/** Sum cost in the most recent 5-hour bucket and return the bucket's reset time. */
export function rolling5h(
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

/** Collect cost rows from Pi's offline session logs for the opencode-go provider. */
export async function collectPiRows(deps: UsageDeps): Promise<CostRow[]> {
  const result = await scanOfflineUsage(deps);
  return result.turns
    .filter((row) => row.provider === "opencode-go" && row.cost > 0)
    .map((row) => ({ ts: row.timestamp, cost: row.cost }));
}
