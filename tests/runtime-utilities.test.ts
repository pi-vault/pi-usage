import { describe, expect, it, vi } from "vitest";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  clampPercent,
  clampPercentRounded,
  fetchWithTimeout,
  readJsonObject,
} from "../src/providers/runtime.ts";

describe("fetchWithTimeout", () => {
  it("returns response on success within timeout", async () => {
    const deps = createDefaultDeps();
    deps.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await fetchWithTimeout(deps, "https://example.com/api", {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("aborts after timeout expires", async () => {
    const deps = createDefaultDeps();
    deps.fetch = vi.fn(async (_url, init) => {
      await new Promise((_, reject) => {
        (init?.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
      return new Response();
    });
    await expect(
      fetchWithTimeout(deps, "https://example.com/slow", {}, 10),
    ).rejects.toThrow();
  });

  it("respects external signal", async () => {
    const deps = createDefaultDeps();
    const external = AbortSignal.abort();
    deps.fetch = vi.fn(async (_url, init) => {
      (init?.signal as AbortSignal).throwIfAborted();
      return new Response();
    });
    await expect(
      fetchWithTimeout(deps, "https://example.com", { signal: external }),
    ).rejects.toThrow();
  });

  it("cleans up timer on success", async () => {
    const deps = createDefaultDeps();
    const clearSpy = vi.spyOn(deps, "clearTimeout");
    deps.fetch = vi.fn(async () => new Response("ok"));
    await fetchWithTimeout(deps, "https://example.com", {});
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up timer on fetch error", async () => {
    const deps = createDefaultDeps();
    const clearSpy = vi.spyOn(deps, "clearTimeout");
    deps.fetch = vi.fn(async () => {
      throw new Error("network failure");
    });
    await expect(
      fetchWithTimeout(deps, "https://example.com", {}),
    ).rejects.toThrow("network failure");
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
