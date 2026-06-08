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

function minimaxProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "minimax",
  );
  if (!provider) throw new Error("missing minimax provider");
  return provider;
}

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
