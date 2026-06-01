import { describe, expect, it } from "vitest";
import { UsageDashboardComponent } from "../src/ui/dashboard.ts";
import type { LiveUsageWindow, UsageCoreState } from "../src/types.ts";

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

function setWindows(state: UsageCoreState, windows: LiveUsageWindow[]) {
  const cc = state.providers.find((p) => p.providerId === "command-code");
  if (!cc) throw new Error("command-code provider not found in test state");
  cc.windows = windows;
  if (!state.currentProviderSnapshot)
    throw new Error("currentProviderSnapshot not found in test state");
  state.currentProviderSnapshot.windows = windows;
}

function expectedResetText(resetAt: number | undefined): string {
  if (!resetAt) return "(reset unavailable)";
  const resetDate = new Date(resetAt);
  const nowDate = new Date();
  const hours = String(resetDate.getHours()).padStart(2, "0");
  const minutes = String(resetDate.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;
  const isSameDay =
    resetDate.getFullYear() === nowDate.getFullYear() &&
    resetDate.getMonth() === nowDate.getMonth() &&
    resetDate.getDate() === nowDate.getDate();
  if (isSameDay) {
    return `(resets ${timeStr})`;
  }
  const monthStr = resetDate.toLocaleDateString("en-US", { month: "short" });
  const day = resetDate.getDate();
  return `(resets ${timeStr} on ${day} ${monthStr})`;
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
    expect(out).toContain("57% left");
    expect(out).toContain(expectedResetText(Date.parse("2026-06-07T11:47:00")));
    expect(out).toContain("$4.29/$10.00");
    expect(out).not.toContain("• Resets");

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

  it("aligns quota bars by shared label width across available windows", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "5h",
        label: "5h",
        usedPercent: 50,
        resetAt: Date.now() + 3600000,
      },
      {
        key: "weekly",
        label: "Weekly",
        usedPercent: 10,
        resetAt: Date.now() + 86400000 * 7,
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const lines = c.render(200);

    const line5h = lines.find((l) => l.startsWith("5h") && l.includes("["));
    const lineWeekly = lines.find(
      (l) => l.startsWith("Weekly") && l.includes("["),
    );

    expect(line5h).toBeDefined();
    expect(lineWeekly).toBeDefined();

    // Opening brackets must align vertically
    const bracket5h = line5h?.indexOf("[") ?? -1;
    const bracketWeekly = lineWeekly?.indexOf("[") ?? -1;
    expect(bracket5h).toBe(bracketWeekly);

    // Shorter label is padded to match the longest available-window label
    expect(line5h).toMatch(/5h\s+:/);
  });

  it("rounds fractional usedPercent to integer remaining percentage", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "cycle",
        label: "Cycle",
        usedPercent: 43.7,
        resetAt: Date.now() + 3600000,
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const out = c.render(140).join("\n");

    // 100 - 43.7 = 56.3, rounded to 56
    expect(out).toContain("56% left");
    expect(out).not.toContain("56.3%");
  });

  it("formats same-day reset as HH:mm only", () => {
    const now = new Date();
    const sameDayReset = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      14,
      30,
    ).getTime();

    const state = mkState();
    setWindows(state, [
      {
        key: "cycle",
        label: "Cycle",
        usedPercent: 50,
        resetAt: sameDayReset,
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const out = c.render(140).join("\n");

    expect(out).toContain("(resets 14:30)");
    expect(out).not.toContain(" on ");
  });

  it("formats cross-day reset as HH:mm on D MMM", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "cycle",
        label: "Cycle",
        usedPercent: 50,
        resetAt: Date.parse("2026-06-07T11:47:00"),
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const out = c.render(140).join("\n");

    expect(out).toContain(expectedResetText(Date.parse("2026-06-07T11:47:00")));
  });

  it("renders reset unavailable when resetAt is absent", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "cycle",
        label: "Cycle",
        usedPercent: 50,
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const out = c.render(140).join("\n");

    expect(out).toContain("(reset unavailable)");
  });

  it("renders unavailable windows without bar and does not affect alignment", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "5h",
        label: "5h",
        usedPercent: 50,
        resetAt: Date.now() + 3600000,
      },
      {
        key: "daily",
        label: "Daily",
        usedPercent: 30,
        resetAt: Date.now() + 86400000,
      },
      {
        key: "verylong",
        label: "VeryLongName",
        usedPercent: 10,
        unavailableReason: "Not applicable",
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const lines = c.render(200);

    const line5h = lines.find((l) => l.startsWith("5h") && l.includes("["));
    const lineDaily = lines.find(
      (l) => l.startsWith("Daily") && l.includes("["),
    );
    const lineLong = lines.find(
      (l) => l.includes("VeryLongName") && l.includes("Not applicable"),
    );

    expect(line5h).toBeDefined();
    expect(lineDaily).toBeDefined();
    expect(lineLong).toBeDefined();

    // Unavailable window has no bar or percentage
    expect(lineLong).not.toContain("[");
    expect(lineLong).not.toContain("% left");

    // Available windows' bars align (maxLabelWidth from "5h" and "Daily" only)
    const bracket5h = line5h?.indexOf("[") ?? -1;
    const bracketDaily = lineDaily?.indexOf("[") ?? -1;
    expect(bracket5h).toBe(bracketDaily);

    // "5h" is padded to "Daily" width (5 chars), not "VeryLongName" width (12 chars)
    expect(line5h).toMatch(/5h\s+:/);
  });

  it("renders quota row without ratio when used/limit/unit are incomplete", () => {
    const state = mkState();
    setWindows(state, [
      {
        key: "cycle",
        label: "Cycle",
        usedPercent: 50,
        resetAt: Date.now() + 3600000,
      },
    ]);

    const c = new UsageDashboardComponent(state, () => undefined);
    const out = c.render(140).join("\n");

    expect(out).toContain("50% left");
    // No ratio suffix should appear
    expect(out).not.toContain(" - $");
    expect(out).not.toContain(" requests");
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
