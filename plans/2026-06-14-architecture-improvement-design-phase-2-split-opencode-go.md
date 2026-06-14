# Phase 2 — Split OpenCode Go Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `src/providers/opencode-go.ts` (558 lines, 5 concerns) into focused modules, each independently testable.

**Architecture:** Convert single file into a module directory. The orchestrator (`index.ts`) wires together a dashboard scraper, SQLite reader, and window calculator. Each module receives only what it needs and returns typed results.

**Tech Stack:** TypeScript 6, Vitest, `better-sqlite3` (via `deps.openReadonlySqlite`), Phase 1 runtime utilities (`fetchWithTimeout`, `clampPercent`, `toFinite`, `parseEpochMs`).

**Depends on:** Phase 1 (runtime utilities already extracted)

**Verification:** `pnpm check` (biome lint + tsc --noEmit + vitest run)

---

## File Structure

| File                                             | Responsibility                                                                                     | ~Lines |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------ |
| `src/providers/opencode-go/types.ts`             | Shared `CostRow` type                                                                              | 5      |
| `src/providers/opencode-go/dashboard-scraper.ts` | `fetchDashboard`, `parseDashboardWindows`, `normalizeWorkspaceId`, `filterCookieHeader`, `addSecs` | ~120   |
| `src/providers/opencode-go/sqlite-reader.ts`     | `resolveOpencodeDbPath`, `collectSqliteRows`                                                       | ~140   |
| `src/providers/opencode-go/window-calculator.ts` | `rolling5h`, `utcMondayStart`, `anchoredMonthWindow`, `collectPiRows`                              | ~80    |
| `src/providers/opencode-go/index.ts`             | `buildOpenCodeGoSnapshot`, `createOpenCodeGoProvider` (orchestrator)                               | ~100   |

---

### Task 1: Create module directory and shared type

**Files:**

- Create: `src/providers/opencode-go/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/providers/opencode-go/types.ts
export type CostRow = { ts: number; cost: number };
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(opencode-go): create module directory with shared CostRow type
```

---

### Task 2: Extract dashboard-scraper.ts

**Files:**

- Create: `src/providers/opencode-go/dashboard-scraper.ts`

- [ ] **Step 1: Create dashboard-scraper.ts**

Move these functions from the original `opencode-go.ts`:

- `normalizeWorkspaceId` (lines 33-46) — keep `export`
- `filterCookieHeader` (lines 48-64) — keep `export`
- `addSecs` (lines 66-69)
- `parseDashboardWindows` (lines 71-113)
- `fetchDashboard` (lines 115-178)

```typescript
// src/providers/opencode-go/dashboard-scraper.ts
import type { UsageDeps } from "../../shared/deps.ts";
import type { LiveUsageWindow } from "../../shared/types.ts";
import { clampPercent, fetchWithTimeout } from "../runtime.ts";

export function normalizeWorkspaceId(raw: string): string | undefined {
  // ... exact existing implementation from lines 33-46
}

export function filterCookieHeader(raw: string): string | undefined {
  // ... exact existing implementation from lines 48-64
}

function addSecs(now: number, sec: number | undefined): number | undefined {
  // ... exact existing implementation from lines 66-69
}

function parseDashboardWindows(
  html: string,
  now: number,
): LiveUsageWindow[] | undefined {
  // ... exact existing implementation from lines 71-113
  // Replace clampPct → clampPercent (already done in Phase 1)
}

export async function fetchDashboard(
  deps: UsageDeps,
  workspaceId: string,
  cookieHeader: string,
  signal: AbortSignal | undefined,
): Promise<{ windows?: LiveUsageWindow[]; diagnostic?: string }> {
  // ... exact existing implementation from lines 115-178
  // Already uses fetchWithTimeout after Phase 1
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(opencode-go): extract dashboard-scraper module
```

---

### Task 3: Extract sqlite-reader.ts

**Files:**

- Create: `src/providers/opencode-go/sqlite-reader.ts`

- [ ] **Step 1: Create sqlite-reader.ts**

Move these functions:

- `resolveOpencodeDbPath` (lines 180-214)
- `collectSqliteRows` (lines 216-345)

These use `toFinite` and `parseEpochMs` from runtime.ts (after Phase 1 migration).

```typescript
// src/providers/opencode-go/sqlite-reader.ts
import { join, resolve } from "node:path";
import type { UsageDeps } from "../../shared/deps.ts";
import { parseEpochMs, toFinite } from "../runtime.ts";
import type { CostRow } from "./types.ts";

export async function resolveOpencodeDbPath(
  deps: UsageDeps,
): Promise<{ path?: string; diagnostic?: string }> {
  // ... exact existing implementation from lines 180-214
}

export async function collectSqliteRows(
  deps: UsageDeps,
): Promise<{ rows: CostRow[]; diagnostic?: string }> {
  // ... exact existing implementation from lines 216-345
  // toNumber → toFinite, parseTs → parseEpochMs (already done in Phase 1)
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(opencode-go): extract sqlite-reader module
```

---

### Task 4: Extract window-calculator.ts

**Files:**

- Create: `src/providers/opencode-go/window-calculator.ts`

- [ ] **Step 1: Create window-calculator.ts**

Move these pure functions:

- `utcMondayStart` (lines 354-363)
- `anchoredMonthWindow` (lines 365-392)
- `rolling5h` (lines 394-412)
- `collectPiRows` (lines 347-352)

```typescript
// src/providers/opencode-go/window-calculator.ts
import type { UsageDeps } from "../../shared/deps.ts";
import { scanOfflineUsage } from "../../core/offline.ts";
import type { CostRow } from "./types.ts";

export function utcMondayStart(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  return midnight - day * 24 * 3600 * 1000;
}

export function anchoredMonthWindow(
  now: number,
  anchor: number,
): { start: number; end: number } {
  // ... exact existing implementation from lines 365-392
}

export function rolling5h(
  rows: CostRow[],
  now: number,
): { used: number; resetAt: number } {
  // ... exact existing implementation from lines 394-412
}

export async function collectPiRows(deps: UsageDeps): Promise<CostRow[]> {
  const result = await scanOfflineUsage(deps);
  return result.turns
    .filter((row) => row.provider === "opencode-go" && row.cost > 0)
    .map((row) => ({ ts: row.timestamp, cost: row.cost }));
}
```

- [ ] **Step 2: Verify compiles**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```
refactor(opencode-go): extract window-calculator module
```

---

### Task 5: Create orchestrator index.ts

**Files:**

- Create: `src/providers/opencode-go/index.ts`
- Delete: `src/providers/opencode-go.ts` (the original file)

- [ ] **Step 1: Create orchestrator**

```typescript
// src/providers/opencode-go/index.ts
import { PROVIDER_LABELS, PROVIDER_TTLS_MS } from "../../shared/constants.ts";
import type { UsageDeps } from "../../shared/deps.ts";
import type {
  LiveUsageWindow,
  ProviderUsageSnapshot,
  UsageProviderAdapter,
} from "../../shared/types.ts";
import { clampPercent, fetchWithLiveRuntime } from "../runtime.ts";
import {
  fetchDashboard,
  filterCookieHeader,
  normalizeWorkspaceId,
} from "./dashboard-scraper.ts";
import { collectSqliteRows } from "./sqlite-reader.ts";
import type { CostRow } from "./types.ts";
import {
  anchoredMonthWindow,
  collectPiRows,
  rolling5h,
  utcMondayStart,
} from "./window-calculator.ts";

// Re-export public API (used in tests and possibly other consumers)
export {
  filterCookieHeader,
  normalizeWorkspaceId,
} from "./dashboard-scraper.ts";

export async function buildOpenCodeGoSnapshot(
  deps: UsageDeps,
  now: number,
  input?: { signal?: AbortSignal },
): Promise<ProviderUsageSnapshot> {
  // ... exact existing implementation from lines 414-520
}

export function createOpenCodeGoProvider(
  deps: UsageDeps,
): UsageProviderAdapter {
  // ... exact existing implementation from lines 522-558
}
```

- [ ] **Step 2: Delete original file**

```bash
rm src/providers/opencode-go.ts
```

- [ ] **Step 3: Verify compiles**

Run: `pnpm typecheck`
Expected: May fail if imports reference old path. Fix in Task 6.

- [ ] **Step 4: Commit**

```
refactor(opencode-go): replace monolith with module directory orchestrator
```

---

### Task 6: Update import paths

**Files:**

- Modify: `src/providers/index.ts` (or wherever `createOpenCodeGoProvider` is imported)
- Modify: `tests/provider-opencode-go.test.ts`

- [ ] **Step 1: Find all imports of the old path**

```bash
grep -rn "opencode-go" src/ tests/ --include="*.ts" | grep -v "opencode-go/"
```

- [ ] **Step 2: Update each import**

The project uses explicit `.ts` extensions with `moduleResolution: "Node16"`. Update imports:

```typescript
// Before:
import { ... } from "../providers/opencode-go.ts";
// After:
import { ... } from "../providers/opencode-go/index.ts";

// Or for relative within providers/:
// Before:
import { createOpenCodeGoProvider } from "./opencode-go.ts";
// After:
import { createOpenCodeGoProvider } from "./opencode-go/index.ts";
```

- [ ] **Step 3: Verify full suite passes**

Run: `pnpm check`
Expected: All 11 test files pass.

- [ ] **Step 4: Commit**

```
chore: update import paths for opencode-go module directory
```

---

### Task 7: Add unit tests for window-calculator

**Files:**

- Create: `tests/window-calculator.test.ts`

- [ ] **Step 1: Write tests for pure time functions**

```typescript
import { describe, expect, it } from "vitest";
import {
  anchoredMonthWindow,
  rolling5h,
  utcMondayStart,
} from "../src/providers/opencode-go/window-calculator.ts";
import type { CostRow } from "../src/providers/opencode-go/types.ts";

describe("window-calculator", () => {
  describe("utcMondayStart", () => {
    it("returns previous Monday 00:00 UTC for a Wednesday", () => {
      // 2025-01-08 Wed 12:00 UTC
      const wed = Date.UTC(2025, 0, 8, 12, 0, 0);
      const monday = utcMondayStart(wed);
      const date = new Date(monday);
      expect(date.getUTCDay()).toBe(1); // Monday
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
    });

    it("returns same day at 00:00 if already Monday", () => {
      const mon = Date.UTC(2025, 0, 6, 15, 30, 0);
      const result = utcMondayStart(mon);
      const date = new Date(result);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCDate()).toBe(6);
      expect(date.getUTCHours()).toBe(0);
    });

    it("handles Sunday (wraps to previous Monday)", () => {
      const sun = Date.UTC(2025, 0, 12, 10, 0, 0);
      const result = utcMondayStart(sun);
      const date = new Date(result);
      expect(date.getUTCDay()).toBe(1);
      expect(date.getUTCDate()).toBe(6);
    });
  });

  describe("rolling5h", () => {
    it("returns 0 for empty rows", () => {
      const now = Date.now();
      const result = rolling5h([], now);
      expect(result.used).toBe(0);
      expect(result.resetAt).toBe(now + 5 * 3600 * 1000);
    });

    it("sums costs in the current 5h bucket", () => {
      const now = 1_000_000_000;
      const rows: CostRow[] = [
        { ts: now - 1_000_000, cost: 0.5 },
        { ts: now - 500_000, cost: 0.3 },
      ];
      const result = rolling5h(rows, now);
      expect(result.used).toBeCloseTo(0.8);
    });

    it("resets bucket when gap exceeds 5h", () => {
      const now = 1_000_000_000;
      const rows: CostRow[] = [
        { ts: now - 20_000_000, cost: 5.0 }, // old bucket (>5h ago)
        { ts: now - 1_000_000, cost: 0.2 }, // current bucket
      ];
      const result = rolling5h(rows, now);
      expect(result.used).toBeCloseTo(0.2);
    });
  });

  describe("anchoredMonthWindow", () => {
    it("returns window anchored to earliest row timestamp", () => {
      const now = Date.UTC(2025, 5, 15, 12, 0, 0); // Jun 15
      const anchor = Date.UTC(2025, 5, 1, 0, 0, 0); // Jun 1
      const result = anchoredMonthWindow(now, anchor);
      expect(result.start).toBeLessThanOrEqual(now);
      expect(result.end).toBeGreaterThan(now);
    });

    it("wraps to previous month if anchor day is in the future", () => {
      const now = Date.UTC(2025, 5, 5, 12, 0, 0); // Jun 5
      const anchor = Date.UTC(2025, 4, 20, 0, 0, 0); // May 20 (anchor day=20 > current day=5)
      const result = anchoredMonthWindow(now, anchor);
      expect(result.start).toBeLessThan(now);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/window-calculator.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(opencode-go): add unit tests for window-calculator pure functions
```

---

### Task 8: Add unit tests for sqlite-reader

**Files:**

- Create: `tests/sqlite-reader.test.ts`

- [ ] **Step 1: Write tests with mocked SQLite**

```typescript
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDefaultDeps } from "../src/shared/deps.ts";
import {
  collectSqliteRows,
  resolveOpencodeDbPath,
} from "../src/providers/opencode-go/sqlite-reader.ts";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-usage-sqlite-"));
}

describe("sqlite-reader", () => {
  describe("resolveOpencodeDbPath", () => {
    it("returns override path from OPENCODE_DB env", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: "/custom/path.db" };
      const result = await resolveOpencodeDbPath(deps);
      expect(result.path).toBe("/custom/path.db");
    });

    it("returns diagnostic for :memory:", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: ":memory:" };
      const result = await resolveOpencodeDbPath(deps);
      expect(result.diagnostic).toContain("unsupported");
      expect(result.path).toBeUndefined();
    });

    it("returns diagnostic when DB not found", async () => {
      const root = mkTmp();
      const deps = createDefaultDeps();
      deps.env = { XDG_DATA_HOME: root };
      deps.homeDir = () => root;
      const result = await resolveOpencodeDbPath(deps);
      expect(result.diagnostic).toContain("not found");
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("collectSqliteRows", () => {
    it("returns empty rows with diagnostic when DB unavailable", async () => {
      const deps = createDefaultDeps();
      deps.env = { OPENCODE_DB: "/nonexistent/path.db" };
      deps.openReadonlySqlite = () => {
        throw new Error("SQLITE_CANTOPEN");
      };
      const result = await collectSqliteRows(deps);
      expect(result.rows).toEqual([]);
      expect(result.diagnostic).toContain("unavailable");
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/sqlite-reader.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```
test(opencode-go): add unit tests for sqlite-reader
```

---

### Task 9: Final verification and exit criteria

- [ ] **Step 1: Run full check**

```bash
pnpm check
```

- [ ] **Step 2: Verify line count**

```bash
wc -l src/providers/opencode-go/index.ts
# Must be <= 150
```

- [ ] **Step 3: Verify public exports**

```bash
grep -n "export" src/providers/opencode-go/index.ts | grep -E "normalizeWorkspaceId|filterCookieHeader"
# Both must be present
```

- [ ] **Step 4: Verify existing tests pass**

```bash
pnpm vitest run tests/provider-opencode-go.test.ts
# All 10 tests pass
```

- [ ] **Step 5: Verify module independence**

```bash
# Each module should only import from types.ts, runtime.ts, shared/, or external deps:
grep "^import" src/providers/opencode-go/dashboard-scraper.ts
grep "^import" src/providers/opencode-go/sqlite-reader.ts
grep "^import" src/providers/opencode-go/window-calculator.ts
# None should import from ./index.ts (no circular deps)
```

---

## Exit Criteria

- [ ] `src/providers/opencode-go/index.ts` <= 150 lines
- [ ] Each internal module independently testable with own fixtures
- [ ] Existing `tests/provider-opencode-go.test.ts` passes unchanged (except import path)
- [ ] `normalizeWorkspaceId` and `filterCookieHeader` remain public re-exports
- [ ] `pnpm check` passes
- [ ] New test files: `tests/window-calculator.test.ts`, `tests/sqlite-reader.test.ts`
