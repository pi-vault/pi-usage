import { join } from "node:path";
import type { UsageDeps } from "./deps.ts";

export type PeriodKey = "today" | "thisWeek" | "lastWeek" | "allTime";

export interface UsageTurn {
  id: string;
  sessionId: string;
  timestamp: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
}

export interface GroupTotals {
  key: string;
  sessions: Set<string>;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
}

export interface PeriodStats {
  total: GroupTotals;
  providers: Map<string, GroupTotals>;
  modelsByProvider: Map<string, Map<string, GroupTotals>>;
}

export interface OfflineScanResult {
  turns: UsageTurn[];
  periods: Record<PeriodKey, PeriodStats>;
  scannedFiles: number;
}

function mkTotals(key: string): GroupTotals {
  return {
    key,
    sessions: new Set(),
    messages: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    cost: 0,
  };
}

function addToTotals(target: GroupTotals, turn: UsageTurn): void {
  target.sessions.add(turn.sessionId);
  target.messages += 1;
  target.input += turn.input + turn.cacheWrite;
  target.output += turn.output;
  target.cacheRead += turn.cacheRead;
  target.cacheWrite += turn.cacheWrite;
  target.tokens += turn.input + turn.output + turn.cacheWrite;
  target.cost += turn.cost;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const fromNum = Number(value);
    if (Number.isFinite(fromNum)) {
      return fromNum > 1e12 ? fromNum : fromNum * 1000;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fallbackId(turn: Omit<UsageTurn, "id">): string {
  return [
    turn.timestamp,
    turn.provider,
    turn.model,
    turn.input,
    turn.output,
    turn.cacheRead,
    turn.cacheWrite,
    turn.cost,
  ].join("|");
}

function startsOfPeriods(now: number): {
  today: number;
  thisWeek: number;
  lastWeek: number;
} {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const today = d.getTime();
  const weekday = (d.getDay() + 6) % 7;
  const thisWeek = today - weekday * 24 * 60 * 60 * 1000;
  const lastWeek = thisWeek - 7 * 24 * 60 * 60 * 1000;
  return { today, thisWeek, lastWeek };
}

function inPeriod(
  ts: number,
  p: PeriodKey,
  bounds: { today: number; thisWeek: number; lastWeek: number },
): boolean {
  if (p === "allTime") return true;
  if (p === "today") return ts >= bounds.today;
  if (p === "thisWeek") return ts >= bounds.thisWeek;
  return ts >= bounds.lastWeek && ts < bounds.thisWeek;
}

async function* walkJsonlFiles(
  deps: UsageDeps,
  root: string,
): AsyncGenerator<string> {
  let entries: Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }>;
  try {
    entries = (await deps.readDir(root, {
      withFileTypes: true,
    } as never)) as never;
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonlFiles(deps, p);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      yield p;
    }
  }
}

function parseLine(line: string, sessionId: string): UsageTurn | null {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (row?.type !== "message") return null;
  const message = row.message as Record<string, unknown> | undefined;
  if (message?.role !== "assistant") return null;
  const provider = message?.provider;
  const model = message?.model;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (typeof provider !== "string" || typeof model !== "string" || !usage)
    return null;
  const timestamp = parseTimestamp(
    row.timestamp ?? message?.timestamp ?? row.createdAt,
  );
  if (timestamp == null) return null;
  const turnBase = {
    sessionId,
    timestamp,
    provider,
    model,
    input: num(usage.input),
    output: num(usage.output),
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
    tokens: num(usage.totalTokens),
    cost: num(usage.cost),
  };
  const id =
    typeof row.id === "string" && row.id.trim() ? row.id : fallbackId(turnBase);
  return { id, ...turnBase };
}

export async function scanOfflineUsage(
  deps: UsageDeps,
  options?: { refresh?: boolean; shouldCancel?: () => boolean },
): Promise<OfflineScanResult> {
  void options?.refresh;
  const sessionsRoot = join(deps.agentDir(), "sessions");
  const periods: Record<PeriodKey, PeriodStats> = {
    today: {
      total: mkTotals("total"),
      providers: new Map(),
      modelsByProvider: new Map(),
    },
    thisWeek: {
      total: mkTotals("total"),
      providers: new Map(),
      modelsByProvider: new Map(),
    },
    lastWeek: {
      total: mkTotals("total"),
      providers: new Map(),
      modelsByProvider: new Map(),
    },
    allTime: {
      total: mkTotals("total"),
      providers: new Map(),
      modelsByProvider: new Map(),
    },
  };

  if (!deps.exists(sessionsRoot)) {
    return { turns: [], periods, scannedFiles: 0 };
  }

  const seen = new Set<string>();
  const turns: UsageTurn[] = [];
  let scannedFiles = 0;
  let processed = 0;

  for await (const file of walkJsonlFiles(deps, sessionsRoot)) {
    if (options?.shouldCancel?.()) break;
    scannedFiles += 1;
    let content = "";
    try {
      content = await deps.readFile(file, "utf8");
    } catch {
      continue;
    }
    const sessionId = file;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const turn = parseLine(line, sessionId);
      if (!turn) continue;
      if (seen.has(turn.id)) continue;
      seen.add(turn.id);
      turns.push(turn);
      processed += 1;
      if (processed % 500 === 0) {
        await new Promise<void>((resolve) => deps.setTimeout(resolve, 0));
      }
      if (options?.shouldCancel?.()) break;
    }
  }

  const bounds = startsOfPeriods(deps.now());
  for (const turn of turns) {
    for (const key of Object.keys(periods) as PeriodKey[]) {
      if (!inPeriod(turn.timestamp, key, bounds)) continue;
      const p = periods[key];
      addToTotals(p.total, turn);
      let pg = p.providers.get(turn.provider);
      if (!pg) {
        pg = mkTotals(turn.provider);
        p.providers.set(turn.provider, pg);
      }
      addToTotals(pg, turn);

      let models = p.modelsByProvider.get(turn.provider);
      if (!models) {
        models = new Map();
        p.modelsByProvider.set(turn.provider, models);
      }
      let mg = models.get(turn.model);
      if (!mg) {
        mg = mkTotals(turn.model);
        models.set(turn.model, mg);
      }
      addToTotals(mg, turn);
    }
  }

  return { turns, periods, scannedFiles };
}

export interface InsightItem {
  label: string;
  cost: number;
  detail: string;
}

export function buildInsights(turns: UsageTurn[]): InsightItem[] {
  const totalCost = turns.reduce((sum, t) => sum + t.cost, 0);
  const bySession = new Map<string, UsageTurn[]>();
  for (const t of turns) {
    const list = bySession.get(t.sessionId) ?? [];
    list.push(t);
    bySession.set(t.sessionId, list);
  }

  const largeContext = turns
    .filter((t) => t.input + t.output + t.cacheRead + t.cacheWrite > 150_000)
    .reduce((s, t) => s + t.cost, 0);
  const largeUncached = turns
    .filter((t) => t.input > 100_000)
    .reduce((s, t) => s + t.cost, 0);

  const parallelWindowMs = 2 * 60 * 1000;
  const parallelCost = turns
    .filter((turn) => {
      const activeSessions = new Set<string>();
      for (const candidate of turns) {
        if (
          Math.abs(candidate.timestamp - turn.timestamp) <= parallelWindowMs
        ) {
          activeSessions.add(candidate.sessionId);
        }
        if (activeSessions.size >= 4) return true;
      }
      return false;
    })
    .reduce((sum, turn) => sum + turn.cost, 0);

  let longSessionCost = 0;
  for (const list of bySession.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    if (
      list[list.length - 1].timestamp - list[0].timestamp >=
      8 * 60 * 60 * 1000
    ) {
      longSessionCost += list.reduce((s, t) => s + t.cost, 0);
    }
  }

  const top5 = [...bySession.values()]
    .map((list) => list.reduce((s, t) => s + t.cost, 0))
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((a, b) => a + b, 0);

  const pct = (n: number) =>
    totalCost > 0 ? `${((100 * n) / totalCost).toFixed(1)}%` : "0.0%";
  return [
    {
      label: "Parallel sessions",
      cost: parallelCost,
      detail: `${pct(parallelCost)} cost while >=4 active`,
    },
    {
      label: "Large context",
      cost: largeContext,
      detail: `${pct(largeContext)} over 150k context`,
    },
    {
      label: "Large uncached",
      cost: largeUncached,
      detail: `${pct(largeUncached)} over 100k input`,
    },
    {
      label: "Long sessions",
      cost: longSessionCost,
      detail: `${pct(longSessionCost)} from 8h+ sessions`,
    },
    {
      label: "Top-5 concentration",
      cost: top5,
      detail: `${pct(top5)} in top 5 sessions`,
    },
  ];
}
