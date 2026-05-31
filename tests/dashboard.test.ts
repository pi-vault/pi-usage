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
  it("renders focused provider heading, currency, bar, reset text, and token abbreviations", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    const out = c.render(140).join("\n");
    expect(out).toContain("Command Code (Go) • live (Command Code web usage API) • 4s old");
    expect(out).toContain("Current cycle: $4.29/$10.00");
    expect(out).toContain("% left");
    expect(out).toContain("Resets Jun 7, 2026 11:47 AM");
    expect(out).toContain("Provider / Model");
    expect(out).toContain("openai-codex");
    expect(out).toContain("428k");
    expect(out).toContain("120k");
    expect(out).not.toContain("123k");
    expect(out).toContain("   Tokens");
    expect(out).toContain("Tokens = Input + Output + CacheW");
    expect(out).toContain("* Command Code: Subscription endpoint unavailable.");
  });

  it("keeps insights toggle and expand behavior", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    c.handleInput("v");
    expect(c.render(100).join("\n")).toContain("Insights");
    c.handleInput("v");
    c.handleInput("\r");
    expect(c.render(120).join("\n")).toContain("  gpt-5");
  });
});
