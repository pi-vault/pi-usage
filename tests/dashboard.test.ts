import { describe, expect, it, vi } from "vitest";
import type { TUI } from "@earendil-works/pi-tui";
import { UsageDashboardComponent } from "../src/tui/dashboard.ts";
import {
  type DashboardTheme,
  noTheme,
} from "../src/tui/dashboard-theme.ts";
import type { LiveUsageWindow, UsageCoreState } from "../src/shared/types.ts";

const ANSI_ESCAPE = "\u001b";
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function makeAnsiTheme(): DashboardTheme & {
  calls: { method: string; color?: string; text: string }[];
} {
  const calls: { method: string; color?: string; text: string }[] = [];
  const wrap = (open: string) => (text: string) => {
    if (text.length === 0) return text;
    return `${open}${text}${ANSI_ESCAPE}[0m`;
  };
  return {
    calls,
    fg: (color, text) => {
      calls.push({ method: "fg", color, text });
      return wrap(`${ANSI_ESCAPE}[38;5;75m`)(text);
    },
    bg: (color, text) => {
      calls.push({ method: "bg", color, text });
      return wrap(`${ANSI_ESCAPE}[48;5;236m`)(text);
    },
    bold: (text) => {
      calls.push({ method: "bold", text });
      return `${ANSI_ESCAPE}[1m${text}${ANSI_ESCAPE}[22m`;
    },
    dim: (text) => {
      calls.push({ method: "dim", text });
      return wrap(`${ANSI_ESCAPE}[38;5;243m`)(text);
    },
    inverse: (text) => {
      calls.push({ method: "inverse", text });
      return `${ANSI_ESCAPE}[7m${text}${ANSI_ESCAPE}[27m`;
    },
  };
}

interface MockTui {
  requestRender: ReturnType<typeof vi.fn>;
  events?: { on: ReturnType<typeof vi.fn> };
}

function makeMockTui(): MockTui {
  return { requestRender: vi.fn() };
}

function mkPeriodData(): UsageCoreState["offline"]["periods"][number] {
  return {
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
  };
}

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
      // Populate every period so the All Time default still shows the table.
      periods: (["today", "thisWeek", "lastWeek", "allTime"] as const).map(
        (key) => ({ ...mkPeriodData(), key }),
      ),
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
        providerId: "stepfun",
        providerLabel: "StepFun",
        available: true,
        diagnostic: "",
        fetchedAt: 0,
        balances: [],
        status: "live",
        sourceLabel: "StepFun rate limit API",
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
      {
        providerId: "openrouter",
        providerLabel: "OpenRouter",
        available: true,
        diagnostic: "",
        fetchedAt: 0,
        balances: [
          { label: "Remaining", remaining: 45.5, unit: "USD" },
          { label: "Total credits", remaining: 100, unit: "USD" },
          { label: "Total usage", remaining: 54.5, unit: "USD" },
        ],
        status: "live",
        sourceLabel: "OpenRouter credits API",
        sourceKind: "live",
        staleAgeMs: 0,
        windows: [
          {
            key: "key-quota",
            label: "Key quota",
            usedPercent: 55,
            used: 54.5,
            limit: 100,
            unit: "USD",
          },
        ],
        diagnostics: [],
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
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const out = c.render(140).join("\n");

    expect(out).toContain("Usage Statistics");
    // Default period is All Time per the spec.
    expect(out).toContain("[All Time]");
    expect(out).toContain("Provider / Model");
    expect(out).toContain("openai-codex");
    expect(out).toContain("428k");

    expect(out).toContain(
      "Tokens = Input + Output + CacheW • ↑In = Input + CacheW • ↓Out = Output • CacheR = Cache Read • CacheW = Cache Write",
    );

    expect(out).toContain("Current Usage");
    expect(out).toContain(
      "OpenAI/Codex    MiniMax    StepFun    OpenCode Go    [Command Code]    OpenRouter",
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

  it("renders empty line between Usage Statistics title and period tabs", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const lines = c.render(140);

    const titleIdx = lines.findIndex((l) => l.includes("Usage Statistics"));
    expect(titleIdx).toBeGreaterThan(-1);
    expect(lines[titleIdx + 1]).toBe("");
    expect(lines[titleIdx + 2]).toContain("All Time");
  });

  it("wraps joined legend and supports tab-based provider navigation", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const narrow = c.render(80).join("\n");
    expect(narrow).toContain(
      "Tokens = Input + Output + CacheW • ↑In = Input + CacheW",
    );
    expect(narrow).toContain("CacheR = Cache Read • CacheW = Cache Write");

    const wrappedTabs = c.render(36).join("\n");
    expect(wrappedTabs).toContain("OpenAI/Codex    MiniMax    StepFun");
    expect(wrappedTabs).toContain("OpenCode Go    [Command Code]");
    expect(wrappedTabs).toContain("OpenRouter");

    // Provider navigation uses Tab/Shift-Tab per the new mapping.
    c.handleInput("\u001b[Z"); // Shift-Tab
    let out = c.render(120).join("\n");
    expect(out).toContain("[OpenCode Go]");
    expect(out).toContain("Credits: $12.50");

    c.handleInput("\t"); // Tab
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
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

    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
    const out = c.render(140).join("\n");

    expect(out).toContain("50% left");
    // No ratio suffix should appear
    expect(out).not.toContain(" - $");
    expect(out).not.toContain(" requests");
  });

  it("uses enter/space for expand, v for insights, and left/right for period changes", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    c.handleInput("v");
    expect(c.render(100).join("\n")).toContain("Insights");
    c.handleInput("v");

    // Enter expands the selected provider row to reveal its model rows.
    c.handleInput("\r");
    expect(c.render(120).join("\n")).toContain("gpt-5");

    // Left/Right change the period. Default is All Time (index 3); one Left
    // press moves to Last Week.
    c.handleInput("\u001b[D");
    expect(c.render(120).join("\n")).toContain("[Last Week]");

    // Two more Right presses move through This Week back to Today.
    c.handleInput("\u001b[C");
    c.handleInput("\u001b[C");
    expect(c.render(120).join("\n")).toContain("[Today]");

    // Period changes reset the selected row back to 0.
    expect(c.render(120).join("\n")).toContain("openai-codex");
  });

  it("renders insights grouped by category", () => {
    const state = mkState();
    state.insights = [
      { category: "project", label: "career-ops", cost: 9, detail: "90.0%" },
      { category: "project", label: "dotfiles", cost: 1, detail: "10.0%" },
      {
        category: "cost",
        label: "Large context",
        cost: 5,
        detail: "50.0% over 150k context",
      },
    ];
    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
    c.handleInput("v");
    const lines = c.render(100);
    const out = lines.join("\n");
    expect(out).toContain("Projects");
    expect(out).toContain("career-ops");
    expect(out).toContain("90.0%");
    expect(out).toContain("Cost patterns");
    expect(out).toContain("Large context");
    // Verify table structure for project category
    const projectsIdx = lines.findIndex((l) => l.includes("Projects"));
    expect(projectsIdx).toBeGreaterThan(-1);
    expect(lines[projectsIdx]).toContain("% of usage");
    expect(lines[projectsIdx + 1]).toContain("career-ops");
    // Verify bullet-list format for cost category
    expect(out).toContain("  - Large context:");
  });

  it("defaults insights without category to cost patterns", () => {
    const state = mkState();
    state.insights = [{ label: "No category", cost: 1, detail: "test" }];
    const c = new UsageDashboardComponent(state, () => undefined, {
      theme: noTheme,
    });
    c.handleInput("v");
    const out = c.render(100).join("\n");
    expect(out).toContain("Cost patterns");
    expect(out).toContain("  - No category:");
  });

  it("closes the dashboard on q and Esc, calling cancelScan", () => {
    const done = vi.fn();
    const cancelScan = vi.fn();
    const c = new UsageDashboardComponent(mkState(), done, {
      theme: noTheme,
      cancelScan,
    });

    c.handleInput("q");
    expect(done).toHaveBeenCalledTimes(1);
    expect(cancelScan).toHaveBeenCalledTimes(1);

    done.mockClear();
    cancelScan.mockClear();

    c.handleInput("\u001b");
    expect(done).toHaveBeenCalledTimes(1);
    expect(cancelScan).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard themed styling", () => {
  it("wraps section titles, borders, and dimmed helpers with ANSI escape codes", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    const lines = c.render(140);
    const out = lines.join("\n");

    // Top and bottom borders should be present with box-drawing characters.
    expect(out).toContain("╭");
    expect(out).toContain("╯");

    // Section titles should be themed bold + accent. The component composes
    // these as `fg("accent", bold(text))`, so the inner `bold` call receives
    // the plain title string and the outer `fg` call receives the bold
    // wrapped output.
    expect(
      theme.calls.some(
        (c) => c.method === "bold" && c.text === "Usage Statistics",
      ),
    ).toBe(true);
    expect(
      theme.calls.some(
        (c) =>
          c.method === "fg" &&
          c.color === "accent" &&
          c.text.includes("Usage Statistics"),
      ),
    ).toBe(true);

    // The current usage header should be followed by a separator line styled
    // with the muted-border color.
    const usageIndex = lines.findIndex((line) => line.includes("Current Usage"));
    expect(usageIndex).toBeGreaterThan(-1);
    const separator = lines[usageIndex + 1] ?? "";
    expect(separator).toContain("├");
    expect(separator).toContain("┤");

    // The footer should be dimmed.
    expect(out).toContain("[Tab/Shift-Tab] Provider");
    expect(
      theme.calls.some(
        (c) => c.method === "dim" && c.text.includes("[Tab/Shift-Tab] Provider"),
      ),
    ).toBe(true);
  });

  it("highlights the selected disclosure arrow + provider label and dims the rest", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    const lines = c.render(140);

    const providerLine = lines.find(
      (l) => l.includes("openai-codex") && l.includes("▸"),
    );
    expect(providerLine).toBeDefined();

    const plain = stripAnsi(providerLine ?? "");
    // No leading `>` cursor anywhere on the line.
    expect(plain.startsWith(">")).toBe(false);
    // The selected disclosure arrow + label is rendered, the row carries the
    // arrow and provider key.
    expect(plain).toContain("▸");
    expect(plain).toContain("openai-codex");
    expect(
      theme.calls.some(
        (c) =>
          c.method === "fg" &&
          c.color === "accent" &&
          c.text.includes("openai-codex"),
      ),
    ).toBe(true);
  });

  it("dims the inactive provider tabs in Current Usage", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    c.render(140);

    const dimmedLabels = theme.calls
      .filter((c) => c.method === "dim")
      .map((c) => c.text);
    // Inactive tab labels should appear in the dim list.
    expect(dimmedLabels).toContain("OpenAI/Codex");
    expect(dimmedLabels).toContain("MiniMax");
    expect(dimmedLabels).toContain("StepFun");
    expect(dimmedLabels).toContain("OpenCode Go");
    expect(dimmedLabels).toContain("OpenRouter");
    // The active tab is bold + accent, NOT dim.
    expect(dimmedLabels).not.toContain("Command Code");
  });

  it("splits CacheR and CacheW columns in wide layouts", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const out = c.render(140).join("\n");

    expect(out).toContain("CacheR");
    expect(out).toContain("CacheW");
    // The wide layout includes the abbreviated ↑In/↓Out columns.
    expect(out).toContain("↑In");
    expect(out).toContain("↓Out");
  });

  it("keeps compact breakpoints without the wide cache columns", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    // 80 columns: between the 72 and 94 breakpoints, the table collapses to
    // Sessions/Cost/Tokens. The compact layout should not surface the wide
    // cache or arrowed column labels in the table column header. The legend
    // references `CacheR`/`CacheW` for explanatory purposes; we constrain
    // the assertion to the header row specifically.
    const lines = c.render(80);
    const headerLine = lines.find((line) => line.includes("Provider / Model"));
    expect(headerLine).toBeDefined();
    expect(headerLine).not.toMatch(/\bCacheR\b/);
    expect(headerLine).not.toMatch(/\bCacheW\b/);
    expect(headerLine).not.toContain("↑In");
    expect(headerLine).not.toContain("↓Out");
  });

  it("aligns themed quota bars by visible width", () => {
    const theme = makeAnsiTheme();
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

    const c = new UsageDashboardComponent(state, () => undefined, { theme });
    const lines = c.render(200);
    const line5h = lines.find((l) => stripAnsi(l).startsWith("5h") && l.includes("["));
    const lineWeekly = lines.find(
      (l) => stripAnsi(l).startsWith("Weekly") && l.includes("["),
    );

    expect(line5h).toBeDefined();
    expect(lineWeekly).toBeDefined();

    // The opening bracket (after padding) is what we align on, not the
    // visual label start. Find the first `[` in each line and ensure the
    // visible-width columns match.
    const bracketIndex = (line: string) => stripAnsi(line).indexOf("[");
    expect(bracketIndex(line5h ?? "")).toBe(bracketIndex(lineWeekly ?? ""));
  });

  it("highlights the quota remaining-bar fill and percentage", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    c.render(140);

    // The fill glyphs should be wrapped in accent styling.
    const filledAccent = theme.calls.find(
      (c) => c.method === "fg" && c.color === "accent" && c.text.includes("█"),
    );
    expect(filledAccent).toBeDefined();

    // The percentage text should be accent-wrapped.
    const percentAccent = theme.calls.find(
      (c) => c.method === "fg" && c.color === "accent" && c.text === "57% left",
    );
    expect(percentAccent).toBeDefined();
  });

  it("dims the formula legend, reset text, and ratio text", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    c.render(140);

    const dimmed = theme.calls.filter((c) => c.method === "dim").map((c) => c.text);
    // Legend segments are wrapped via `dim` for each segment.
    expect(dimmed).toContain("Tokens = Input + Output + CacheW");
    expect(dimmed).toContain("CacheR = Cache Read");
    // Reset text gets dimmed.
    expect(
      dimmed.some((text) => text.startsWith("(resets ") || text.includes("reset unavailable")),
    ).toBe(true);
    // Ratio is dimmed.
    expect(dimmed).toContain("$4.29/$10.00");
  });

  it("renders the footer in [Shortcut] Action format with dimmed styling", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    const out = c.render(160).join("\n");
    const stripped = stripAnsi(out);

    // Each shortcut is wrapped in [].
    expect(stripped).toContain("[Tab/Shift-Tab] Provider");
    expect(stripped).toContain("[Left/Right] Period");
    expect(stripped).toContain("[Up/Down] Row");
    expect(stripped).toContain("[Enter/Space] Expand/Collapse");
    expect(stripped).toContain("[v] Insights");
    expect(stripped).toContain("[q/Esc] Close");

    // The full footer is a single string passed to `dim` (one call), not six.
    const footerDimCall = theme.calls.find(
      (c) =>
        c.method === "dim" &&
        c.text.includes("[Tab/Shift-Tab] Provider") &&
        c.text.includes("[q/Esc] Close"),
    );
    expect(footerDimCall).toBeDefined();
  });

  it("strips ANSI before applying final truncation so visible width is preserved", () => {
    const theme = makeAnsiTheme();
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme,
    });
    // Render with a narrow width - every visible line must not exceed it
    // even when ANSI escapes are present.
    const lines = c.render(40);
    for (const line of lines) {
      const visible = stripAnsi(line).length;
      expect(visible).toBeLessThanOrEqual(40);
    }
  });
});

describe("dashboard repaint subscription", () => {
  it("calls tui.requestRender when a usage-core:update-current event fires", () => {
    const tui = makeMockTui();
    const unsubscribe = vi.fn();
    const bus = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        expect(event).toBe("usage-core:update-current");
        bus.handler = handler;
        return unsubscribe;
      }),
      handler: undefined as ((...args: unknown[]) => void) | undefined,
    };
    (globalThis as { __piUsageBus?: unknown }).__piUsageBus = bus;

    try {
      new UsageDashboardComponent(mkState(), () => undefined, {
        theme: noTheme,
        tui: tui as unknown as TUI,
      });

      bus.handler?.();
      expect(tui.requestRender).toHaveBeenCalledTimes(1);

      bus.handler?.();
      expect(tui.requestRender).toHaveBeenCalledTimes(2);

      // The dashboard's invalidate() must release the listener.
      const c = new UsageDashboardComponent(mkState(), () => undefined, {
        theme: noTheme,
        tui: tui as unknown as TUI,
      });
      c.invalidate();
      expect(unsubscribe).toHaveBeenCalled();
    } finally {
      delete (globalThis as { __piUsageBus?: unknown }).__piUsageBus;
    }
  });

  it("does nothing if no TUI is provided", () => {
    expect(() => {
      new UsageDashboardComponent(mkState(), () => undefined, {
        theme: noTheme,
      });
    }).not.toThrow();
  });
});

describe("dashboard responsive layout", () => {
  it("renders at very narrow widths without breaking the table", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const lines = c.render(30);
    for (const line of lines) {
      const visible = line.replace(ANSI_PATTERN, "").length;
      expect(visible).toBeLessThanOrEqual(30);
    }
    expect(lines.join("\n")).toContain("Usage Statistics");
    expect(lines.join("\n")).toContain("Current Usage");
  });

  it("falls back to a minimal two-column table at the smallest breakpoint", () => {
    const c = new UsageDashboardComponent(mkState(), () => undefined, {
      theme: noTheme,
    });
    const lines = c.render(50);
    const out = lines.join("\n");
    // The narrowest layout should drop Sessions/Msgs in favor of Cost/Tokens.
    expect(out).not.toContain("Sessions");
    expect(out).not.toContain("Msgs");
    expect(out).toContain("Cost");
    expect(out).toContain("Tokens");
  });
});
