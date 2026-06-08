import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps, type UsageDeps } from "../src/shared/deps.ts";
import { createProviderRegistry } from "../src/providers/index.ts";

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

function openrouterProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "openrouter",
  );
  if (!provider) throw new Error("missing openrouter provider");
  return provider;
}

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
