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
            input: 10,
            output: 20,
            cache: 5,
            cacheRead: 2,
            cacheWrite: 3,
            tokens: 33,
            cost: 1,
          },
          providers: [
            {
              key: "openai-codex",
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
    currentProviderId: null,
    currentProviderSnapshot: null,
    providers: [],
    diagnostics: [],
    compatibility: {
      currentLiveProviderId: null,
      currentLiveProviderSnapshot: null,
    },
  };
}

describe("dashboard render", () => {
  it("shows cacheR/cacheW in wide layout", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    const out = c.render(100).join("\n");
    expect(out).toContain("cacheR:2 cacheW:3");
  });

  it("drops cache fields in compact and tiny layouts", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    expect(c.render(80).join("\n")).not.toContain("cacheR:");
    expect(c.render(60).join("\n")).not.toContain("cacheR:");
  });

  it("expanded rows carry cache fields in wide layout", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    c.handleInput("\r");
    const out = c.render(100).join("\n");
    expect(out).toContain("- gpt-5 $1.00 tok:33 in:10 out:20 cacheR:2 cacheW:3 msg:1");
  });

  it("keeps insights toggle and navigation behavior", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined);
    c.handleInput("v");
    expect(c.render(100).join("\n")).toContain("Insights");
    c.handleInput("v");
    expect(c.render(100).join("\n")).toContain("Total:");
  });
});
