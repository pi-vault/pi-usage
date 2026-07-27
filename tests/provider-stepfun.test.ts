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

function stepfunProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "stepfun",
  );
  if (!provider) throw new Error("missing stepfun provider");
  return provider;
}

describe("StepFun provider", () => {
  it("requires a complete StepFun browser session", async () => {
    const envs: Array<Record<string, string>> = [
      {},
      { STEPFUN_TOKEN: "token" },
      { STEPFUN_WEB_ID: "web-id" },
      { STEPFUN_USERNAME: "user@example.com", STEPFUN_PASSWORD: "secret" },
    ];

    for (const env of envs) {
      const root = mkTmp();
      const fetchImpl = vi.fn<UsageDeps["fetch"]>();
      const result = await stepfunProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, env),
      ).fetch();

      expect(result.snapshot.diagnostic).toBe(
        "Missing StepFun browser session. Set STEPFUN_TOKEN and STEPFUN_WEB_ID.",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the .ai dashboard with the matching browser Web ID", async () => {
    const root = mkTmp();
    const calls: string[] = [];
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      const textUrl = String(url);
      calls.push(textUrl);
      const headers = new Headers(init?.headers);
      expect(headers.get("oasis-webid")).toBe("browser-web-id");
      expect(headers.get("cookie")).toBe(
        "Oasis-Token=test-token; Oasis-WebId=browser-web-id",
      );

      if (textUrl.includes("QueryStepPlanRateLimit")) {
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
      if (textUrl.includes("GetStepPlanStatus")) {
        return new Response(
          JSON.stringify({ status: 1, subscription: { name: "Plus" } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${textUrl}`);
    });

    const result = await stepfunProvider(
      createLiveDeps(root, () => 1_000, fetchImpl, {
        STEPFUN_TOKEN: "Oasis-Token=test-token; Path=/",
        STEPFUN_WEB_ID: "browser-web-id",
      }),
    ).fetch();

    expect(result.snapshot.status).toBe("live");
    expect(result.snapshot.planName).toBe("Plus");
    expect(result.snapshot.windows).toEqual([
      expect.objectContaining({ key: "fiveHour", usedPercent: 20 }),
      expect.objectContaining({ key: "weekly", usedPercent: 50 }),
    ]);
    expect(calls).toHaveLength(2);
    expect(
      calls.every((url) => url.startsWith("https://platform.stepfun.ai")),
    ).toBe(true);
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
        { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
      ),
    );

    const snapshot = (await provider.fetch()).snapshot;
    expect(snapshot.planName).toBeUndefined();
    expect(snapshot.windows).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns a browser-session diagnostic for an unauthorized dashboard", async () => {
    for (const status of [401, 403]) {
      const root = mkTmp();
      const provider = stepfunProvider(
        createLiveDeps(
          root,
          () => 1_000,
          vi.fn<UsageDeps["fetch"]>(async (url) => {
            if (String(url).includes("QueryStepPlanRateLimit")) {
              return new Response("denied", { status });
            }
            throw new Error(`unexpected url: ${String(url)}`);
          }),
          { STEPFUN_TOKEN: "bad-token", STEPFUN_WEB_ID: "web-id" },
        ),
      );

      const result = await provider.fetch();
      expect(result.snapshot.diagnostic).toBe(
        "Invalid StepFun browser session. Refresh STEPFUN_TOKEN and STEPFUN_WEB_ID.",
      );
      rmSync(root, { recursive: true, force: true });
    }
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
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    );

    const result = await stepfunProvider(deps).fetch();
    expect(result.nextRetryAt).toBe(61_000);
    rmSync(root, { recursive: true, force: true });
  });
});
