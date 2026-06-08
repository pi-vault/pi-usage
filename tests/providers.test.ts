import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_TTLS_MS } from "../src/constants.ts";
import { createDefaultDeps, type UsageDeps } from "../src/deps.ts";
import { detectProviderFromModel } from "../src/index.ts";
import { createProviderRegistry, providerCacheDir } from "../src/providers.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-live-"));
}

function createLiveDeps(
  root: string,
  now: () => number,
  fetchImpl: UsageDeps["fetch"],
  env?: Record<string, string>,
): UsageDeps {
  const deps = createDefaultDeps();
  return {
    ...deps,
    agentDir: () => root,
    now,
    fetch: fetchImpl,
    env: { ...env },
  };
}

function openAICodexProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "openai-codex",
  );
  if (!provider) throw new Error("missing openai-codex provider");
  return provider;
}

function minimaxProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "minimax",
  );
  if (!provider) throw new Error("missing minimax provider");
  return provider;
}

function stepfunProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "stepfun",
  );
  if (!provider) throw new Error("missing stepfun provider");
  return provider;
}

function commandCodeProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "command-code",
  );
  if (!provider) throw new Error("missing command-code provider");
  return provider;
}

function opencodeGoProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "opencode-go",
  );
  if (!provider) throw new Error("missing opencode-go provider");
  return provider;
}

function openrouterProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "openrouter",
  );
  if (!provider) throw new Error("missing openrouter provider");
  return provider;
}

describe("provider detection", () => {
  it("prefers explicit providers and only falls back when provider is empty", () => {
    expect(
      detectProviderFromModel({ provider: "openai-codex", id: "anything" }),
    ).toBe("openai-codex");
    expect(
      detectProviderFromModel({ provider: "openrouter", id: "anything" }),
    ).toBe("openrouter");
    expect(
      detectProviderFromModel({ provider: "minimax", id: "anything" }),
    ).toBe("minimax");
    expect(
      detectProviderFromModel({ provider: "opencode-go", id: "anything" }),
    ).toBe("opencode-go");
    expect(
      detectProviderFromModel({ provider: "stepfun", id: "anything" }),
    ).toBe("stepfun");
    expect(
      detectProviderFromModel({
        provider: "amazon-bedrock",
        id: "openai-codex-proxy",
      }),
    ).toBeUndefined();
    expect(detectProviderFromModel({ provider: "", id: "gpt-5-codex" })).toBe(
      "openai-codex",
    );
    expect(detectProviderFromModel({ provider: "", id: "minimax-m2" })).toBe(
      "minimax",
    );
    expect(detectProviderFromModel({ provider: "", id: "stepfun-pro" })).toBe(
      "stepfun",
    );
    expect(
      detectProviderFromModel({ provider: "", id: "opencode-go/glm-5" }),
    ).toBe("opencode-go");
    expect(
      detectProviderFromModel({ provider: "command-code", id: "anything" }),
    ).toBe("command-code");
    expect(
      detectProviderFromModel({ provider: "commandcode", id: "anything" }),
    ).toBe("command-code");
    // OpenRouter should only be detected from provider field, not id/name
    expect(
      detectProviderFromModel({ provider: "", id: "openrouter-model" }),
    ).toBeUndefined();
    expect(
      detectProviderFromModel({
        provider: "amazon-bedrock",
        id: "opencode-go-proxy",
      }),
    ).toBeUndefined();
  });
});

describe("provider registry", () => {
  it("keeps provider order and strategies aligned with phase 8", () => {
    const root = mkTmp();
    const providers = createProviderRegistry(
      createLiveDeps(root, () => 1_000, vi.fn(), {}),
    );

    expect(
      providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        strategy: provider.strategy,
      })),
    ).toEqual([
      { id: "offline", label: "Offline", strategy: "offline" },
      {
        id: "openai-codex",
        label: "OpenAI/Codex",
        strategy: "api",
      },
      { id: "minimax", label: "MiniMax", strategy: "api" },
      { id: "stepfun", label: "StepFun", strategy: "api" },
      { id: "opencode-go", label: "OpenCode Go", strategy: "api" },
      { id: "command-code", label: "Command Code", strategy: "api" },
      { id: "openrouter", label: "OpenRouter", strategy: "api" },
    ]);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("OpenAI Codex provider", () => {
  it("fetches usage via HTTP and caches it", async () => {
    const root = mkTmp();
    let now = 1_000;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 25,
                reset_at: 1_780_000_000,
                limit_window_seconds: 5 * 3600,
              },
              secondary_window: {
                used_percent: 50,
                reset_at: 1_780_086_400_000,
                limit_window_seconds: 7 * 24 * 3600,
              },
            },
            additional_rate_limits: [
              {
                limit_name: "Codex Spark",
                rate_limit: {
                  primary_window: {
                    used_percent: 10,
                    limit_window_seconds: 5 * 3600,
                  },
                },
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const provider = openAICodexProvider(
      createLiveDeps(root, () => now, fetchImpl, {
        OPENAI_CODEX_ACCESS_TOKEN: "t",
      }),
    );
    const live = await provider.fetch();
    expect(live.snapshot.status).toBe("live");
    expect(live.snapshot.sourceLabel).toBe("ChatGPT usage API");
    expect(live.snapshot.windows.some((w) => w.key === "fiveHour")).toBe(true);
    expect(live.snapshot.windows.some((w) => w.key === "weekly")).toBe(true);
    expect(
      live.snapshot.windows.find((w) => w.key.startsWith("additional:"))?.label,
    ).toBe("Codex Spark 5h");
    expect(
      live.snapshot.windows.find((w) => w.key === "fiveHour")?.resetAt,
    ).toBe(1_780_000_000_000);
    expect(live.snapshot.windows.find((w) => w.key === "weekly")?.resetAt).toBe(
      1_780_086_400_000,
    );
    expect(live.snapshot.windows.some((w) => w.key === "monthly")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 1_000;
    const cached = await provider.fetch();
    expect(cached.snapshot.status).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("normalizes epoch-second reset_at to millisecond resetAt", async () => {
    const root = mkTmp();
    const provider = openAICodexProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 25,
                  reset_at: 1_780_000_000,
                  limit_window_seconds: 5 * 3600,
                },
              },
            }),
            { status: 200 },
          ),
        { OPENAI_CODEX_ACCESS_TOKEN: "t" },
      ),
    );

    const resetAt = (await provider.fetch()).snapshot.windows[0]?.resetAt;
    expect(resetAt).toBe(1_780_000_000_000);
    expect(new Date(resetAt ?? 0).getUTCFullYear()).toBeGreaterThan(2020);
    rmSync(root, { recursive: true, force: true });
  });

  it("persists Retry-After backoff and preserves cached data", async () => {
    const root = mkTmp();
    let now = 1_000;
    let limited = false;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async () => {
      if (limited)
        return new Response("", {
          status: 429,
          headers: { "retry-after": "9" },
        });
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 10,
              limit_window_seconds: 5 * 3600,
            },
          },
        }),
        { status: 200 },
      );
    });
    const deps = createLiveDeps(root, () => now, fetchImpl, {
      OPENAI_CODEX_ACCESS_TOKEN: "t",
    });
    const provider = openAICodexProvider(deps);
    await provider.fetch();

    limited = true;
    now += 30 * 60 * 1000 + 1;
    const rateLimited = await provider.fetch();
    expect(rateLimited.nextRetryAt).toBe(now + 9_000);
    expect(rateLimited.snapshot.status).toBe("stale");

    const backoff = JSON.parse(
      readFileSync(
        join(providerCacheDir(deps), "openai-codex.backoff.json"),
        "utf8",
      ),
    ) as { nextRetryAt: number };
    expect(backoff.nextRetryAt).toBe(now + 9_000);
    rmSync(root, { recursive: true, force: true });
  });

  it("supports HTTP-date Retry-After", async () => {
    const root = mkTmp();
    const now = Date.parse("2026-05-30T20:00:00Z");
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(
      async () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": "Sat, 30 May 2026 20:00:09 GMT" },
        }),
    );
    const deps = createLiveDeps(root, () => now, fetchImpl, {
      OPENAI_CODEX_ACCESS_TOKEN: "t",
    });

    expect((await openAICodexProvider(deps).fetch()).nextRetryAt).toBe(
      now + 9_000,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it.each([401, 403])("returns login diagnostic on HTTP %s", async (status) => {
    const root = mkTmp();
    const provider = openAICodexProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () => new Response("", { status }),
        { OPENAI_CODEX_ACCESS_TOKEN: "t" },
      ),
    );
    const res = await provider.fetch();
    expect(res.snapshot.diagnostics.join(" ")).toContain(
      "log into openai-codex",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers env credentials and account ID over Pi auth", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "auth.json"),
      JSON.stringify({
        "openai-codex": { access: "pi-token", accountId: "pi-account" },
      }),
    );
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer env-token");
      expect(headers.get("chatgpt-account-id")).toBe("env-account");
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 },
          },
        }),
        { status: 200 },
      );
    });
    const deps = createLiveDeps(root, () => 1_000, fetchImpl, {
      OPENAI_CODEX_ACCESS_TOKEN: " env-token ",
      OPENAI_CODEX_ACCOUNT_ID: " env-account ",
    });

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe(
      "live",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("reads credentials from Pi auth", async () => {
    const root = mkTmp();
    writeFileSync(
      join(root, "auth.json"),
      JSON.stringify({
        "openai-codex": { access: "pi-token", accountId: "pi-account" },
      }),
    );
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer pi-token");
      expect(headers.get("chatgpt-account-id")).toBe("pi-account");
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 },
          },
        }),
        { status: 200 },
      );
    });

    expect(
      (
        await openAICodexProvider(
          createLiveDeps(root, () => 1_000, fetchImpl),
        ).fetch()
      ).snapshot.status,
    ).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back from malformed Pi auth to CODEX_HOME auth", async () => {
    const root = mkTmp();
    const codexHome = join(root, "codex");
    mkdirSync(codexHome);
    writeFileSync(join(root, "auth.json"), "{");
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "codex-token", account_id: "codex-account" },
      }),
    );
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer codex-token");
      expect(headers.get("chatgpt-account-id")).toBe("codex-account");
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 },
          },
        }),
        { status: 200 },
      );
    });
    const deps = createLiveDeps(root, () => 1_000, fetchImpl, {
      CODEX_HOME: codexHome,
    });

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe(
      "live",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to default Codex auth under homeDir", async () => {
    const root = mkTmp();
    const home = join(root, "home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "default-codex-token" }),
    );
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer default-codex-token",
      );
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 },
          },
        }),
        { status: 200 },
      );
    });
    const deps = {
      ...createLiveDeps(root, () => 1_000, fetchImpl, { CODEX_HOME: "" }),
      homeDir: () => home,
    };

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe(
      "live",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("recovers stale locks before fetching", async () => {
    const root = mkTmp();
    const now = Date.now();
    const deps = createLiveDeps(
      root,
      () => now,
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 1,
                limit_window_seconds: 5 * 3600,
              },
            },
          }),
          { status: 200 },
        ),
      { OPENAI_CODEX_ACCESS_TOKEN: "t" },
    );
    const dir = providerCacheDir(deps);
    await deps.mkdir(dir, { recursive: true });
    const lockPath = join(dir, "openai-codex.lock");
    writeFileSync(lockPath, "", "utf8");
    utimesSync(lockPath, new Date(now - 10_000), new Date(now - 10_000));
    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe(
      "live",
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("Command Code provider", () => {
  it("uses cookie auth and parses aggregate usage", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe(
        "__Secure-commandcode_prod_.session_token=abc",
      );
      if (url.toString().includes("/usage/summary")) {
        return new Response(
          JSON.stringify({
            totalCost: 4.2888,
            totalCount: 42,
            totalTokens: 1234,
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/billing/credits")) {
        return new Response(
          JSON.stringify({
            credits: { monthlyCredits: 5.7112, purchasedCredits: 0 },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            planId: "individual-go",
            currentPeriodEnd: "2026-06-01T00:00:00Z",
          },
        }),
        { status: 200 },
      );
    });

    const snapshot = (
      await commandCodeProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, {
          COMMAND_CODE_COOKIE_HEADER: "abc",
        }),
      ).fetch()
    ).snapshot;
    expect(snapshot.status).toBe("live");
    expect(snapshot.planName).toBe("Go");
    expect(snapshot.windows[0].key).toBe("current-cycle");
    expect(snapshot.windows[0].label).toBe("Current cycle");
    expect(snapshot.windows[0].limit).toBeCloseTo(10);
    expect(snapshot.sourceLabel).toContain("Command Code");
    rmSync(root, { recursive: true, force: true });
  });

  it("returns credential diagnostic when cookie is missing", async () => {
    const root = mkTmp();
    const snapshot = (
      await commandCodeProvider(
        createLiveDeps(root, () => 1_000, vi.fn()),
      ).fetch()
    ).snapshot;
    expect(snapshot.available).toBe(false);
    expect(snapshot.diagnostics.join(" ")).toContain(
      "Missing COMMAND_CODE_COOKIE_HEADER",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps aggregate usage when subscription enrichment fails", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/usage/summary")) {
        return new Response(JSON.stringify({ totalCost: 4, totalCount: 2 }), {
          status: 200,
        });
      }
      if (url.toString().includes("/billing/credits")) {
        return new Response(
          JSON.stringify({ credits: { monthlyCredits: 6 } }),
          { status: 200 },
        );
      }
      throw new Error("subscription endpoint unavailable");
    });

    const snapshot = (
      await commandCodeProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, {
          COMMAND_CODE_COOKIE_HEADER: "abc",
        }),
      ).fetch()
    ).snapshot;
    expect(snapshot.status).toBe("live");
    expect(snapshot.windows[0].limit).toBe(10);
    expect(snapshot.planName).toBeUndefined();
    expect(snapshot.diagnostics).toContain(
      "Subscription endpoint unavailable.",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("distinguishes malformed cookie configuration", async () => {
    const root = mkTmp();
    for (const configuredCookie of [
      "other=value",
      "abc; def",
      "__Host-better-auth.session_token=",
    ]) {
      const snapshot = (
        await commandCodeProvider(
          createLiveDeps(root, () => 1_000, vi.fn(), {
            COMMAND_CODE_COOKIE_HEADER: configuredCookie,
          }),
        ).fetch()
      ).snapshot;
      expect(snapshot.diagnostics.join(" ")).toContain(
        "Malformed COMMAND_CODE_COOKIE_HEADER",
      );
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("retains the Command Code token cookie and strips cached session data", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      expect(new Headers(init?.headers).get("cookie")).toBe(
        "__Secure-commandcode_prod_.session_token=token",
      );
      return new Response("{}", { status: 200 });
    });
    await commandCodeProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        COMMAND_CODE_COOKIE_HEADER:
          "__Secure-commandcode_prod_.session_data=cached; __Secure-commandcode_prod_.session_token=token",
      }),
    ).fetch();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("OpenCode Go provider", () => {
  it("keeps dashboard source labels, windows, and TTL on live snapshots", async () => {
    const root = mkTmp();
    const now = Date.parse("2026-05-30T12:00:00Z");
    const snapshot = (
      await opencodeGoProvider(
        createLiveDeps(
          root,
          () => now,
          async () =>
            new Response(
              `<script>{rollingUsage:{resetInSec:60,usagePercent:12.4},weeklyUsage:{usagePercent:50,resetInSec:120},monthlyUsage:{resetInSec:180,usagePercent:75}}</script>`,
              { status: 200 },
            ),
          {
            OPENCODE_GO_COOKIE_HEADER: "auth=secret",
            OPENCODE_GO_WORKSPACE_ID: "wrk_test",
          },
        ),
      ).fetch()
    ).snapshot;

    expect(snapshot.status).toBe("live");
    expect(snapshot.sourceLabel).toBe("OpenCode Go dashboard");
    expect(snapshot.windows.map((w) => [w.key, w.label])).toEqual([
      ["fiveHour", "5h"],
      ["weekly", "Weekly"],
      ["monthly", "Monthly"],
    ]);
    expect(snapshot.expiresAt).toBe(now + PROVIDER_TTLS_MS["opencode-go"]);
    rmSync(root, { recursive: true, force: true });
  });

  it("converts unavailable snapshots into runtime error and preserves cached data", async () => {
    const root = mkTmp();
    let now = Date.parse("2026-05-30T12:00:00Z");
    const deps = createLiveDeps(
      root,
      () => now,
      async () =>
        new Response(
          `<script>{rollingUsage:{resetInSec:60,usagePercent:12.4},weeklyUsage:{usagePercent:50,resetInSec:120},monthlyUsage:{resetInSec:180,usagePercent:75}}</script>`,
          { status: 200 },
        ),
      {
        OPENCODE_GO_COOKIE_HEADER: "auth=secret",
        OPENCODE_GO_WORKSPACE_ID: "wrk_test",
      },
    );
    const provider = opencodeGoProvider(deps);
    const live = await provider.fetch();
    expect(live.snapshot.status).toBe("live");

    deps.fetch = async () => new Response("", { status: 401 });
    deps.openReadonlySqlite = () => {
      throw new Error("no sqlite");
    };
    now += PROVIDER_TTLS_MS["opencode-go"] + 1;
    const cachedOnce = await provider.fetch();
    expect(cachedOnce.snapshot.status).toBe("stale");
    expect(cachedOnce.snapshot.sourceKind).toBe("cache");

    now += PROVIDER_TTLS_MS["opencode-go"] + 1;
    const cachedTwice = await provider.fetch();
    expect(cachedTwice.snapshot.status).toBe("stale");
    expect(cachedTwice.snapshot.sourceKind).toBe("cache");
    expect(cachedTwice.snapshot.diagnostics.join(" ")).toContain(
      "Live refresh failed repeatedly",
    );
    rmSync(root, { recursive: true, force: true });
  });
});

describe("MiniMax provider", () => {
  it("fetches token plan API and parses live model remains windows", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async (_url, init) => {
          const headers = new Headers(init?.headers);
          expect(headers.get("authorization")).toBe("Bearer primary-token");
          expect(headers.get("mm-api-source")).toBe("pi-coding-agent");
          return new Response(
            JSON.stringify({
              model_remains: [
                {
                  start_time: 1_000,
                  end_time: 19_000,
                  remains_time: 18_000,
                  current_interval_total_count: 100,
                  current_interval_usage_count: 40,
                  model_name: "general",
                  current_weekly_total_count: 500,
                  current_weekly_usage_count: 450,
                  weekly_end_time: 31_000,
                  weekly_remains_time: 30_000,
                  current_interval_remaining_percent: 60,
                  current_weekly_remaining_percent: 10,
                },
              ],
            }),
            { status: 200 },
          );
        },
        {
          MINIMAX_CODING_API_KEY: "primary-token",
          MINIMAX_API_KEY: "secondary-token",
        },
      ),
    );

    const res = await provider.fetch();
    expect(res.snapshot.status).toBe("live");
    expect(res.snapshot.windows[0].key).toBe("fiveHour");
    expect(res.snapshot.windows[0].used).toBe(40);
    expect(res.snapshot.windows[0].limit).toBe(100);
    expect(res.snapshot.windows[0].unit).toBe("credits");
    expect(res.snapshot.windows[1].key).toBe("weekly");
    expect(res.snapshot.windows[1].used).toBe(450);
    expect(res.snapshot.windows[1].limit).toBe(500);
    rmSync(root, { recursive: true, force: true });
  });

  it("retries global auth failures against China host once", async () => {
    const root = mkTmp();
    const fetchImpl = vi
      .fn<UsageDeps["fetch"]>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              five_hour: {
                total_credits: 10,
                remaining_credits: 9,
                remains_time: 30,
              },
            },
          }),
          { status: 200 },
        ),
      );

    const provider = minimaxProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        MINIMAX_API_KEY: "token",
      }),
    );
    const res = await provider.fetch();
    expect(res.snapshot.status).toBe("live");
    expect(res.snapshot.diagnostics.join(" ")).toContain("api.minimaxi.com");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps quota visible when reset is unavailable", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              five_hour: {
                total_credits: 100,
                remaining_credits: 25,
              },
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const window = (await provider.fetch()).snapshot.windows[0];
    expect(window.key).toBe("fiveHour");
    expect(window.used).toBe(75);
    expect(window.limit).toBe(100);
    expect(window.resetAt).toBeUndefined();
    expect(window.unavailableReason).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("parses seconds and millisecond remaining durations plus plan aliases", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              current_subscribe_title: "MiniMax Pro",
              five_hour: {
                total_credits: "100",
                remaining_credits: "25",
                reset_in_sec: 30,
              },
              weekly: {
                total_credits: 500,
                used_credits: 450,
                remains_time: 240_000,
              },
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.planName).toBe("Pro");
    expect(snapshot.windows[0].resetAt).toBe(31_000);
    expect(snapshot.windows[1].resetAt).toBe(241_000);
    expect(snapshot.windows.some((window) => window.key === "monthly")).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("maps semantic API auth failures to credential diagnostics", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              base_resp: { status_code: "1004", status_msg: "login required" },
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "secret-token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.diagnostics.join(" ")).toContain(
      "Invalid minimax credentials",
    );
    expect(snapshot.diagnostics.join(" ")).not.toContain("secret-token");
    rmSync(root, { recursive: true, force: true });
  });

  it("does not retry China for an explicit custom host", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(
      async () => new Response("", { status: 401 }),
    );
    const provider = minimaxProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        MINIMAX_API_KEY: "token",
        MINIMAX_API_HOST: "https://minimax.example.test/",
      }),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.diagnostics.join(" ")).toContain(
      "Invalid minimax credentials",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://minimax.example.test/v1/token_plan/remains",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("degrades cache write failures to diagnostics", async () => {
    const root = mkTmp();
    const deps = createLiveDeps(
      root,
      () => 1_000,
      async () =>
        new Response(
          JSON.stringify({
            five_hour: {
              total_credits: 100,
              remaining_credits: 25,
            },
          }),
          { status: 200 },
        ),
      { MINIMAX_API_KEY: "token" },
    );
    deps.writeFile = async () => {
      throw new Error("read-only cache");
    };

    const snapshot = (await minimaxProvider(deps).fetch()).snapshot;
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.diagnostics.join(" ")).toContain(
      "Live cache is unavailable",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("supports percent-only token plan windows", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              model_remains: [
                {
                  model_name: "general",
                  end_time: 61_000,
                  weekly_end_time: 121_000,
                  current_interval_remaining_percent: 70,
                  current_weekly_remaining_percent: 20,
                },
              ],
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.windows[0]).toMatchObject({ key: "fiveHour", usedPercent: 30 });
    expect(snapshot.windows[0].used).toBeUndefined();
    expect(snapshot.windows[1]).toMatchObject({ key: "weekly", usedPercent: 80 });
    expect(snapshot.windows[1].limit).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers count-based remains rows over percent-only rows", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              model_remains: [
                {
                  model_name: "video",
                  current_interval_remaining_percent: 100,
                  current_weekly_remaining_percent: 100,
                },
                {
                  model_name: "general",
                  current_interval_total_count: 50,
                  current_interval_usage_count: 10,
                  current_weekly_total_count: 200,
                  current_weekly_usage_count: 40,
                },
              ],
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.windows[0]).toMatchObject({
      key: "fiveHour",
      used: 10,
      limit: 50,
      usedPercent: 20,
    });
    expect(snapshot.windows[1]).toMatchObject({
      key: "weekly",
      used: 40,
      limit: 200,
      usedPercent: 20,
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("parses ISO reset timestamps and utilization fields", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              five_hour: {
                utilization: 17.6,
                resets_at: "2026-05-31T12:00:00Z",
              },
              weekly: {
                utilization: 41.2,
                resetsAt: "2026-06-02T03:30:00Z",
              },
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.windows[0]).toMatchObject({
      key: "fiveHour",
      usedPercent: 18,
      resetAt: Date.parse("2026-05-31T12:00:00Z"),
    });
    expect(snapshot.windows[1]).toMatchObject({
      key: "weekly",
      usedPercent: 41,
      resetAt: Date.parse("2026-06-02T03:30:00Z"),
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("treats reset_in_seconds as seconds even for weekly-sized values", async () => {
    const root = mkTmp();
    const provider = minimaxProvider(
      createLiveDeps(
        root,
        () => 1_000,
        async () =>
          new Response(
            JSON.stringify({
              weekly: {
                total_credits: 500,
                used_credits: 100,
                reset_in_seconds: 604_800,
              },
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.windows[0]).toMatchObject({
      key: "weekly",
      resetAt: 604_801_000,
    });
    rmSync(root, { recursive: true, force: true });
  });
});

describe("StepFun provider", () => {
  it("prefers STEPFUN_TOKEN over username/password and normalizes cookie-style input", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (String(url).includes("QueryStepPlanRateLimit")) {
        return new Response(
          JSON.stringify({
            status: 1,
            five_hour_usage_left_rate: 0.8,
            weekly_usage_left_rate: 0.5,
            five_hour_usage_reset_time: "1777528800",
            weekly_usage_reset_time: "1778000000",
          }),
          { status: 200 },
        );
      }
      if (String(url).includes("GetStepPlanStatus")) {
        return new Response(
          JSON.stringify({ status: 1, subscription: { name: "Plus" } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${String(url)}`);
    });

    const provider = stepfunProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        STEPFUN_TOKEN: "Oasis-Token=test-token; Oasis-Webid=abc",
        STEPFUN_USERNAME: "user@example.com",
        STEPFUN_PASSWORD: "secret",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("live");
    expect(result.snapshot.planName).toBe("Plus");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("logs in with username/password, fetches usage, and reads plan name", async () => {
    const root = mkTmp();
    const calls: string[] = [];
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      const textUrl = String(url);
      calls.push(textUrl);

      if (textUrl === "https://platform.stepfun.com") {
        return new Response("", {
          status: 200,
          headers: { "set-cookie": "INGRESSCOOKIE=ingress-cookie; Path=/;" },
        });
      }
      if (textUrl.includes("RegisterDevice")) {
        return new Response(
          JSON.stringify({ accessToken: { raw: "anon-token" } }),
          { status: 200 },
        );
      }
      if (textUrl.includes("SignInByPassword")) {
        return new Response(
          JSON.stringify({ accessToken: { raw: "live-token" } }),
          { status: 200 },
        );
      }
      if (textUrl.includes("QueryStepPlanRateLimit")) {
        expect(new Headers(init?.headers).get("cookie")).toContain(
          "Oasis-Token=live-token",
        );
        return new Response(
          JSON.stringify({
            status: 1,
            five_hour_usage_left_rate: 0.6,
            weekly_usage_left_rate: 0.25,
            five_hour_usage_reset_time: "1777528800",
            weekly_usage_reset_time: 1778000000,
          }),
          { status: 200 },
        );
      }
      if (textUrl.includes("GetStepPlanStatus")) {
        return new Response(
          JSON.stringify({
            status: 1,
            subscription: { name: "Plus" },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${textUrl}`);
    });

    const provider = stepfunProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        STEPFUN_USERNAME: "user@example.com",
        STEPFUN_PASSWORD: "secret",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.planName).toBe("Plus");
    expect(result.snapshot.windows).toEqual([
      expect.objectContaining({
        key: "fiveHour",
        label: "5h",
        usedPercent: 40,
        resetAt: 1777528800_000,
      }),
      expect.objectContaining({
        key: "weekly",
        label: "Weekly",
        usedPercent: 75,
        resetAt: 1778000000_000,
      }),
    ]);
    expect(calls).toEqual([
      "https://platform.stepfun.com",
      expect.stringContaining("RegisterDevice"),
      expect.stringContaining("SignInByPassword"),
      expect.stringContaining("QueryStepPlanRateLimit"),
      expect.stringContaining("GetStepPlanStatus"),
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns usage even when plan status fails", async () => {
    const root = mkTmp();
    const provider = stepfunProvider(
      createLiveDeps(
        root,
        () => 1_000,
        vi.fn<UsageDeps["fetch"]>(async (url) => {
          const textUrl = String(url);
          if (textUrl.includes("QueryStepPlanRateLimit")) {
            return new Response(
              JSON.stringify({
                status: 1,
                five_hour_usage_left_rate: 1,
                weekly_usage_left_rate: 0.9,
                five_hour_usage_reset_time: "1777528800",
                weekly_usage_reset_time: "1778000000",
              }),
              { status: 200 },
            );
          }
          if (textUrl.includes("GetStepPlanStatus")) {
            return new Response("boom", { status: 500 });
          }
          throw new Error(`unexpected url: ${textUrl}`);
        }),
        { STEPFUN_TOKEN: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.planName).toBeUndefined();
    expect(snapshot.windows).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns a credential diagnostic for invalid token-only auth", async () => {
    const root = mkTmp();
    const provider = stepfunProvider(
      createLiveDeps(
        root,
        () => 1_000,
        vi.fn<UsageDeps["fetch"]>(async (url) => {
          if (String(url).includes("QueryStepPlanRateLimit")) {
            return new Response("denied", { status: 401 });
          }
          throw new Error(`unexpected url: ${String(url)}`);
        }),
        { STEPFUN_TOKEN: "bad-token" },
      ),
    );

    const result = await provider.fetch();
    expect(result.snapshot.diagnostic).toBe(
      "Invalid StepFun token. Refresh STEPFUN_TOKEN.",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("returns a credential diagnostic for invalid username/password auth", async () => {
    const root = mkTmp();
    const provider = stepfunProvider(
      createLiveDeps(
        root,
        () => 1_000,
        vi.fn<UsageDeps["fetch"]>(async (url) => {
          if (String(url) === "https://platform.stepfun.com") {
            return new Response("", {
              status: 200,
              headers: { "set-cookie": "INGRESSCOOKIE=ingress-cookie; Path=/;" },
            });
          }
          if (String(url).includes("RegisterDevice")) {
            return new Response(
              JSON.stringify({ accessToken: { raw: "anon-token" } }),
              { status: 200 },
            );
          }
          if (String(url).includes("SignInByPassword")) {
            return new Response("denied", { status: 401 });
          }
          throw new Error(`unexpected url: ${String(url)}`);
        }),
        {
          STEPFUN_USERNAME: "user@example.com",
          STEPFUN_PASSWORD: "bad-secret",
        },
      ),
    );

    const result = await provider.fetch();
    expect(result.snapshot.diagnostic).toBe("Invalid StepFun credentials.");
    rmSync(root, { recursive: true, force: true });
  });

  it("creates provider backoff on 429", async () => {
    const root = mkTmp();
    const deps = createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        if (String(url).includes("QueryStepPlanRateLimit")) {
          return new Response("slow down", {
            status: 429,
            headers: { "retry-after": "60" },
          });
        }
        throw new Error(`unexpected url: ${String(url)}`);
      }),
      { STEPFUN_TOKEN: "token" },
    );

    const result = await stepfunProvider(deps).fetch();
    expect(result.nextRetryAt).toBe(61_000);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("OpenRouter provider", () => {
  it("fetches credits and key enrichment successfully", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
              limit_remaining: 40.0,
              daily_usage: 2.5,
              weekly_usage: 8.0,
              monthly_usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("live");
    expect(result.snapshot.sourceLabel).toBe("OpenRouter credits API");
    expect(result.snapshot.balances).toEqual([
      { label: "Remaining balance", remaining: 74.5, unit: "USD" },
      { label: "Total credits", remaining: 100.0, unit: "USD" },
      { label: "Total usage", remaining: 25.5, unit: "USD" },
      { label: "Today", remaining: 2.5, unit: "USD" },
      { label: "This week", remaining: 8.0, unit: "USD" },
      { label: "This month", remaining: 10.0, unit: "USD" },
    ]);
    expect(result.snapshot.windows).toEqual([
      {
        key: "key-quota",
        label: "Key quota",
        usedPercent: 20,
        used: 10.0,
        limit: 50.0,
        unit: "USD",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("fetches credits only when key endpoint fails", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/api/v1/key")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("live");
    expect(result.snapshot.balances).toEqual([
      { label: "Remaining balance", remaining: 74.5, unit: "USD" },
      { label: "Total credits", remaining: 100.0, unit: "USD" },
      { label: "Total usage", remaining: 25.5, unit: "USD" },
    ]);
    expect(result.snapshot.windows).toEqual([]);
    expect(result.snapshot.diagnostics).toEqual(["Key enrichment unavailable."]);
    rmSync(root, { recursive: true, force: true });
  });

  it("handles missing credentials", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>();

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {}),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("unavailable");
    expect(result.snapshot.diagnostic).toBe("Missing OPENROUTER_API_KEY.");
    expect(fetchImpl).not.toHaveBeenCalled();
    rmSync(root, { recursive: true, force: true });
  });

  it("handles credits 401 authentication failure", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "invalid-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("unavailable");
    expect(result.snapshot.diagnostic).toBe("Invalid OpenRouter credentials.");
    rmSync(root, { recursive: true, force: true });
  });

  it("handles credits 403 authentication failure", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "invalid-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("unavailable");
    expect(result.snapshot.diagnostic).toBe("Invalid OpenRouter credentials.");
    rmSync(root, { recursive: true, force: true });
  });

  it("handles credits 429 rate limit with backoff", async () => {
    const root = mkTmp();
    const now = 1_000;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response("Rate Limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => now, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("unavailable");
    expect(result.snapshot.diagnostic).toBe("Rate limited.");
    expect(result.nextRetryAt).toBe(now + 60_000);
    rmSync(root, { recursive: true, force: true });
  });

  it("handles malformed credits response", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(JSON.stringify({ data: { invalid: "data" } }), {
          status: 200,
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("unavailable");
    expect(result.snapshot.diagnostic).toBe(
      "OpenRouter credits response malformed.",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("uses custom base URL when provided", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_API_URL: "https://custom.openrouter.example.com",
      }),
    );

    await provider.fetch();
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "https://custom.openrouter.example.com/api/v1/credits",
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("sends custom headers when provided", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
        OPENROUTER_X_TITLE: "My App",
        OPENROUTER_HTTP_REFERER: "https://myapp.example.com",
      }),
    );

    await provider.fetch();
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-OpenRouter-Title"]).toBe("My App");
    expect(headers["HTTP-Referer"]).toBe("https://myapp.example.com");
    rmSync(root, { recursive: true, force: true });
  });

  it("uses default headers when not provided", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    await provider.fetch();
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<
      string,
      string
    >;
    expect(headers["X-OpenRouter-Title"]).toBe("pi-usage");
    expect(headers["HTTP-Referer"]).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it("caches successful responses", async () => {
    const root = mkTmp();
    let now = 1_000;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => now, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    await provider.fetch();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Second fetch should use cache
    now += 1_000;
    const cached = await provider.fetch();
    expect(cached.snapshot.status).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to stale cache when fetch fails", async () => {
    const root = mkTmp();
    let now = 1_000;
    let fetchCount = 0;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        fetchCount++;
        if (fetchCount === 1) {
          return new Response(
            JSON.stringify({
              data: {
                total_credits: 100.0,
                total_usage: 25.5,
              },
            }),
            { status: 200 },
          );
        }
        return new Response("Internal Server Error", { status: 500 });
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => now, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    await provider.fetch();

    // Advance past TTL and fail
    now += 31 * 60 * 1000;
    const stale = await provider.fetch();
    expect(stale.snapshot.status).toBe("stale");
    expect(stale.snapshot.balances.length).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });

  it("calculates key quota from usage + limit_remaining when limit is missing", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              usage: 10.0,
              limit_remaining: 40.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.windows).toEqual([
      {
        key: "key-quota",
        label: "Key quota",
        usedPercent: 20,
        used: 10.0,
        limit: 50.0,
        unit: "USD",
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("clamps remaining balance to zero when usage exceeds credits", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 150.0,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response(
          JSON.stringify({
            data: {
              limit: 50.0,
              usage: 10.0,
            },
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.balances[0]).toEqual({
      label: "Remaining balance",
      remaining: 0,
      unit: "USD",
    });
    rmSync(root, { recursive: true, force: true });
  });

  it("does not create provider backoff on key 429", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/api/v1/credits")) {
        return new Response(
          JSON.stringify({
            data: {
              total_credits: 100.0,
              total_usage: 25.5,
            },
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/api/v1/key")) {
        return new Response("Rate Limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      }
      return new Response("Not Found", { status: 404 });
    });

    const provider = openrouterProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        OPENROUTER_API_KEY: "test-key",
      }),
    );

    const result = await provider.fetch();
    expect(result.snapshot.status).toBe("live");
    expect(result.snapshot.diagnostics).toEqual(["Key enrichment unavailable."]);
    // Should not have nextRetryAt since key 429 doesn't trigger provider backoff
    expect(result.nextRetryAt).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
