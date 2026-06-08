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

function commandCodeProvider(deps: UsageDeps) {
  const provider = createProviderRegistry(deps).find(
    (item) => item.id === "command-code",
  );
  if (!provider) throw new Error("missing command-code provider");
  return provider;
}

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
