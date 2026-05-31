import { dirname, join } from "node:path";
import type { UsageDeps } from "./deps.ts";
import { buildOpenCodeGoSnapshot } from "./opencode-go.ts";
import type {
  LiveUsageWindow,
  ProviderFetchOutcome,
  ProviderId,
  ProviderUsageSnapshot,
  UsageProviderAdapter,
} from "./types.ts";

const OPENAI_TTL_MS = 5 * 60 * 1000;
const MINIMAX_TTL_MS = 60 * 1000;
const OPENCODE_GO_TTL_MS = 60 * 1000;
const COMMAND_CODE_TTL_MS = 60 * 1000;
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

function retryAfterMs(headers: Headers, now: number): number {
  const raw = headers.get("retry-after");
  if (!raw) return DEFAULT_BACKOFF_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : DEFAULT_BACKOFF_MS;
}

function toFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseEpochMs(value: unknown): number | undefined {
  const n = toFinite(value);
  if (!n) return undefined;
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000);
}

function parseDurationMs(value: unknown): number | undefined {
  const n = toFinite(value);
  if (!n || n <= 0) return undefined;
  // MiniMax returns short durations in seconds and larger values in milliseconds.
  return n >= 60_000 ? Math.round(n) : Math.round(n * 1000);
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
  const auth = await readJsonSafe<Record<string, unknown>>(deps, codexAuthPath);
  if (auth) {
    if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
      return { token: auth.OPENAI_API_KEY, accountId };
    }
    const tokens = (auth.tokens ?? {}) as Record<string, unknown>;
    if (typeof tokens.access_token === "string" && tokens.access_token) {
      return {
        token: tokens.access_token,
        accountId:
          accountId ||
          (typeof tokens.account_id === "string"
            ? tokens.account_id
            : undefined),
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

function normalizeOpenAIWindows(
  payload: Record<string, unknown>,
): LiveUsageWindow[] {
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

type LiveRuntimeConfig = {
  id: Extract<
    ProviderId,
    "openai-codex" | "minimax" | "opencode-go" | "command-code"
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

async function fetchWithLiveRuntime(
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

async function fetchOpenAICodexLive(
  deps: UsageDeps,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  return fetchWithLiveRuntime(
    deps,
    {
      id: "openai-codex",
      fetchLive: async ({ now, signal }) => {
        const auth = await resolveCodexAuth(deps);
        if (!auth.token) {
          return {
            kind: "credentials",
            message: "Missing openai-codex credentials.",
          };
        }

        const timeout = new AbortController();
        const timer = deps.setTimeout(() => timeout.abort(), 5_000);
        const combinedSignal = signal
          ? AbortSignal.any([signal, timeout.signal])
          : timeout.signal;
        const res = await deps
          .fetch("https://chatgpt.com/backend-api/wham/usage", {
            method: "GET",
            headers: {
              Authorization: `Bearer ${auth.token}`,
              Accept: "application/json",
              ...(auth.accountId
                ? { "ChatGPT-Account-Id": auth.accountId }
                : {}),
            },
            signal: combinedSignal,
          })
          .finally(() => deps.clearTimeout(timer));

        if (res.status === 429) {
          return {
            kind: "rate-limited",
            message: "Rate limited.",
            nextRetryAt: now + retryAfterMs(res.headers, now),
          };
        }
        if (res.status === 401 || res.status === 403) {
          return {
            kind: "credentials",
            message: "Please log into openai-codex again.",
          };
        }
        if (!res.ok)
          return { kind: "error", message: "Live source unavailable." };

        const data = (await res.json().catch(() => undefined)) as
          | Record<string, unknown>
          | undefined;
        if (!data)
          return { kind: "error", message: "Live source unavailable." };
        const windows = normalizeOpenAIWindows(data);
        if (!windows.some((w) => w.key !== "monthly")) {
          return { kind: "error", message: "Live source unavailable." };
        }
        return {
          kind: "ok",
          snapshot: {
            providerId: "openai-codex",
            providerLabel: labelByProvider["openai-codex"],
            available: true,
            phase: phaseByProvider["openai-codex"],
            diagnostic: "",
            fetchedAt: now,
            expiresAt: now + OPENAI_TTL_MS,
            balances: [],
            status: "live",
            sourceLabel: "ChatGPT usage API",
            sourceKind: "live",
            windows,
            diagnostics: [],
          },
        };
      },
    },
    input,
  );
}

function normalizeMiniMaxWindows(
  payload: Record<string, unknown>,
  now: number,
): { windows: LiveUsageWindow[]; planName?: string } {
  const root = (
    payload.data && typeof payload.data === "object" ? payload.data : payload
  ) as Record<string, unknown>;
  const fromCategory = Array.isArray(root.category_remains)
    ? root.category_remains
    : [];
  const fromModel = Array.isArray(root.model_remains) ? root.model_remains : [];
  const rows = fromCategory.length > 0 ? fromCategory : fromModel;

  const planRaw = [
    root.current_subscribe_title,
    root.currentSubscribeTitle,
    root.plan_name,
    root.planName,
    root.combo_title,
    root.comboTitle,
    root.current_plan_title,
    root.currentPlanTitle,
    root.package_name,
    root.packageName,
  ].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  const windows: LiveUsageWindow[] = [];
  rows.forEach((entry, idx) => {
    if (!entry || typeof entry !== "object") return;
    const row = entry as Record<string, unknown>;
    const service =
      (typeof row.display_name === "string" && row.display_name.trim()) ||
      (typeof row.category === "string" && row.category.trim()) ||
      (typeof row.model_name === "string" && row.model_name.trim()) ||
      `Service ${idx + 1}`;

    const mk = (
      key: "interval" | "weekly",
      totalField: string,
      remainsField: string,
      resetField: string,
      durationField: string,
      label: string,
    ) => {
      const total = toFinite(row[totalField]);
      const remaining = toFinite(row[remainsField]);
      if (!total || total <= 0 || remaining == null) return;
      const used = Math.max(0, Math.min(total, total - remaining));
      const resetAt = parseEpochMs(row[resetField]);
      const remainsMs = parseDurationMs(row[durationField]);
      windows.push({
        key: `${service}:${key}`,
        label: `${service} ${label}`,
        used,
        limit: total,
        unit: "requests",
        usedPercent: Math.round((used / total) * 100),
        resetAt: resetAt ?? (remainsMs ? now + remainsMs : undefined),
      });
    };

    mk(
      "interval",
      "current_interval_total_count",
      "current_interval_usage_count",
      "end_time",
      "remains_time",
      "Interval",
    );
    mk(
      "weekly",
      "current_weekly_total_count",
      "current_weekly_usage_count",
      "weekly_end_time",
      "weekly_remains_time",
      "Weekly",
    );
  });

  return { windows, planName: planRaw?.trim() };
}

function miniMaxResponseError(
  payload: Record<string, unknown>,
): { kind: "credentials" | "error"; message: string } | undefined {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;
  const base = (
    data?.base_resp && typeof data.base_resp === "object"
      ? data.base_resp
      : payload.base_resp && typeof payload.base_resp === "object"
        ? payload.base_resp
        : undefined
  ) as Record<string, unknown> | undefined;
  const status = toFinite(base?.status_code);
  if (status == null || status === 0) return undefined;

  const message =
    typeof base?.status_msg === "string" ? base.status_msg.toLowerCase() : "";
  if (
    status === 1004 ||
    message.includes("cookie") ||
    message.includes("log in") ||
    message.includes("login") ||
    message.includes("unauthorized") ||
    message.includes("credential")
  ) {
    return { kind: "credentials", message: "Invalid minimax credentials." };
  }
  return { kind: "error", message: "MiniMax API rejected the request." };
}

function resolveMiniMaxHost(env: NodeJS.ProcessEnv): {
  host: string;
  explicitCustom: boolean;
} {
  const raw = env.MINIMAX_API_HOST?.trim();
  if (!raw) return { host: "https://api.minimax.io", explicitCustom: false };
  const host = raw.replace(/\/+$/, "");
  return {
    host,
    explicitCustom:
      host !== "https://api.minimax.io" && host !== "https://api.minimaxi.com",
  };
}

async function fetchOpenCodeGoLive(
  deps: UsageDeps,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  return fetchWithLiveRuntime(
    deps,
    {
      id: "opencode-go",
      fetchLive: async ({ now, signal }) => {
        const snapshot = await buildOpenCodeGoSnapshot(deps, now, { signal });
        if (!snapshot.available) {
          return {
            kind: "error",
            message: [snapshot.diagnostic, ...snapshot.diagnostics].join(" "),
          };
        }
        return {
          kind: "ok",
          snapshot: {
            ...snapshot,
            expiresAt: now + OPENCODE_GO_TTL_MS,
          },
        };
      },
    },
    input,
  );
}

async function fetchMiniMaxLive(
  deps: UsageDeps,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  return fetchWithLiveRuntime(
    deps,
    {
      id: "minimax",
      fetchLive: async ({ now, signal }) => {
        const token =
          deps.env.MINIMAX_CODING_API_KEY?.trim() ||
          deps.env.MINIMAX_API_KEY?.trim();
        if (!token) {
          return {
            kind: "credentials",
            message: "Missing minimax credentials.",
          };
        }

        const { host, explicitCustom } = resolveMiniMaxHost(deps.env);
        const chinaHost = "https://api.minimaxi.com";
        const endpoint = "/v1/api/openplatform/coding_plan/remains";

        const request = async (baseHost: string) => {
          const timeout = new AbortController();
          const timer = deps.setTimeout(() => timeout.abort(), 5_000);
          const combinedSignal = signal
            ? AbortSignal.any([signal, timeout.signal])
            : timeout.signal;
          return deps
            .fetch(`${baseHost}${endpoint}`, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                "MM-API-Source": "pi-coding-agent",
              },
              signal: combinedSignal,
            })
            .finally(() => deps.clearTimeout(timer));
        };

        let res = await request(host);
        let fallbackUsed = false;
        if (
          (res.status === 401 || res.status === 403) &&
          host === "https://api.minimax.io" &&
          !explicitCustom
        ) {
          res = await request(chinaHost);
          fallbackUsed = true;
        }

        if (res.status === 429) {
          return {
            kind: "rate-limited",
            message: "Rate limited.",
            nextRetryAt: now + retryAfterMs(res.headers, now),
          };
        }

        if (res.status === 401 || res.status === 403) {
          return {
            kind: "credentials",
            message: fallbackUsed
              ? "Invalid minimax credentials (global and China hosts)."
              : "Invalid minimax credentials.",
          };
        }

        if (!res.ok)
          return { kind: "error", message: "Live source unavailable." };
        const data = (await res.json().catch(() => undefined)) as
          | Record<string, unknown>
          | undefined;
        if (!data)
          return { kind: "error", message: "Unsupported response shape." };
        const responseError = miniMaxResponseError(data);
        if (responseError) return responseError;

        const normalized = normalizeMiniMaxWindows(data, now);
        if (normalized.windows.length === 0) {
          return { kind: "error", message: "Unsupported response shape." };
        }

        const diagnostics = fallbackUsed
          ? ["Retried against api.minimaxi.com."]
          : [];
        return {
          kind: "ok",
          snapshot: {
            providerId: "minimax",
            providerLabel: labelByProvider.minimax,
            available: true,
            phase: phaseByProvider.minimax,
            diagnostic: "",
            fetchedAt: now,
            expiresAt: now + MINIMAX_TTL_MS,
            balances: [],
            status: "live",
            sourceLabel: "MiniMax coding plan API",
            sourceKind: "live",
            windows: normalized.windows,
            diagnostics,
            planName: normalized.planName,
          },
        };
      },
    },
    input,
  );
}

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

  if (
    parts.length === 1 &&
    !parts[0].includes("=") &&
    !/[\s,]/.test(parts[0])
  ) {
    return `__Secure-commandcode_prod_.session_token=${parts[0]}`;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

async function fetchCommandCodeLive(
  deps: UsageDeps,
  input?: { force?: boolean; signal?: AbortSignal },
): Promise<ProviderFetchOutcome> {
  return fetchWithLiveRuntime(
    deps,
    {
      id: "command-code",
      fetchLive: async ({ now, signal }) => {
        const configuredCookie = deps.env.COMMAND_CODE_COOKIE_HEADER;
        const cookie = normalizeCookieHeader(configuredCookie);
        if (!cookie) {
          return {
            kind: "credentials",
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
            return await deps.fetch(url, {
              headers,
              signal: combinedSignal,
            });
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
        const planId =
          typeof subsData?.planId === "string" ? subsData.planId : undefined;
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
        if (monthlyCredits != null) {
          balances.push({
            label: "Monthly remaining",
            remaining: monthlyCredits,
            unit: "USD",
          });
        }
        if (purchasedCredits > 0) {
          balances.push({
            label: "Purchased remaining",
            remaining: purchasedCredits,
            unit: "USD",
          });
        }
        if (totalCount != null) {
          balances.push({
            label: "Requests",
            remaining: totalCount,
            unit: "count",
          });
        }
        if (totalTokens != null) {
          balances.push({
            label: "Tokens",
            remaining: totalTokens,
            unit: "tok",
          });
        } else if (totalTokensIn != null || totalTokensOut != null) {
          if (totalTokensIn != null)
            balances.push({
              label: "Tokens in",
              remaining: totalTokensIn,
              unit: "tok",
            });
          if (totalTokensOut != null)
            balances.push({
              label: "Tokens out",
              remaining: totalTokensOut,
              unit: "tok",
            });
        }

        if (windows.length === 0 && balances.length === 0) {
          const primaryResponses = [summaryRes, creditsRes].filter(
            (res): res is Response => Boolean(res),
          );
          const rateLimited = primaryResponses.find(
            (res) => res.status === 429,
          );
          if (rateLimited) {
            return {
              kind: "rate-limited",
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
              kind: "credentials",
              message:
                "Command Code session expired. Update COMMAND_CODE_COOKIE_HEADER.",
            };
          }
          return {
            kind: "error",
            message: diagnostics[0] ?? "Live source unavailable.",
          };
        }

        return {
          kind: "ok",
          snapshot: {
            providerId: "command-code",
            providerLabel: labelByProvider["command-code"],
            available: true,
            phase: phaseByProvider["command-code"],
            diagnostic: "",
            fetchedAt: now,
            expiresAt: now + COMMAND_CODE_TTL_MS,
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
  );
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
      if (id === "minimax") return fetchMiniMaxLive(deps, input);
      if (id === "opencode-go") return fetchOpenCodeGoLive(deps, input);
      if (id === "command-code") return fetchCommandCodeLive(deps, input);
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
