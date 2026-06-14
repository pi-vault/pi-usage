import type { ProviderUsageSnapshot } from "../shared/types.ts";

export function formatAge(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s old`;
  return `${Math.floor(ageMs / 60_000)}m old`;
}

export function formatCurrency(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

export function formatAbbrev(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const n = Math.round(value);
  if (Math.abs(n) < 1000) return `${n}`;
  const abs = Math.abs(n);
  const format = (v: number, suffix: string) => {
    const digits = v >= 100 ? 0 : 1;
    const text = v.toFixed(digits).replace(/\.0$/, "");
    return `${n < 0 ? "-" : ""}${text}${suffix}`;
  };
  if (abs < 1_000_000) return format(abs / 1_000, "k");
  if (abs < 1_000_000_000) return format(abs / 1_000_000, "M");
  return format(abs / 1_000_000_000, "B");
}

export function formatResetCompact(
  resetAt: number | undefined,
  now = Date.now(),
): string {
  if (!resetAt) return "(reset unavailable)";
  const resetDate = new Date(resetAt);
  const nowDate = new Date(now);
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

export function formatRatio(
  window: ProviderUsageSnapshot["windows"][number],
): string | undefined {
  if (window.used == null || window.limit == null || !window.unit) {
    return undefined;
  }
  if (window.unit === "USD") {
    return `${formatCurrency(window.used)}/${formatCurrency(window.limit)}`;
  }
  if (window.unit === "requests") {
    return `${formatAbbrev(window.used)}/${formatAbbrev(window.limit)} requests`;
  }
  return `${formatAbbrev(window.used)}/${formatAbbrev(window.limit)} ${window.unit}`;
}
