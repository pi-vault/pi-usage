# Phase 3 — Extract Dashboard Formatting + Table Layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull formatting functions and table rendering logic out of `dashboard.ts` (768 lines) into independently testable modules, reducing it to <=450 lines.

**Architecture:** Extract pure functions (formatters) and table layout logic (column selection, row rendering) into separate files. `dashboard.ts` imports from them. No behavior change.

**Tech Stack:** TypeScript 6, Vitest, `@earendil-works/pi-tui` (visibleWidth, padVisible helpers).

**Independent of:** Other phases. Can run any time after Phase 1.

**Verification:** `pnpm check` (biome lint + tsc --noEmit + vitest run)

---

## File Structure

| File                      | Responsibility                                                                                      | ~Lines |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| `src/tui/formatters.ts`   | Pure formatting: `formatAge`, `formatCurrency`, `formatAbbrev`, `formatResetCompact`, `formatRatio` | ~80    |
| `src/tui/table-layout.ts` | Column definitions, width calc, row/separator rendering                                             | ~80    |
| `src/tui/dashboard.ts`    | Component class + rendering (imports from above)                                                    | ~450   |

---

### Task 1: Create `src/tui/formatters.ts`

**Files:**

- Create: `src/tui/formatters.ts`

- [ ] **Step 1: Create formatters module**

Extract these pure functions verbatim from `dashboard.ts` (lines 48-130):

```typescript
// src/tui/formatters.ts
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
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(tui): extract pure formatting functions to formatters.ts
```

---

### Task 2: Create `tests/formatters.test.ts`

**Files:**

- Create: `tests/formatters.test.ts`

- [ ] **Step 1: Write comprehensive formatter tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatAbbrev,
  formatCurrency,
  formatRatio,
  formatResetCompact,
} from "../src/tui/formatters.ts";

describe("formatAge", () => {
  it("shows seconds for <60s", () => {
    expect(formatAge(0)).toBe("0s old");
    expect(formatAge(5_000)).toBe("5s old");
    expect(formatAge(59_999)).toBe("59s old");
  });

  it("shows minutes for >=60s", () => {
    expect(formatAge(60_000)).toBe("1m old");
    expect(formatAge(90_000)).toBe("1m old");
    expect(formatAge(3_600_000)).toBe("60m old");
  });
});

describe("formatCurrency", () => {
  it("returns - for null/undefined/NaN/Infinity", () => {
    expect(formatCurrency(null)).toBe("-");
    expect(formatCurrency(undefined)).toBe("-");
    expect(formatCurrency(NaN)).toBe("-");
    expect(formatCurrency(Infinity)).toBe("-");
  });

  it("formats valid numbers with 2 decimal places", () => {
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(1.1)).toBe("$1.10");
    expect(formatCurrency(99.999)).toBe("$100.00");
    expect(formatCurrency(-5.5)).toBe("$-5.50");
  });
});

describe("formatAbbrev", () => {
  it("returns - for null/undefined/NaN/Infinity", () => {
    expect(formatAbbrev(null)).toBe("-");
    expect(formatAbbrev(undefined)).toBe("-");
    expect(formatAbbrev(NaN)).toBe("-");
    expect(formatAbbrev(Infinity)).toBe("-");
  });

  it("shows raw number for <1000", () => {
    expect(formatAbbrev(0)).toBe("0");
    expect(formatAbbrev(999)).toBe("999");
    expect(formatAbbrev(-500)).toBe("-500");
  });

  it("shows k suffix for 1k-999k", () => {
    expect(formatAbbrev(1_000)).toBe("1k");
    expect(formatAbbrev(1_500)).toBe("1.5k");
    expect(formatAbbrev(150_000)).toBe("150k");
  });

  it("shows M suffix for 1M-999M", () => {
    expect(formatAbbrev(1_000_000)).toBe("1M");
    expect(formatAbbrev(2_500_000)).toBe("2.5M");
  });

  it("shows B suffix for 1B+", () => {
    expect(formatAbbrev(1_000_000_000)).toBe("1B");
    expect(formatAbbrev(7_500_000_000)).toBe("7.5B");
  });
});

describe("formatResetCompact", () => {
  it("returns (reset unavailable) for undefined", () => {
    expect(formatResetCompact(undefined)).toBe("(reset unavailable)");
  });

  it("shows HH:MM only for same-day reset", () => {
    const now = new Date(2025, 5, 14, 10, 0, 0).getTime();
    const resetAt = new Date(2025, 5, 14, 15, 30, 0).getTime();
    const result = formatResetCompact(resetAt, now);
    expect(result).toBe("(resets 15:30)");
  });

  it("includes date for different-day reset", () => {
    const now = new Date(2025, 5, 14, 23, 0, 0).getTime();
    const resetAt = new Date(2025, 5, 15, 8, 0, 0).getTime();
    const result = formatResetCompact(resetAt, now);
    expect(result).toMatch(/^\(resets 08:00 on 15 Jun\)$/);
  });
});

describe("formatRatio", () => {
  it("returns undefined when used or limit is null", () => {
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: null,
        limit: 100,
        unit: "USD",
      } as never),
    ).toBeUndefined();
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: 50,
        limit: null,
        unit: "USD",
      } as never),
    ).toBeUndefined();
  });

  it("returns undefined when unit is missing", () => {
    expect(
      formatRatio({
        key: "k",
        label: "l",
        usedPercent: 0,
        used: 50,
        limit: 100,
      } as never),
    ).toBeUndefined();
  });

  it("formats USD with currency symbols", () => {
    const result = formatRatio({
      key: "k",
      label: "l",
      usedPercent: 50,
      used: 5,
      limit: 10,
      unit: "USD",
    });
    expect(result).toBe("$5.00/$10.00");
  });

  it("formats requests with abbreviations", () => {
    const result = formatRatio({
      key: "k",
      label: "l",
      usedPercent: 50,
      used: 1500,
      limit: 3000,
      unit: "requests",
    });
    expect(result).toBe("1.5k/3k requests");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/formatters.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(tui): add unit tests for formatters module
```

---

### Task 3: Create `src/tui/table-layout.ts`

**Files:**

- Create: `src/tui/table-layout.ts`

- [ ] **Step 1: Create table-layout module**

Extract from `dashboard.ts` (lines 42-211):

```typescript
// src/tui/table-layout.ts
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
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(tui): extract table layout logic to table-layout.ts
```

---

### Task 4: Create `tests/table-layout.test.ts`

**Files:**

- Create: `tests/table-layout.test.ts`

- [ ] **Step 1: Write table layout tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  labelWidth,
  separator,
  tableColumns,
  tableLine,
} from "../src/tui/table-layout.ts";
import type { AggregatedUsageRow } from "../src/shared/types.ts";

const mockRow: AggregatedUsageRow = {
  key: "test-provider",
  sessionCount: 5,
  messageCount: 42,
  input: 150_000,
  output: 50_000,
  cache: 100_000,
  cacheRead: 80_000,
  cacheWrite: 20_000,
  tokens: 200_000,
  cost: 1.23,
};

describe("tableColumns", () => {
  it("returns 2 columns at width <72", () => {
    const cols = tableColumns(50);
    expect(cols).toHaveLength(2);
    expect(cols.map((c) => c.label)).toEqual(["Cost", "Tokens"]);
  });

  it("returns 3 columns at width 72-93", () => {
    const cols = tableColumns(80);
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.label)).toEqual(["Sessions", "Cost", "Tokens"]);
  });

  it("returns 6 columns at width 94-119", () => {
    const cols = tableColumns(100);
    expect(cols).toHaveLength(6);
  });

  it("returns 8 columns at width >=120", () => {
    const cols = tableColumns(140);
    expect(cols).toHaveLength(8);
    expect(cols[6].label).toBe("CacheR");
    expect(cols[7].label).toBe("CacheW");
  });
});

describe("labelWidth", () => {
  it("returns at least 18", () => {
    const cols = tableColumns(30);
    expect(labelWidth(cols, 30)).toBe(18);
  });

  it("grows with available width", () => {
    const cols = tableColumns(120);
    const lw = labelWidth(cols, 120);
    expect(lw).toBeGreaterThan(18);
  });
});

describe("tableLine", () => {
  it("renders header when row is undefined", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const line = tableLine("Provider", cols, pw);
    expect(line).toContain("Provider");
    expect(line).toContain("Sessions");
    expect(line).toContain("Cost");
  });

  it("renders data row with formatted values", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const line = tableLine("TestProvider", cols, pw, mockRow);
    expect(line).toContain("TestProvider");
    expect(line).toContain("$1.23");
    expect(line).toContain("200k");
  });
});

describe("separator", () => {
  it("produces a line of box-drawing characters", () => {
    const cols = tableColumns(80);
    const pw = labelWidth(cols, 80);
    const sep = separator(cols, pw);
    expect(sep).toMatch(/^─+$/);
    expect(sep.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/table-layout.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(tui): add unit tests for table-layout module
```

---

### Task 5: Update `dashboard.ts` to import from new modules

**Files:**

- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add imports**

Add at the top of `dashboard.ts`:

```typescript
import {
  formatAge,
  formatAbbrev,
  formatCurrency,
  formatRatio,
  formatResetCompact,
} from "./formatters.ts";
import {
  labelWidth,
  separator,
  tableColumns,
  tableLine,
  type TableColumn,
} from "./table-layout.ts";
```

- [ ] **Step 2: Delete local implementations**

Remove these local function definitions from `dashboard.ts`:

- `formatAge` (lines 48-51)
- `formatCurrency` (lines 53-56)
- `formatAbbrev` (lines 58-71)
- `formatResetCompact` (lines 73-93)
- `formatRatio` (lines 117-130)
- `TableColumn` type (lines 42-46)
- `tableColumns` (lines 138-180)
- `labelWidth` (lines 182-187)
- `tableLine` (lines 189-203)
- `separator` (lines 205-212)

- [ ] **Step 3: Verify existing tests pass**

Run: `pnpm vitest run tests/dashboard.test.ts`
Expected: All 29 tests PASS (rendering output identical)

- [ ] **Step 4: Verify line count**

```bash
wc -l src/tui/dashboard.ts
# Expected: <= 450
```

- [ ] **Step 5: Commit**

```
refactor(tui): wire dashboard.ts to extracted formatters and table-layout

dashboard.ts reduced from 768 to ~450 lines.
No behavior change; all existing tests pass unchanged.
```

---

### Task 6: Final verification and exit criteria

- [ ] **Step 1: Run full check**

```bash
pnpm check
```

- [ ] **Step 2: Verify line count target**

```bash
wc -l src/tui/dashboard.ts
# Must be <= 450
```

- [ ] **Step 3: Verify no formatting logic remains private**

```bash
grep -n "function format" src/tui/dashboard.ts
# Should return 0 matches (all moved to formatters.ts)
grep -n "function tableColumns\|function labelWidth\|function tableLine\|function separator" src/tui/dashboard.ts
# Should return 0 matches (all moved to table-layout.ts)
```

- [ ] **Step 4: Verify all test files pass**

```bash
pnpm vitest run tests/dashboard.test.ts      # 29 tests
pnpm vitest run tests/dashboard-model.test.ts # existing
pnpm vitest run tests/formatters.test.ts     # new
pnpm vitest run tests/table-layout.test.ts   # new
```

---

## Exit Criteria

- [ ] `dashboard.ts` <= 450 lines
- [ ] `tests/dashboard.test.ts` passes unchanged (rendering output identical)
- [ ] `tests/dashboard-model.test.ts` passes unchanged
- [ ] Formatters have dedicated unit tests (`tests/formatters.test.ts`)
- [ ] Table layout has dedicated unit tests (`tests/table-layout.test.ts`)
- [ ] No formatting logic remains private inside `dashboard.ts`
- [ ] `pnpm check` passes
