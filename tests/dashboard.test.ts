import { describe, expect, it } from "vitest";
import { UsageDashboardComponent } from "../src/ui/dashboard.ts";
import type { UsageCoreState } from "../src/types.ts";

function mkState(): UsageCoreState {
  return {
    refreshRequested: false,
    generatedAt: 0,
    loading: false,
    offline: {
      providerId: "offline",
      totals: [],
      scannedFiles: 0,
      messageCount: 1,
      periods: [
        {
          key: "today",
          total: {
            key: "total",
            sessionCount: 1,
            messageCount: 1,
            input: 120000,
            output: 305000,
            cache: 5000,
            cacheRead: 2000,
            cacheWrite: 3000,
            tokens: 428000,
            cost: 1,
          },
          providers: [
            {
              key: "openai-codex",
              sessionCount: 1,
              messageCount: 1,
              input: 120000,
              output: 305000,
              cache: 5000,
              cacheRead: 2000,
              cacheWrite: 3000,
              tokens: 428000,
              cost: 1,
            },
          ],
          modelsByProvider: {
            "openai-codex": [
              {
                key: "gpt-5",
                sessionCount: 1,
                messageCount: 1,
                input: 10,
                output: 20,
                cache: 5,
                cacheRead: 2,
                cacheWrite: 3,
                tokens: 33,
                cost: 1,
              },
            ],
          },
        },
      ],
    },
    insights: [{ label: "x", cost: 1, detail: "y" }],
    currentProviderId: "command-code",
    currentProviderSnapshot: {
      providerId: "command-code",
      providerLabel: "Command Code",
      available: true,
      diagnostic: "",
      fetchedAt: 0,
      balances: [],
      status: "live",
      sourceLabel: "Command Code web usage API",
      sourceKind: "live",
      staleAgeMs: 4500,
      windows: [
        {
          key: "current-cycle",
          label: "Current cycle",
          used: 4.2888,
          limit: 10,
          unit: "USD",
          usedPercent: 43,
          resetAt: Date.parse("2026-06-07T11:47:00"),
        },
      ],
      diagnostics: ["Subscription endpoint unavailable."],
      planName: "Go",
    },
    providers: [
      {
        providerId: "openai-codex",
        providerLabel: "OpenAI/Codex",
        available: false,
        diagnostic: "",
        fetchedAt: 0,
        balances: [],
        status: "unavailable",
        sourceLabel: "ChatGPT usage API",
        sourceKind: "none",
        staleAgeMs: 0,
        windows: [],
        diagnostics: ["Live cache is unavailable."],
      },
      {
        providerId: "minimax",
        providerLabel: "MiniMax",
        available: true,
        diagnostic: "",
        fetchedAt: 0,
        balances: [],
        status: "live",
        sourceLabel: "MiniMax token plan API",
        sourceKind: "live",
        staleAgeMs: 0,
        windows: [],
        diagnostics: [],
      },
      {
        providerId: "opencode-go",
        providerLabel: "OpenCode Go",
        available: true,
        diagnostic: "",
        fetchedAt: 0,
        balances: [{ label: "Credits", remaining: 12.5, unit: "USD" }],
        status: "live",
        sourceLabel: "OpenCode Go dashboard",
        sourceKind: "live",
        staleAgeMs: 0,
        windows: [],
        diagnostics: [],
      },
      {
        providerId: "command-code",
        providerLabel: "Command Code",
        available: true,
        diagnostic: "",
        fetchedAt: 0,
        balances: [],
        status: "live",
        sourceLabel: "Command Code web usage API",
        sourceKind: "live",
        staleAgeMs: 4500,
        windows: [
          {
            key: "current-cycle",
            label: "Current cycle",
            used: 4.2888,
            limit: 10,
            unit: "USD",
            usedPercent: 43,
            resetAt: Date.parse("2026-06-07T11:47:00"),
          },
        ],
        diagnostics: ["Subscription endpoint unavailable."],
        planName: "Go",
      },
    ],
    diagnostics: [],
    compatibility: {
      currentLiveProviderId: null,
      currentLiveProviderSnapshot: null,
    },
  };
}

describe("dashboard render", () => {
  it("renders usage statistics + current usage with selected provider details", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    const out = c.render(140).join("\n");

    expect(out).toContain("Usage Statistics");
    expect(out).toContain("[Today]");
    expect(out).toContain("Provider / Model");
    expect(out).toContain("openai-codex");
    expect(out).toContain("428k");

    expect(out).toContain(
      "Tokens = Input + Output + CacheW • ↑In = Input + CacheW • ↓Out = Output • CacheR = Cache Read • CacheW = Cache Write",
    );

    expect(out).toContain("Current Usage");
    expect(out).toContain(
      "OpenAI/Codex    MiniMax    OpenCode Go    [Command Code]",
    );
    expect(out).toContain("Command Code (Go) • live • 4s old");
    expect(out).toContain("Current cycle: $4.29/$10.00");
    expect(out).toContain("% left • Resets Jun 7, 2026 11:47 AM");

    expect(out).not.toContain("Pi Usage Dashboard");
    expect(out).not.toContain(">_ Pi Usage");
    expect(out).not.toContain("Provider:");
    expect(out).not.toContain("Model:");
    expect(out).not.toContain("Offline:");
    expect(out).not.toContain("Command Code web usage API");
  });

  it("wraps joined legend and supports arrow-based provider navigation", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    const narrow = c.render(80).join("\n");
    expect(narrow).toContain(
      "Tokens = Input + Output + CacheW • ↑In = Input + CacheW",
    );
    expect(narrow).toContain("CacheR = Cache Read • CacheW = Cache Write");

    const wrappedTabs = c.render(36).join("\n");
    expect(wrappedTabs).toContain("OpenAI/Codex    MiniMax");
    expect(wrappedTabs).toContain("OpenCode Go    [Command Code]");

    c.handleInput("\u001b[D");
    let out = c.render(120).join("\n");
    expect(out).toContain("[OpenCode Go]");
    expect(out).toContain("Credits: $12.50");

    c.handleInput("\u001b[C");
    out = c.render(120).join("\n");
    expect(out).toContain("[Command Code]");
  });

  it("uses tab for period changes and keeps insights toggle and expand behavior", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    c.handleInput("v");
    expect(c.render(100).join("\n")).toContain("Insights");
    c.handleInput("v");
    c.handleInput("\r");
    expect(c.render(120).join("\n")).toContain("  gpt-5");
    c.handleInput("\t");
    expect(c.render(120).join("\n")).toContain("[This Week]");
    expect(c.render(120).join("\n")).toContain("No local session usage found.");
    expect(c.render(120).join("\n")).toContain("Tab period");
    expect(c.render(120).join("\n")).toContain("←→ provider");
  });
});
