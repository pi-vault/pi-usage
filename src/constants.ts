import type { ProviderId, UsageWindow } from "./types.ts";

export const PROVIDER_ORDER: ProviderId[] = [
  "offline",
  "openai-codex",
  "openrouter",
  "minimax",
  "opencode-go",
  "command-code",
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  offline: "Offline",
  "openai-codex": "OpenAI/Codex",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  "opencode-go": "OpenCode Go",
  "command-code": "Command Code",
};

export const PROVIDER_TTLS_MS = {
  "openai-codex": 5 * 60 * 1000,
  openrouter: 5 * 60 * 1000,
  minimax: 5 * 60 * 1000,
  "opencode-go": 5 * 60 * 1000,
  "command-code": 5 * 60 * 1000,
} as const;

export const LOCK_TIMINGS_MS = {
  stale: 5_000,
  wait: 750,
  poll: 50,
} as const;

export const DEFAULT_BACKOFF_MS = 60_000;

export const PERIOD_ORDER: UsageWindow[] = [
  "today",
  "thisWeek",
  "lastWeek",
  "allTime",
];

export const UI_STRINGS = {
  dashboardTitle: "Pi Usage Dashboard",
  dashboardFooter: [
    "[Tab/Shift-Tab] Provider",
    "[Left/Right] Period",
    "[Up/Down] Row",
    "[Enter/Space] Expand/Collapse",
    "[v] Insights",
    "[q/Esc] Close",
  ].join(" • "),
  dashboardBorderedSectionTitles: {
    usageStatistics: "Usage Statistics",
    currentUsage: "Current Usage",
    insights: "Insights",
    notes: "Notes",
  },
  dashboardBorderChars: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    separatorLeft: "├",
    separatorRight: "┤",
  },
  dashboardDefaultPeriod: "allTime" as UsageWindow,
} as const;
