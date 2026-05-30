import { dirname, join } from "node:path";
import type { UsageDeps } from "./deps.ts";
import type {
  LiveUsageWindow,
  ProviderFetchOutcome,
  ProviderId,
  ProviderUsageSnapshot,
  UsageProviderAdapter,
} from "./types.ts";

const TTL_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 750;
const LOCK_POLL_MS = 50;
const DEFAULT_BACKOFF_MS = 60_000;

const phaseByProvider: Record<ProviderId, string> = {
  offline: "Phase 2",
  "openai-codex": "Phase 3",
  minimax: "Phase 4",
  "opencode-go": "Phase 5",
  "command-code": "Phase 6",
};

const labelByProvider: Record<ProviderId, string> = {
  offline: "Offline",
  "openai-codex": "OpenAI/Codex",
  minimax: "MiniMax",
  "opencode-go": "OpenCode Go",
  "command-code": "Command Code",
};

function unavailableSnapshot(
  deps: UsageDeps,
  id: ProviderId,
  diagnostic: string,
): ProviderUsageSnapshot {
  return {
    providerId: id,
    providerLabel: labelByProvider[id],
    available: false,
    phase: phaseByProvider[id],
    diagnostic,
    fetchedAt: deps.now(),
    balances: [],
    status: "unavailable",
    sourceLabel: "Unavailable",
    sourceKind: "none",
    windows: [],
    diagnostics: [diagnostic],
  };
}

export function providerCacheDir(deps: UsageDeps): string {
  return join(deps.agentDir(), "cache", "pi-usage", "providers");
}

async function readJsonSafe<T>(
  deps: UsageDeps,
  path: string,
): Promise<T | undefined> {
  try {
    return JSON.parse(await deps.readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(
  deps: UsageDeps,
  path: string,
  data: unknown,
): Promise<void> {
  await deps.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await deps.writeFile(tmp, JSON.stringify(data), "utf8");
    await deps.rename(tmp, path);
  } catch (error) {
    await deps.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

function delay(deps: UsageDeps, ms: number): Promise<void> {
  return new Promise((resolve) => deps.setTimeout(resolve, ms));
}

async function acquireLock(
  deps: UsageDeps,
  path: string,
): Promise<{ release: () => Promise<void> } | undefined> {
  await deps.mkdir(dirname(path), { recursive: true });
  let waitedMs = 0;
  while (waitedMs <= LOCK_WAIT_MS) {
    try {
      const handle = await deps.openExclusive(path);
      return {
        release: async () => {
          await handle.close();
          await deps.unlink(path).catch(() => undefined);
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let retryImmediately = false;
      try {
        if (deps.now() - deps.stat(path).mtimeMs > LOCK_STALE_MS) {
          await deps.unlink(path);
          retryImmediately = true;
        }
      } catch (statError) {
        retryImmediately =
          (statError as NodeJS.ErrnoException).code === "ENOENT";
      }
      if (retryImmediately) continue;
      if (waitedMs === LOCK_WAIT_MS) return undefined;
      await delay(deps, LOCK_POLL_MS);
      waitedMs = Math.min(LOCK_WAIT_MS, waitedMs + LOCK_POLL_MS);
    }
  }
  return undefined;
}

function asCachedSnapshot(
  snapshot: ProviderUsageSnapshot,
  now: number,
  diagnostic?: string,
): ProviderUsageSnapshot {
  const stale = !snapshot.expiresAt || snapshot.expiresAt <= now;
  return {
    ...snapshot,
    status: stale ? "stale" : "cached",
    sourceKind: "cache",
    staleAgeMs: Math.max(0, now - snapshot.fetchedAt),
    diagnostics: diagnostic
      ? [...(snapshot.diagnostics ?? []), diagnostic]
      : (snapshot.diagnostics ?? []),
  };
}

async function resolveCodexAuth(
  deps: UsageDeps,
): Promise<{ token?: string; accountId?: string }> {
  const env = deps.env;
  const token = (
    env.OPENAI_CODEX_OAUTH_TOKEN ||
    env.OPENAI_CODEX_ACCESS_TOKEN ||
    env.CODEX_OAUTH_TOKEN ||
    env.CODEX_ACCESS_TOKEN
  )?.trim();
  const accountId = (
    env.OPENAI_CODEX_ACCOUNT_ID || env.CHATGPT_ACCOUNT_ID
  )?.trim();
  if (token) return { token, accountId };

  const piAuth = await readJsonSafe<Record<string, unknown>>(
    deps,
    join(deps.agentDir(), "auth.json"),
  );
  const piCodex = (piAuth?.["openai-codex"] ?? {}) as Record<string, unknown>;
  if (typeof piCodex.access === "string" && piCodex.access) {
    return {
      token: piCodex.access,
      accountId:
        accountId ||
        (typeof piCodex.accountId === "string" ? piCodex.accountId : undefined),
    };
  }

  const codexAuthPath = join(
    env.CODEX_HOME?.trim() || join(deps.homeDir(), ".codex"),
    "auth.json",
  );
  for (const path of [codexAuthPath]) {
    const auth = await readJsonSafe<Record<string, unknown>>(deps, path);
    if (!auth) continue;
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
      return { token: auth.OPENAI_API_KEY, accountId };
    }
    const tokens = (auth.tokens ?? {}) as Record<string, unknown>;
    if (typeof tokens.access_token === "string" && tokens.access_token) {
      return {
        token: tokens.access_token,
        accountId:
          accountId ||
          (typeof tokens.account_id === "string" ? tokens.account_id : undefined),
      };
    }
  }
  return { accountId };
}

function labelFromSeconds(
  seconds: number | undefined,
  fallback: "Primary" | "Secondary",
): string {
  if (!seconds) return fallback;
  if (seconds < 24 * 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 144 * 3600) return "Day";
  return "Week";
}

function parseWindow(
  raw: Record<string, unknown>,
  key: string,
  label: string,
): LiveUsageWindow {
  const sec =
    typeof raw.limit_window_seconds === "number"
      ? raw.limit_window_seconds
      : undefined;
  const resetAt = typeof raw.reset_at === "number" ? raw.reset_at : undefined;
  return {
    key,
    label,
    usedPercent: typeof raw.used_percent === "number" ? raw.used_percent : 0,
    resetAt,
    windowDurationMins: sec ? Math.round(sec / 60) : undefined,
  };
}

function normalizeWindows(payload: Record<string, unknown>): LiveUsageWindow[] {
  const windows: LiveUsageWindow[] = [];
  const rate = (payload.rate_limit ?? {}) as Record<string, unknown>;
  const primary = (rate.primary_window ?? {}) as Record<string, unknown>;
  const secondary = (rate.secondary_window ?? {}) as Record<string, unknown>;

  if (Object.keys(primary).length > 0) {
    const sec = primary.limit_window_seconds as number | undefined;
    const key =
      sec === 5 * 3600
        ? "fiveHour"
        : sec === 7 * 24 * 3600
          ? "weekly"
          : "primary";
    windows.push(parseWindow(primary, key, labelFromSeconds(sec, "Primary")));
  }
  if (Object.keys(secondary).length > 0) {
    const sec = secondary.limit_window_seconds as number | undefined;
    const key =
      sec === 5 * 3600
        ? "fiveHour"
        : sec === 7 * 24 * 3600
          ? "weekly"
          : "secondary";
    windows.push(
      parseWindow(secondary, key, labelFromSeconds(sec, "Secondary")),
    );
  }

  const additional = Array.isArray(payload.additional_rate_limits)
    ? payload.additional_rate_limits
    : [];
  additional.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    const prefix =
      typeof e.limit_name === "string" && e.limit_name.trim()
        ? e.limit_name.trim()
        : typeof e.metered_feature === "string" && e.metered_feature.trim()
          ? e.metered_feature.trim()
          : "Additional";
    const rateLimit = (e.rate_limit ?? {}) as Record<string, unknown>;
    const p = (rateLimit.primary_window ?? {}) as Record<string, unknown>;
    const s = (rateLimit.secondary_window ?? {}) as Record<string, unknown>;
    if (Object.keys(p).length > 0)
      windows.push(
        parseWindow(
          p,
          `additional:${i}:primary`,
          `${prefix} ${labelFromSeconds(p.limit_window_seconds as number | undefined, "Primary")}`,
        ),
      );
    if (Object.keys(s).length > 0)
      windows.push(
        parseWindow(
          s,
          `additional:${i}:secondary`,
          `${prefix} ${labelFromSeconds(s.limit_window_seconds as number | undefined, "Secondary")}`,
        ),
      );
  });

  windows.push({
    key: "monthly",
    label: "Monthly",
    usedPercent: 0,
    unavailableReason: "Unavailable in Phase 3",
  });
  return windows;
}

function retryAfterMs(headers: Headers, now: number): number {
  const raw = headers.get("retry-after");
  if (!raw) return DEFAULT_BACKOFF_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : DEFAULT_BACKOFF_MS;
}

async function fetchOpenAICodexLive(
  deps: UsageDeps,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  const now = deps.now();
  const dir = providerCacheDir(deps);
  const cachePath = join(dir, "openai-codex.json");
  const lockPath = join(dir, "openai-codex.lock");
  const backoffPath = join(dir, "openai-codex.backoff.json");
  const failuresPath = join(dir, "openai-codex.failures.json");
  let cached = await readJsonSafe<ProviderUsageSnapshot>(deps, cachePath);
  const backoff = await readJsonSafe<{ nextRetryAt: number }>(
    deps,
    backoffPath,
  );

  if (backoff?.nextRetryAt && backoff.nextRetryAt > now) {
    return {
      snapshot: cached
        ? asCachedSnapshot(cached, now, "Rate limited. Retrying later.")
        : unavailableSnapshot(
            deps,
            "openai-codex",
            "Rate limited. Retrying later.",
          ),
      shouldWriteCache: false,
      nextRetryAt: backoff.nextRetryAt,
    };
  }
  if (!input?.force && cached?.expiresAt && cached.expiresAt > now) {
    return { snapshot: asCachedSnapshot(cached, now), shouldWriteCache: false };
  }

  let lock: Awaited<ReturnType<typeof acquireLock>>;
  try {
    lock = await acquireLock(deps, lockPath);
  } catch {
    return {
      snapshot: cached
        ? asCachedSnapshot(cached, now, "Live cache is unavailable.")
        : unavailableSnapshot(
            deps,
            "openai-codex",
            "Live cache is unavailable.",
          ),
      shouldWriteCache: false,
    };
  }
  if (!lock) {
    const latest = await readJsonSafe<ProviderUsageSnapshot>(deps, cachePath);
    return {
      snapshot: latest
        ? asCachedSnapshot(latest, now)
        : unavailableSnapshot(
            deps,
            "openai-codex",
            "Live refresh is already running in another Pi instance.",
          ),
      shouldWriteCache: false,
    };
  }

  try {
    const latest = await readJsonSafe<ProviderUsageSnapshot>(deps, cachePath);
    if (latest) cached = latest;
    if (!input?.force && cached?.expiresAt && cached.expiresAt > deps.now()) {
      return {
        snapshot: asCachedSnapshot(cached, deps.now()),
        shouldWriteCache: false,
      };
    }

    const auth = await resolveCodexAuth(deps);
    if (!auth.token) {
      return {
        snapshot: cached
          ? asCachedSnapshot(
              cached,
              deps.now(),
              "Missing openai-codex credentials.",
            )
          : unavailableSnapshot(
              deps,
              "openai-codex",
              "Missing openai-codex credentials.",
            ),
        shouldWriteCache: false,
      };
    }

    const timeout = new AbortController();
    const timer = deps.setTimeout(() => timeout.abort(), 5_000);
    const signal = input?.signal
      ? AbortSignal.any([input.signal, timeout.signal])
      : timeout.signal;

    const res = await deps
      .fetch("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
          ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
        },
        signal,
      })
      .finally(() => deps.clearTimeout(timer));

    if (res.status === 429) {
      const nextRetryAt = now + retryAfterMs(res.headers, now);
      await writeJsonAtomic(deps, backoffPath, { nextRetryAt });
      return {
        snapshot: cached
          ? asCachedSnapshot(cached, now, "Rate limited.")
          : unavailableSnapshot(deps, "openai-codex", "Rate limited."),
        shouldWriteCache: false,
        nextRetryAt,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        snapshot: cached
          ? asCachedSnapshot(cached, now, "Please log into openai-codex again.")
          : unavailableSnapshot(
              deps,
              "openai-codex",
              "Please log into openai-codex again.",
            ),
        shouldWriteCache: false,
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
    if (!data) throw new Error("malformed json");
    const windows = normalizeWindows(data);
    if (!windows.some((w) => w.key !== "monthly"))
      throw new Error("no parseable windows");

    const snapshot: ProviderUsageSnapshot = {
      providerId: "openai-codex",
      providerLabel: labelByProvider["openai-codex"],
      available: true,
      phase: phaseByProvider["openai-codex"],
      diagnostic: "",
      fetchedAt: now,
      expiresAt: now + TTL_MS,
      balances: [],
      status: "live",
      sourceLabel: "ChatGPT usage API",
      sourceKind: "live",
      windows,
      diagnostics: [],
    };
    await writeJsonAtomic(deps, cachePath, snapshot);
    await Promise.all([
      deps.unlink(backoffPath).catch(() => undefined),
      deps.unlink(failuresPath).catch(() => undefined),
    ]);
    return { snapshot, shouldWriteCache: true };
  } catch {
    if (!cached) {
      return {
        snapshot: unavailableSnapshot(
          deps,
          "openai-codex",
          "Live source unavailable.",
        ),
        shouldWriteCache: false,
      };
    }
    const prior = await readJsonSafe<{ count: number }>(deps, failuresPath);
    const count = (prior?.count ?? 0) + 1;
    await writeJsonAtomic(deps, failuresPath, { count });
    return {
      snapshot: asCachedSnapshot(
        cached,
        now,
        count >= 2 ? "Live refresh failed repeatedly." : undefined,
      ),
      shouldWriteCache: false,
    };
  } finally {
    await lock.release();
  }
}

export function createProviderRegistry(
  deps: UsageDeps,
): UsageProviderAdapter[] {
  const ids: ProviderId[] = [
    "offline",
    "openai-codex",
    "minimax",
    "opencode-go",
    "command-code",
  ];
  return ids.map((id) => ({
    id,
    label: labelByProvider[id],
    strategy: id === "offline" ? "offline" : "api",
    phase: phaseByProvider[id],
    fetch: async (input) => {
      if (id === "openai-codex") return fetchOpenAICodexLive(deps, input);
      return {
        snapshot: unavailableSnapshot(
          deps,
          id,
          `${labelByProvider[id]} will be implemented in ${phaseByProvider[id]}.`,
        ),
        shouldWriteCache: false,
      };
    },
  }));
}
