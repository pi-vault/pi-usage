import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseCommandCodeUsage } from "../src/providers/command-code/usage-parser.ts";
import { createProviderRegistry } from "../src/providers/index.ts";
import { createDefaultDeps, type UsageDeps } from "../src/shared/deps.ts";

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

function commandCodeProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find((item) => item.id === "command-code");
  if (!provider) throw new Error("missing command-code provider");
  return provider;
}

describe("Command Code usage parser", () => {
  it("parses root rolling windows and preserves balances without a monthly window", () => {
    const parsed = parseCommandCodeUsage({
      summary: { totalCost: 4, totalCount: 42, totalTokens: 1_234 },
      credits: {
        credits: { monthlyCredits: 6, purchasedCredits: 5 },
        windowLimits: {
          fiveHour: { cap: 3, used: 0.75, resetAt: 1_780_000_000_000 },
          weekly: { cap: 15, used: 1.5, resetAt: 1_780_100_000_000 },
        },
      },
      subscription: { data: { planId: "individual-go" } },
    });

    expect(parsed.windows).toEqual([
      {
        key: "fiveHour",
        label: "5h",
        usedPercent: 25,
        resetAt: 1_780_000_000_000,
        windowDurationMins: 300,
      },
      {
        key: "weekly",
        label: "Weekly",
        usedPercent: 10,
        resetAt: 1_780_100_000_000,
        windowDurationMins: 10_080,
      },
    ]);
    expect(parsed.balances).toEqual([
      { label: "Monthly remaining", remaining: 6, unit: "USD" },
      { label: "Purchased remaining", remaining: 5, unit: "USD" },
      { label: "Requests", remaining: 42, unit: "count" },
      { label: "Tokens", remaining: 1_234, unit: "tok" },
    ]);
    expect(parsed.planName).toBe("Go");
  });

  it("parses nested string windows and supported reset formats", () => {
    const parsed = parseCommandCodeUsage({
      credits: {
        credits: {
          monthlyCredits: "7.25",
          windowLimits: {
            fiveHour: { cap: "4", used: "1", resetAt: "1780200000" },
            weekly: {
              cap: "20",
              used: "4",
              resetAt: "2026-06-01T00:00:00Z",
            },
          },
        },
      },
    });

    expect(parsed.windows.map((window) => window.usedPercent)).toEqual([25, 20]);
    expect(parsed.windows[0].resetAt).toBe(1_780_200_000_000);
    expect(parsed.windows[1].resetAt).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(parsed.balances).toContainEqual({
      label: "Monthly remaining",
      remaining: 7.25,
      unit: "USD",
    });
  });

  it.each(["0", 0, "-1", -1])("rejects non-positive numeric reset sentinel %j", (resetAt) => {
    const parsed = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { cap: 1, resetAt } },
      },
    });

    expect(parsed.windows[0].resetAt).toBeUndefined();
  });

  it("omits invalid caps, defaults missing usage, and clamps overuse", () => {
    const parsed = parseCommandCodeUsage({
      credits: {
        windowLimits: {
          fiveHour: { cap: 3 },
          weekly: { cap: 0, used: 2 },
        },
      },
    });
    expect(parsed.windows).toEqual([
      {
        key: "fiveHour",
        label: "5h",
        usedPercent: 0,
        resetAt: undefined,
        windowDurationMins: 300,
      },
    ]);

    const overused = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { cap: 3, used: 4 } },
      },
    });
    expect(overused.windows[0].usedPercent).toBe(100);

    const fractional = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { cap: 3, used: 1 } },
      },
    });
    expect(fractional.windows[0].usedPercent).toBeCloseTo(100 / 3);

    const negative = parseCommandCodeUsage({
      credits: {
        windowLimits: { fiveHour: { cap: 3, used: -1 } },
      },
    });
    expect(negative.windows[0].usedPercent).toBe(0);
  });

  it("uses combined tokens before separate input and output totals", () => {
    expect(
      parseCommandCodeUsage({
        summary: { totalTokens: 30, totalTokensIn: 10, totalTokensOut: 20 },
      }).balances,
    ).toEqual([{ label: "Tokens", remaining: 30, unit: "tok" }]);
    expect(
      parseCommandCodeUsage({
        summary: { totalTokensIn: 10, totalTokensOut: 20 },
      }).balances,
    ).toEqual([
      { label: "Tokens in", remaining: 10, unit: "tok" },
      { label: "Tokens out", remaining: 20, unit: "tok" },
    ]);
  });

  it("ignores blank numeric fields and retains separate token totals", () => {
    const parsed = parseCommandCodeUsage({
      summary: {
        totalCount: " ",
        totalTokens: "",
        totalTokensIn: 10,
        totalTokensOut: 20,
      },
      credits: {
        credits: { monthlyCredits: "", purchasedCredits: " " },
      },
    });

    expect(parsed.balances).toEqual([
      { label: "Tokens in", remaining: 10, unit: "tok" },
      { label: "Tokens out", remaining: 20, unit: "tok" },
    ]);
  });

  it.each([
    ["individual-go", "Go"],
    ["individual-goat", "GOAT"],
    ["individual-pro", "Pro"],
    ["individual-pro-v1", "Pro"],
    ["individual-max", "Max"],
    ["individual-ultra", "Ultra"],
    ["team-future", "team-future"],
  ])("maps plan %s to %s", (planId, expected) => {
    expect(parseCommandCodeUsage({ subscription: { data: { planId } } }).planName).toBe(expected);
  });
});

describe("Command Code provider", () => {
  it("uses cookie auth and exposes rolling usage with balances", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBe("__Secure-commandcode_prod_.session_token=abc");
      if (url.toString().includes("/usage/summary")) {
        return new Response(
          JSON.stringify({
            totalCount: 42,
            totalTokens: 1234,
          }),
          { status: 200 },
        );
      }
      if (url.toString().includes("/billing/credits")) {
        return new Response(
          JSON.stringify({
            credits: { monthlyCredits: 5.7112, purchasedCredits: 5 },
            windowLimits: {
              fiveHour: { cap: 3, used: 0.75, resetAt: 1_780_000_000_000 },
              weekly: { cap: 15, used: 1.5, resetAt: 1_780_100_000_000 },
            },
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
    expect(snapshot.windows.map((window) => [window.key, window.label])).toEqual([
      ["fiveHour", "5h"],
      ["weekly", "Weekly"],
    ]);
    expect(snapshot.balances).toEqual(
      expect.arrayContaining([
        { label: "Monthly remaining", remaining: 5.7112, unit: "USD" },
        { label: "Purchased remaining", remaining: 5, unit: "USD" },
        { label: "Requests", remaining: 42, unit: "count" },
        { label: "Tokens", remaining: 1_234, unit: "tok" },
      ]),
    );
    expect(snapshot.planName).toBe("Go");
    expect(snapshot.sourceLabel).toContain("Command Code");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    rmSync(root, { recursive: true, force: true });
  });

  it("returns credential diagnostic when cookie is missing", async () => {
    const root = mkTmp();
    const snapshot = (await commandCodeProvider(createLiveDeps(root, () => 1_000, vi.fn())).fetch())
      .snapshot;
    expect(snapshot.available).toBe(false);
    expect(snapshot.diagnostics.join(" ")).toContain("Missing COMMAND_CODE_COOKIE_HEADER");
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps rolling limits when summary and subscription fail", async () => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url) => {
      if (url.toString().includes("/billing/credits")) {
        return new Response(
          JSON.stringify({
            credits: { monthlyCredits: 6 },
            windowLimits: {
              fiveHour: { cap: 3, used: 1, resetAt: 1_780_000_000_000 },
              weekly: { cap: 15, used: 2, resetAt: 1_780_100_000_000 },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error("endpoint unavailable");
    });

    const snapshot = (
      await commandCodeProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, {
          COMMAND_CODE_COOKIE_HEADER: "abc",
        }),
      ).fetch()
    ).snapshot;
    expect(snapshot.status).toBe("live");
    expect(snapshot.windows.map((window) => window.key)).toEqual([
      "fiveHour",
      "weekly",
    ]);
    expect(snapshot.balances).toContainEqual({
      label: "Monthly remaining",
      remaining: 6,
      unit: "USD",
    });
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        "Summary endpoint unavailable.",
        "Subscription endpoint unavailable.",
      ]),
    );
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    "commandcode_prod_.session_token",
    "__Host-commandcode_prod_.session_token",
  ])("accepts current Command Code cookie alias %s", async (cookieName) => {
    const root = mkTmp();
    const fetchImpl = vi.fn<UsageDeps["fetch"]>(async (url, init) => {
      expect(new Headers(init?.headers).get("cookie")).toBe(
        `${cookieName}=token`,
      );
      if (url.toString().includes("/billing/credits")) {
        return new Response(
          JSON.stringify({ credits: { monthlyCredits: 0 } }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const snapshot = (
      await commandCodeProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, {
          COMMAND_CODE_COOKIE_HEADER: `${cookieName}=token`,
        }),
      ).fetch()
    ).snapshot;
    expect(snapshot.status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    { status: 429, diagnostic: "Rate limited.", hasRetry: true },
    { status: 401, diagnostic: "session expired", hasRetry: false },
  ])(
    "classifies primary $status responses",
    async ({ status, diagnostic, hasRetry }) => {
      const root = mkTmp();
      const fetchImpl = vi.fn<UsageDeps["fetch"]>(async () =>
        new Response("{}", { status }),
      );
      const outcome = await commandCodeProvider(
        createLiveDeps(root, () => 1_000, fetchImpl, {
          COMMAND_CODE_COOKIE_HEADER: "abc",
        }),
      ).fetch();

      expect(outcome.snapshot.available).toBe(false);
      expect(outcome.snapshot.diagnostics.join(" ")).toContain(diagnostic);
      expect(Boolean(outcome.nextRetryAt)).toBe(hasRetry);
      rmSync(root, { recursive: true, force: true });
    },
  );

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
      expect(snapshot.diagnostics.join(" ")).toContain("Malformed COMMAND_CODE_COOKIE_HEADER");
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
