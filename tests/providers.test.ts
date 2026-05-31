import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps, type UsageDeps } from "../src/deps.ts";
import { detectProviderFromModel } from "../src/index.ts";
import { createProviderRegistry, providerCacheDir } from "../src/providers.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-live-"));
}

function createLiveDeps(root: string, now: () => number, fetchImpl: UsageDeps["fetch"], env?: Record<string, string>): UsageDeps {
  const deps = createDefaultDeps();
  return {
    ...deps,
    agentDir: () => root,
    now,
    fetch: fetchImpl,
    env: { ...deps.env, ...env },
  };
}

function openAICodexProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find((item) => item.id === "openai-codex");
  if (!provider) throw new Error("missing openai-codex provider");
  return provider;
}

describe("provider detection", () => {
  it("prefers explicit providers and only falls back when provider is empty", () => {
    expect(detectProviderFromModel({ provider: "openai-codex", id: "anything" })).toBe("openai-codex");
    expect(detectProviderFromModel({ provider: "amazon-bedrock", id: "openai-codex-proxy" })).toBeUndefined();
    expect(detectProviderFromModel({ provider: "", id: "gpt-5-codex" })).toBe("openai-codex");
  });
});

describe("OpenAI Codex provider", () => {
  it("fetches usage via HTTP and caches it", async () => {
    const root = mkTmp();
    let now = 1_000;
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async () =>
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 25, reset_at: 456, limit_window_seconds: 5 * 3600 },
            secondary_window: { used_percent: 50, reset_at: 789, limit_window_seconds: 7 * 24 * 3600 },
          },
          additional_rate_limits: [
            {
              limit_name: "Codex Spark",
              rate_limit: {
                primary_window: { used_percent: 10, limit_window_seconds: 5 * 3600 },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const provider = openAICodexProvider(createLiveDeps(root, () => now, fetchImpl, { OPENAI_CODEX_ACCESS_TOKEN: "t" }));
    const live = await provider.fetch();
    expect(live.snapshot.status).toBe("live");
    expect(live.snapshot.sourceLabel).toBe("ChatGPT usage API");
    expect(live.snapshot.windows.some((w) => w.key === "fiveHour")).toBe(true);
    expect(live.snapshot.windows.some((w) => w.key === "weekly")).toBe(true);
    expect(live.snapshot.windows.find((w) => w.key.startsWith("additional:"))?.label).toBe("Codex Spark 5h");
    expect(live.snapshot.windows.find((w) => w.key === "fiveHour")?.resetAt).toBe(456);
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
      if (limited) return new Response("", { status: 429, headers: { "retry-after": "9" } });
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 5 * 3600 } } }), { status: 200 });
    });
    const deps = createLiveDeps(root, () => now, fetchImpl, { OPENAI_CODEX_ACCESS_TOKEN: "t" });
    const provider = openAICodexProvider(deps);
    await provider.fetch();

    limited = true;
    now += 5 * 60 * 1000 + 1;
    const rateLimited = await provider.fetch();
    expect(rateLimited.nextRetryAt).toBe(now + 9_000);
    expect(rateLimited.snapshot.status).toBe("stale");

    const backoff = JSON.parse(readFileSync(join(providerCacheDir(deps), "openai-codex.backoff.json"), "utf8")) as { nextRetryAt: number };
    expect(backoff.nextRetryAt).toBe(now + 9_000);
    rmSync(root, { recursive: true, force: true });
  });

  it("supports HTTP-date Retry-After", async () => {
    const root = mkTmp();
    const now = Date.parse("2026-05-30T20:00:00Z");
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async () =>
      new Response("", {
        status: 429,
        headers: { "retry-after": "Sat, 30 May 2026 20:00:09 GMT" },
      }),
    );
    const deps = createLiveDeps(root, () => now, fetchImpl, { OPENAI_CODEX_ACCESS_TOKEN: "t" });

    expect((await openAICodexProvider(deps).fetch()).nextRetryAt).toBe(now + 9_000);
    rmSync(root, { recursive: true, force: true });
  });

  it.each([401, 403])("returns login diagnostic on HTTP %s", async (status) => {
    const root = mkTmp();
    const provider = openAICodexProvider(createLiveDeps(root, () => 1_000, async () => new Response("", { status }), { OPENAI_CODEX_ACCESS_TOKEN: "t" }));
    const res = await provider.fetch();
    expect(res.snapshot.diagnostics.join(" ")).toContain("log into openai-codex");
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers env credentials and account ID over Pi auth", async () => {
    const root = mkTmp();
    writeFileSync(join(root, "auth.json"), JSON.stringify({ "openai-codex": { access: "pi-token", accountId: "pi-account" } }));
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer env-token");
      expect(headers.get("chatgpt-account-id")).toBe("env-account");
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 } } }), { status: 200 });
    });
    const deps = createLiveDeps(root, () => 1_000, fetchImpl, {
      OPENAI_CODEX_ACCESS_TOKEN: " env-token ",
      OPENAI_CODEX_ACCOUNT_ID: " env-account ",
    });

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });

  it("reads credentials from Pi auth", async () => {
    const root = mkTmp();
    writeFileSync(join(root, "auth.json"), JSON.stringify({ "openai-codex": { access: "pi-token", accountId: "pi-account" } }));
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer pi-token");
      expect(headers.get("chatgpt-account-id")).toBe("pi-account");
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 } } }), { status: 200 });
    });

    expect((await openAICodexProvider(createLiveDeps(root, () => 1_000, fetchImpl)).fetch()).snapshot.status).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back from malformed Pi auth to CODEX_HOME auth", async () => {
    const root = mkTmp();
    const codexHome = join(root, "codex");
    mkdirSync(codexHome);
    writeFileSync(join(root, "auth.json"), "{");
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: { access_token: "codex-token", account_id: "codex-account" } }));
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer codex-token");
      expect(headers.get("chatgpt-account-id")).toBe("codex-account");
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 } } }), { status: 200 });
    });
    const deps = createLiveDeps(root, () => 1_000, fetchImpl, { CODEX_HOME: codexHome });

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to default Codex auth under homeDir", async () => {
    const root = mkTmp();
    const home = join(root, "home");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: "default-codex-token" }));
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer default-codex-token");
      return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 } } }), { status: 200 });
    });
    const deps = {
      ...createLiveDeps(root, () => 1_000, fetchImpl, { CODEX_HOME: "" }),
      homeDir: () => home,
    };

    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });

  it("recovers stale locks before fetching", async () => {
    const root = mkTmp();
    const now = Date.now();
    const deps = createLiveDeps(root, () => now, async () => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 5 * 3600 } } }), { status: 200 }), { OPENAI_CODEX_ACCESS_TOKEN: "t" });
    const dir = providerCacheDir(deps);
    await deps.mkdir(dir, { recursive: true });
    const lockPath = join(dir, "openai-codex.lock");
    writeFileSync(lockPath, "", "utf8");
    utimesSync(lockPath, new Date(now - 10_000), new Date(now - 10_000));
    expect((await openAICodexProvider(deps).fetch()).snapshot.status).toBe("live");
    rmSync(root, { recursive: true, force: true });
  });
});
