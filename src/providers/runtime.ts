import { dirname, join } from "node:path";
import {
  DEFAULT_BACKOFF_MS,
  LOCK_TIMINGS_MS,
  PROVIDER_LABELS,
} from "../constants.ts";
import type { UsageDeps } from "../deps.ts";
import type {
  ProviderFetchOutcome,
  ProviderId,
  ProviderUsageSnapshot,
} from "../types.ts";

export function unavailableSnapshot(
  deps: UsageDeps,
  id: ProviderId,
  diagnostic: string,
): ProviderUsageSnapshot {
  return {
    providerId: id,
    providerLabel: PROVIDER_LABELS[id],
    available: false,
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

export async function readJsonSafe<T>(
  deps: UsageDeps,
  path: string,
): Promise<T | undefined> {
  try {
    return JSON.parse(await deps.readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonAtomic(
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
  while (waitedMs <= LOCK_TIMINGS_MS.wait) {
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
        if (deps.now() - deps.stat(path).mtimeMs > LOCK_TIMINGS_MS.stale) {
          await deps.unlink(path);
          retryImmediately = true;
        }
      } catch (statError) {
        retryImmediately =
          (statError as NodeJS.ErrnoException).code === "ENOENT";
      }
      if (retryImmediately) continue;
      if (waitedMs === LOCK_TIMINGS_MS.wait) return undefined;
      await delay(deps, LOCK_TIMINGS_MS.poll);
      waitedMs = Math.min(
        LOCK_TIMINGS_MS.wait,
        waitedMs + LOCK_TIMINGS_MS.poll,
      );
    }
  }
  return undefined;
}

export function asCachedSnapshot(
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

export function retryAfterMs(headers: Headers, now: number): number {
  const raw = headers.get("retry-after");
  if (!raw) return DEFAULT_BACKOFF_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : DEFAULT_BACKOFF_MS;
}

export function toFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseEpochMs(value: unknown): number | undefined {
  const n = toFinite(value);
  if (!n) return undefined;
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000);
}

export function parseDurationMs(value: unknown): number | undefined {
  const n = toFinite(value);
  if (!n || n <= 0) return undefined;
  return n >= 60_000 ? Math.round(n) : Math.round(n * 1000);
}

type LiveRuntimeConfig = {
  id: Extract<
    ProviderId,
    | "openai-codex"
    | "minimax"
    | "stepfun"
    | "opencode-go"
    | "command-code"
    | "openrouter"
  >;
  fetchLive: (input: {
    cached: ProviderUsageSnapshot | undefined;
    now: number;
    signal?: AbortSignal;
  }) => Promise<
    | { kind: "ok"; snapshot: ProviderUsageSnapshot }
    | { kind: "rate-limited"; message: string; nextRetryAt: number }
    | { kind: "credentials"; message: string }
    | { kind: "error"; message: string }
  >;
};

export async function fetchWithLiveRuntime(
  deps: UsageDeps,
  config: LiveRuntimeConfig,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  const now = deps.now();
  const dir = providerCacheDir(deps);
  const cachePath = join(dir, `${config.id}.json`);
  const lockPath = join(dir, `${config.id}.lock`);
  const backoffPath = join(dir, `${config.id}.backoff.json`);
  const failuresPath = join(dir, `${config.id}.failures.json`);

  let cached = await readJsonSafe<ProviderUsageSnapshot>(deps, cachePath);
  const backoff = await readJsonSafe<{ nextRetryAt: number }>(
    deps,
    backoffPath,
  );
  if (backoff?.nextRetryAt && backoff.nextRetryAt > now) {
    return {
      snapshot: cached
        ? asCachedSnapshot(cached, now, "Rate limited. Retrying later.")
        : unavailableSnapshot(deps, config.id, "Rate limited. Retrying later."),
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
        : unavailableSnapshot(deps, config.id, "Live cache is unavailable."),
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
            config.id,
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

    let result: Awaited<ReturnType<typeof config.fetchLive>>;
    try {
      result = await config.fetchLive({ cached, now, signal: input?.signal });
    } catch {
      result = { kind: "error", message: "Live source unavailable." };
    }
    if (result.kind === "ok") {
      await writeJsonAtomic(deps, cachePath, result.snapshot);
      await Promise.all([
        deps.unlink(backoffPath).catch(() => undefined),
        deps.unlink(failuresPath).catch(() => undefined),
      ]);
      return { snapshot: result.snapshot, shouldWriteCache: true };
    }

    if (result.kind === "rate-limited") {
      await writeJsonAtomic(deps, backoffPath, {
        nextRetryAt: result.nextRetryAt,
      });
      return {
        snapshot: cached
          ? asCachedSnapshot(cached, now, result.message)
          : unavailableSnapshot(deps, config.id, result.message),
        shouldWriteCache: false,
        nextRetryAt: result.nextRetryAt,
      };
    }

    if (result.kind === "credentials") {
      return {
        snapshot: cached
          ? asCachedSnapshot(cached, now, result.message)
          : unavailableSnapshot(deps, config.id, result.message),
        shouldWriteCache: false,
      };
    }

    if (!cached) {
      return {
        snapshot: unavailableSnapshot(deps, config.id, result.message),
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
  } catch {
    return {
      snapshot: cached
        ? asCachedSnapshot(cached, now, "Live cache is unavailable.")
        : unavailableSnapshot(deps, config.id, "Live cache is unavailable."),
      shouldWriteCache: false,
    };
  } finally {
    await lock.release().catch(() => undefined);
  }
}
