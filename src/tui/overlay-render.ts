/**
 * Overlay rendering utilities for the usage dashboard.
 *
 * Replicates patterns from the pi-extension-manager's render helpers using
 * the dashboard's own DashboardTheme adapter so colors flow through Pi's
 * live theme.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DashboardTheme } from "./dashboard-theme.ts";

// ── Layout constants ────────────────────────────────────────────────────

const PADDING_X = 2;
const PADDING_Y = 1;

// ── Frame glyphs ────────────────────────────────────────────────────────

const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

// ── Tab types ───────────────────────────────────────────────────────────

export interface DashboardTab {
  id: string;
  label: string;
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Pad `text` to exactly `width` visible columns. Truncates if wider.
 */
export function pad(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

/**
 * Calculate the content width inside a frame (excluding borders and padding).
 */
export function frameContentWidth(width: number): number {
  return Math.max(1, width - 2 - PADDING_X * 2);
}

// ── Frame ───────────────────────────────────────────────────────────────

/**
 * Wrap content `lines` in a bordered frame box.
 *
 * Matches the pi-extension-manager's frame rendering:
 * - Top/bottom borders with optional title
 * - PADDING_Y blank rows above/below content
 * - PADDING_X space columns on each side of content
 * - Overflow truncation with "↓ N more line(s)" when fixedInnerRows is set
 */
export function frame(
  lines: string[],
  width: number,
  theme: DashboardTheme,
  fixedInnerRows?: number,
  title = "",
): string[] {
  const inner = Math.max(1, width - 2);
  const contentWidth = frameContentWidth(width);
  const border = (s: string) => theme.fg("borderAccent", s);

  let body = lines;
  if (fixedInnerRows !== undefined && body.length > fixedInnerRows) {
    const hidden = body.length - fixedInnerRows + 1;
    body = [
      ...body.slice(0, Math.max(0, fixedInnerRows - 1)),
      theme.fg("dim", `↓ ${hidden} more line(s)`),
    ].slice(0, fixedInnerRows);
  }

  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;

  const top = (): string => {
    if (!title) {
      return `${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`;
    }
    const titleText = ` ${truncateToWidth(title, Math.max(1, inner - 2), "…")} `;
    const fill = Math.max(1, inner - visibleWidth(titleText));
    return `${border(FRAME.tl)}${theme.fg("accent", titleText)}${border(FRAME.h.repeat(fill))}${border(FRAME.tr)}`;
  };

  const out = [top()];
  for (let i = 0; i < PADDING_Y; i += 1) out.push(blank);
  for (const line of body) {
    out.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }
  for (let i = 0; i < PADDING_Y; i += 1) out.push(blank);
  out.push(
    `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`,
  );
  return out.map((line) => truncateToWidth(line, width, ""));
}

// ── Tab bar ─────────────────────────────────────────────────────────────

function activePill(theme: DashboardTheme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: DashboardTheme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

/**
 * Render a tab bar with pill-styled active/inactive tabs.
 *
 * Dynamic visibility: expands tabs around the active tab to fit `width`,
 * showing ‹/› indicators when tabs overflow.
 */
export function renderTabBar(
  tabs: DashboardTab[],
  activeId: string,
  width: number,
  theme: DashboardTheme,
): string {
  const safeWidth = Math.max(1, width);
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2); // " label "

  const sliceWidth = (s: number, e: number): number => {
    let total = 0;
    for (let i = s; i < e; i += 1) total += widths[i]!;
    total += Math.max(0, e - s - 1); // single-space gaps
    total += s > 0 ? 2 : 0; // "‹ "
    total += e < tabs.length ? 2 : 0; // " ›"
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };
    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId
      ? activePill(theme, label)
      : inactivePill(theme, label);
  });
  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return pad(cells.join(" "), safeWidth);
}
