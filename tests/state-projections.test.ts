import { describe, expect, it } from "vitest";
import {
  projectState,
  type InternalState,
} from "../src/core/state-projections.ts";
import type { ProviderUsageSnapshot } from "../src/shared/types.ts";

function makeSnapshot(
  overrides: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    providerId: "openai-codex",
    providerLabel: "OpenAI/Codex",
    available: true,
    diagnostic: "",
    fetchedAt: 1000,
    balances: [],
    status: "live",
    sourceLabel: "OpenAI rate-limit API",
    sourceKind: "live",
    windows: [],
    diagnostics: [],
    ...overrides,
  };
}

function makeInternalState(
  overrides: Partial<InternalState> = {},
): InternalState {
  return {
    refreshRequested: false,
    generatedAt: 0,
    loading: false,
    offline: {
      providerId: "offline",
      totals: [],
      periods: [],
      scannedFiles: 0,
      messageCount: 0,
    },
    insights: [],
    currentProviderId: null,
    providers: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("projectState", () => {
  it("returns null snapshot when currentProviderId is null", () => {
    const result = projectState(makeInternalState({ currentProviderId: null }));
    expect(result.currentProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
  });

  it("returns null snapshot when provider not found in providers[]", () => {
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [makeSnapshot({ providerId: "minimax" })],
      }),
    );
    expect(result.currentProviderSnapshot).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("returns currentProviderSnapshot but NOT compatibility when no valid compat windows", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "daily", label: "Daily", usedPercent: 50 },
        {
          key: "fiveHour",
          label: "5h",
          usedPercent: 20,
          unavailableReason: "Rate limit exceeded",
        },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.compatibility.currentLiveProviderSnapshot).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("populates compatibility when provider has valid fiveHour window", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "fiveHour", label: "5-hour", usedPercent: 42 },
        { key: "daily", label: "Daily", usedPercent: 10 },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    expect(result.compatibility.currentLiveProviderId).toBe("openai-codex");
    expect(result.compatibility.currentLiveProviderSnapshot).toEqual(snapshot);
    expect(result.provider).toBe("OpenAI/Codex");
    expect(result.usage).toBeDefined();
    expect(result.usage!.provider).toBe("openai-codex");
    expect(result.usage!.displayName).toBe("OpenAI/Codex");
    // Only fiveHour window (daily excluded from usage.windows)
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({
      label: "5-hour",
      usedPercent: 42,
    });
  });

  it("populates compatibility when provider has valid weekly window", () => {
    const snapshot = makeSnapshot({
      providerId: "minimax",
      providerLabel: "MiniMax",
      windows: [{ key: "weekly", label: "Weekly", usedPercent: 75 }],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "minimax",
        providers: [snapshot],
      }),
    );
    expect(result.compatibility.currentLiveProviderId).toBe("minimax");
    expect(result.provider).toBe("MiniMax");
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({
      label: "Weekly",
      usedPercent: 75,
    });
  });

  it("filters unavailable windows from usage.windows", () => {
    const snapshot = makeSnapshot({
      providerId: "openai-codex",
      windows: [
        { key: "fiveHour", label: "5h", usedPercent: 30 },
        {
          key: "weekly",
          label: "Weekly",
          usedPercent: 0,
          unavailableReason: "No data",
        },
      ],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    // Gate passes because fiveHour is valid
    expect(result.compatibility.currentLiveProviderId).toBe("openai-codex");
    // usage.windows only includes fiveHour (weekly filtered due to unavailableReason)
    expect(result.usage!.windows).toHaveLength(1);
    expect(result.usage!.windows[0]).toEqual({ label: "5h", usedPercent: 30 });
  });

  it("handles provider with empty windows (gate fails)", () => {
    const snapshot = makeSnapshot({ windows: [] });
    const result = projectState(
      makeInternalState({
        currentProviderId: "openai-codex",
        providers: [snapshot],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(snapshot);
    expect(result.compatibility.currentLiveProviderId).toBeNull();
    expect(result.provider).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it("preserves all source-of-truth fields", () => {
    const state = makeInternalState({
      refreshRequested: true,
      generatedAt: 12345,
      loading: true,
      currentModelLabel: "codex-mini-latest",
      diagnostics: ["test diagnostic"],
    });
    const result = projectState(state);
    expect(result.refreshRequested).toBe(true);
    expect(result.generatedAt).toBe(12345);
    expect(result.loading).toBe(true);
    expect(result.currentModelLabel).toBe("codex-mini-latest");
    expect(result.diagnostics).toEqual(["test diagnostic"]);
  });

  it("selects correct provider from multiple providers", () => {
    const codex = makeSnapshot({
      providerId: "openai-codex",
      windows: [{ key: "fiveHour", label: "5h", usedPercent: 10 }],
    });
    const minimax = makeSnapshot({
      providerId: "minimax",
      providerLabel: "MiniMax",
      windows: [{ key: "weekly", label: "Weekly", usedPercent: 90 }],
    });
    const result = projectState(
      makeInternalState({
        currentProviderId: "minimax",
        providers: [codex, minimax],
      }),
    );
    expect(result.currentProviderSnapshot).toEqual(minimax);
    expect(result.compatibility.currentLiveProviderId).toBe("minimax");
    expect(result.provider).toBe("MiniMax");
  });
});
