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

function creditProvider(root: string, payload: Record<string, unknown>) {
  return stepfunProvider(
    createLiveDeps(
      root,
      () => 1_000,
      vi.fn<UsageDeps["fetch"]>(async (url) => {
        const textUrl = String(url);
        if (textUrl.includes("QueryStepPlanRateLimit")) {
          return new Response(JSON.stringify({ status: 1, ...payload }), {
            status: 200,
          });
        }
        if (textUrl.includes("GetStepPlanStatus")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected url: ${textUrl}`);
      }),
      { STEPFUN_TOKEN: "token", STEPFUN_WEB_ID: "web-id" },
    ),
  );
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

  it("uses the current .ai browser request contract", async () => {
    const root = mkTmp();
    const calls: string[] = [];
    const requestHeaders: Headers[] = [];
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      const textUrl = String(url);
      calls.push(textUrl);
      requestHeaders.push(new Headers(init?.headers));

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
    for (const headers of requestHeaders) {
      expect(headers.get("connect-protocol-version")).toBe("1");
      expect(headers.get("oasis-appid")).toBe("20700");
      expect(headers.get("oasis-platform")).toBe("web");
      expect(headers.get("oasis-webid")).toBe("browser-web-id");
      expect(headers.get("cookie")).toBe(
        "Oasis-Token=test-token; Oasis-Webid=browser-web-id",
      );
    }
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

  it("combines only a complete valid Credit bucket set", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: "2",
        five_hour_usage_left_rate: 0.8,
        weekly_usage_left_rate: 0.9,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.25,
          subscription_credit_reset_time: "1778000000",
          topup_credit_left_rate: 1,
          credit_buckets: [
            { credit_total: "400000000", credit_residual: 100000000 },
            { credit_total: 100000000, credit_residual: "100000000" },
          ],
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        used: 300_000_000,
        limit: 500_000_000,
        unit: "credits",
        usedPercent: 60,
        resetAt: 1778000000_000,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to subscription rate when Credit bucket aggregates overflow", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.8,
          credit_buckets: [
            { credit_total: Number.MAX_VALUE, credit_residual: Number.MAX_VALUE },
            { credit_total: Number.MAX_VALUE, credit_residual: Number.MAX_VALUE },
          ],
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 20,
        resetAt: undefined,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to subscription rate when any Credit bucket is invalid", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.8,
          topup_credit_left_rate: 0.5,
          credit_buckets: [
            { credit_total: 100, credit_residual: 50 },
            { credit_total: 0, credit_residual: 0 },
          ],
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 20,
        resetAt: undefined,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("uses the subscription reset when falling back to a top-up rate", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 2,
          topup_credit_left_rate: "0.4",
          subscription_credit_reset_time: "1778000000",
          topup_credit_reset_time: "1888000000",
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 60,
        resetAt: 1778000000_000,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("recognizes Credit-only data without plan_family when legacy fields are zero", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        five_hour_usage_left_rate: 0,
        weekly_usage_left_rate: "0",
        five_hour_usage_reset_time: "0",
        weekly_usage_reset_time: 0,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: "0.75",
          subscription_credit_reset_time: 1778000000,
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 25,
        resetAt: 1778000000_000,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("uses top-up Credit rate when subscription rate is blank", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: " ",
          topup_credit_left_rate: 0.4,
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 60,
        resetAt: undefined,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a Credit bucket with a blank residual", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 0.8,
          credit_buckets: [{ credit_total: 100, credit_residual: " " }],
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.windows).toEqual([
      {
        key: "credits",
        label: "Credits",
        unit: "credits",
        usedPercent: 20,
        resetAt: undefined,
      },
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a blank top-up Credit rate", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {
          subscription_credit_left_rate: 2,
          topup_credit_left_rate: " ",
        },
      }).fetch()
    ).snapshot;

    expect(snapshot.diagnostic).toBe("StepFun response malformed.");
    expect(snapshot.windows).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    {
      name: "a nonzero legacy five-hour rate",
      leftRate: 0.5,
      expectedWindows: [
        { key: "fiveHour", label: "5h", usedPercent: 50, resetAt: undefined },
      ],
      malformed: false,
    },
    {
      name: "a malformed legacy five-hour rate",
      leftRate: "not-a-number",
      expectedWindows: [],
      malformed: true,
    },
    {
      name: "a blank legacy five-hour rate",
      leftRate: "   ",
      expectedWindows: [
        { key: "fiveHour", label: "5h", usedPercent: 100, resetAt: undefined },
      ],
      malformed: false,
    },
  ])(
    "does not treat $name as absent for Credit classification",
    async ({ leftRate, expectedWindows, malformed }) => {
      const root = mkTmp();
      const snapshot = (
        await creditProvider(root, {
          five_hour_usage_left_rate: leftRate,
          plan_credit_rate_limit: {
            subscription_credit_left_rate: 0.75,
          },
        }).fetch()
      ).snapshot;

      expect(snapshot.windows).toEqual(expectedWindows);
      if (malformed) {
        expect(snapshot.diagnostic).toBe("StepFun response malformed.");
      }
      rmSync(root, { recursive: true, force: true });
    },
  );

  it("rejects malformed Credit responses instead of showing exhaustion", async () => {
    const root = mkTmp();
    const snapshot = (
      await creditProvider(root, {
        plan_family: 2,
        plan_credit_rate_limit: {},
      }).fetch()
    ).snapshot;

    expect(snapshot.diagnostic).toBe("StepFun response malformed.");
    expect(snapshot.windows).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
