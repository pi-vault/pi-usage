import type { AggregatedUsageRow } from "../shared/types.ts";
import { padVisible } from "./dashboard-theme.ts";
import { formatAbbrev, formatCurrency } from "./formatters.ts";

export type TableColumn = {
  label: string;
  width: number;
  render: (row: AggregatedUsageRow) => string;
};

export function tableColumns(width: number): TableColumn[] {
  if (width >= 120) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Msgs", width: 6, render: (row) => `${row.messageCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
      { label: "↑In", width: 7, render: (row) => formatAbbrev(row.input) },
      { label: "↓Out", width: 7, render: (row) => formatAbbrev(row.output) },
      {
        label: "CacheR",
        width: 7,
        render: (row) => formatAbbrev(row.cacheRead),
      },
      {
        label: "CacheW",
        width: 7,
        render: (row) => formatAbbrev(row.cacheWrite),
      },
    ];
  }
  if (width >= 94) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Msgs", width: 6, render: (row) => `${row.messageCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
      { label: "↑In", width: 7, render: (row) => formatAbbrev(row.input) },
      { label: "↓Out", width: 7, render: (row) => formatAbbrev(row.output) },
    ];
  }
  if (width >= 72) {
    return [
      { label: "Sessions", width: 8, render: (row) => `${row.sessionCount}` },
      { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
      { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
    ];
  }
  return [
    { label: "Cost", width: 8, render: (row) => formatCurrency(row.cost) },
    { label: "Tokens", width: 7, render: (row) => formatAbbrev(row.tokens) },
  ];
}

export function labelWidth(columns: TableColumn[], width: number): number {
  const columnWidth =
    columns.reduce((sum, column) => sum + column.width, 0) +
    Math.max(0, (columns.length - 1) * 2);
  return Math.max(18, width - columnWidth - 2);
}

export function tableLine(
  label: string,
  columns: TableColumn[],
  providerWidth: number,
  row?: AggregatedUsageRow,
): string {
  const cells = columns.map((column) =>
    padVisible(row ? column.render(row) : column.label, column.width, "right"),
  );
  return `${padVisible(label, providerWidth, "left")}  ${cells.join("  ")}`;
}

export function separator(
  columns: TableColumn[],
  providerWidth: number,
): string {
  const width =
    providerWidth +
    2 +
    columns.reduce((sum, column) => sum + column.width, 0) +
    Math.max(0, (columns.length - 1) * 2);
  return "─".repeat(width);
}
