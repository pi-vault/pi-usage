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
