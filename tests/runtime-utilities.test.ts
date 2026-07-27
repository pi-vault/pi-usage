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
      const signal = init?.signal;
      if (!signal) throw new Error("fetch signal missing");
      await new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
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
      const signal = init?.signal;
      if (!signal) throw new Error("fetch signal missing");
      signal.throwIfAborted();
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

describe("readJsonObject", () => {
  it("returns parsed object on valid JSON", async () => {
    const res = new Response(JSON.stringify({ foo: 1 }));
    expect(await readJsonObject(res)).toEqual({ foo: 1 });
  });

  it("returns undefined on invalid JSON", async () => {
    const res = new Response("not json");
    expect(await readJsonObject(res)).toBeUndefined();
  });

  it("returns undefined on array JSON", async () => {
    const res = new Response(JSON.stringify([1, 2]));
    expect(await readJsonObject(res)).toBeUndefined();
  });

  it("returns undefined on null JSON", async () => {
    const res = new Response("null");
    expect(await readJsonObject(res)).toBeUndefined();
  });
});

describe("clampPercent", () => {
  it("clamps below 0 to 0", () => {
    expect(clampPercent(-5)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(clampPercent(150)).toBe(100);
  });

  it("preserves fractional values", () => {
    expect(clampPercent(42.7)).toBe(42.7);
    expect(clampPercent(12.4)).toBe(12.4);
  });

  it("passes through valid values unchanged", () => {
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(100)).toBe(100);
  });
});

describe("clampPercentRounded", () => {
  it("clamps and rounds below 0 to 0", () => {
    expect(clampPercentRounded(-5)).toBe(0);
  });

  it("clamps and rounds above 100 to 100", () => {
    expect(clampPercentRounded(150)).toBe(100);
  });

  it("rounds to nearest integer", () => {
    expect(clampPercentRounded(42.7)).toBe(43);
    expect(clampPercentRounded(42.3)).toBe(42);
  });

  it("passes through integers unchanged", () => {
    expect(clampPercentRounded(0)).toBe(0);
    expect(clampPercentRounded(50)).toBe(50);
    expect(clampPercentRounded(100)).toBe(100);
  });
});
