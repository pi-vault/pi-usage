import type { ProviderId, UsageWindow } from "./types.ts";

export const PROVIDER_ORDER: ProviderId[] = [
  "offline",
  "openai-codex",
  "minimax",
  "stepfun",
  "opencode-go",
  "command-code",
  "openrouter",
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  offline: "Offline",
  "openai-codex": "OpenAI/Codex",
  minimax: "MiniMax",
  stepfun: "StepFun",
  "opencode-go": "OpenCode Go",
  "command-code": "Command Code",
  openrouter: "OpenRouter",
};

export const PROVIDER_TTLS_MS = {
  "openai-codex": 30 * 60 * 1000,
  minimax: 30 * 60 * 1000,
  stepfun: 30 * 60 * 1000,
  "opencode-go": 30 * 60 * 1000,
  "command-code": 30 * 60 * 1000,
  openrouter: 30 * 60 * 1000,
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
  dashboardFooters: {
    statistics: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[Up/Down] Row",
      "[Enter] Expand",
      "[q/Esc] Close",
    ].join(" • "),
    current: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Provider",
      "[q/Esc] Close",
    ].join(" • "),
    insights: [
      "[Tab/Shift-Tab] Switch tab",
      "[Left/Right] Period",
      "[q/Esc] Close",
    ].join(" • "),
  },
  dashboardBorderedSectionTitles: {
    usageStatistics: "Usage Statistics",
    currentUsage: "Current Usage",
    insights: "Insights",
    notes: "Notes",
  },
  dashboardDefaultPeriod: "allTime" as UsageWindow,
} as const;
