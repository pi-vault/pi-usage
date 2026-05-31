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

describe("provider detection", () => {
  it("prefers explicit providers and only falls back when provider is empty", () => {
    expect(
      detectProviderFromModel({ provider: "openai-codex", id: "anything" }),
    ).toBe("openai-codex");
    expect(
      detectProviderFromModel({ provider: "minimax", id: "anything" }),
    ).toBe("minimax");
    expect(
      detectProviderFromModel({ provider: "opencode-go", id: "anything" }),
    ).toBe("opencode-go");
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
    expect(
      detectProviderFromModel({ provider: "", id: "opencode-go/glm-5" }),
    ).toBe("opencode-go");
    expect(
      detectProviderFromModel({ provider: "command-code", id: "anything" }),
    ).toBe("command-code");
    expect(
      detectProviderFromModel({ provider: "commandcode", id: "anything" }),
    ).toBe("command-code");
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
      { id: "opencode-go", label: "OpenCode Go", strategy: "api" },
      { id: "command-code", label: "Command Code", strategy: "api" },
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
                reset_at: 456,
                limit_window_seconds: 5 * 3600,
              },
              secondary_window: {
                used_percent: 50,
                reset_at: 789,
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
    ).toBe(456);
    expect(
      live.snapshot.windows.find((w) => w.key === "monthly")?.unavailableReason,
    ).toBe("Unavailable from ChatGPT usage API");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 1_000;
    const cached = await provider.fetch();
    expect(cached.snapshot.status).toBe("cached");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
    now += 5 * 60 * 1000 + 1;
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
  it("fetches remains API and parses remaining counts", async () => {
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
              category_remains: [
                {
                  display_name: "Coding Plan",
                  current_interval_total_count: 100,
                  current_interval_usage_count: 40,
                  end_time: 2_000,
                  current_weekly_total_count: 500,
                  current_weekly_usage_count: 450,
                  weekly_end_time: 3_000,
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
    expect(res.snapshot.windows[0].used).toBe(60);
    expect(res.snapshot.windows[0].limit).toBe(100);
    expect(res.snapshot.windows[1].used).toBe(50);
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
              model_remains: [
                {
                  model_name: "m2",
                  current_interval_total_count: 10,
                  current_interval_usage_count: 9,
                  remains_time: 30,
                },
              ],
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
              category_remains: [
                {
                  display_name: "Search",
                  current_interval_total_count: 100,
                  current_interval_usage_count: 25,
                },
              ],
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const window = (await provider.fetch()).snapshot.windows[0];
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
              category_remains: [
                {
                  display_name: "Search",
                  current_interval_total_count: "100",
                  current_interval_usage_count: "25",
                  remains_time: 30,
                  current_weekly_total_count: 500,
                  current_weekly_usage_count: 450,
                  weekly_remains_time: 240_000,
                },
              ],
            }),
            { status: 200 },
          ),
        { MINIMAX_API_KEY: "token" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.planName).toBe("MiniMax Pro");
    expect(snapshot.windows[0].resetAt).toBe(31_000);
    expect(snapshot.windows[1].resetAt).toBe(241_000);
    expect(snapshot.windows.some((window) => window.key === "monthly")).toBe(
      false,
    );
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
      "https://minimax.example.test/v1/api/openplatform/coding_plan/remains",
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
            category_remains: [
              {
                display_name: "Search",
                current_interval_total_count: 100,
                current_interval_usage_count: 25,
              },
            ],
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
});
