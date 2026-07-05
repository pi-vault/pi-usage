# Phase 1: Theme Foundation — Dashboard Overlay & Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `inverse` and `bg` methods to the `DashboardTheme` interface and its implementations, and add `"borderAccent"` and `"selectedBg"` to `DashboardColor`, so the theme API is ready for tab pill styling.

**Parent plan:** `docs/superpowers/plans/2026-07-05-dashboard-overlay-tabs.md`
**Spec:** `docs/superpowers/specs/2026-07-05-dashboard-overlay-tabs-design.md`

**Preconditions:** None
**Postconditions:** All tests pass. `DashboardTheme` exposes `inverse` and `bg`. `DashboardColor` includes `"borderAccent"` and `"selectedBg"`. `noTheme`, `fromPiTheme`, and the `makeAnsiTheme` test helper all implement the new methods. No behavior change to the dashboard.

---

## Steps

- [ ] **Step 1: Write failing tests for new theme methods**

Create `tests/dashboard-theme.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  noTheme,
  fromPiTheme,
  type DashboardTheme,
} from "../src/tui/dashboard-theme.ts";

describe("DashboardTheme", () => {
  describe("noTheme", () => {
    it("inverse returns text unchanged", () => {
      expect(noTheme.inverse("hello")).toBe("hello");
    });

    it("bg returns text unchanged", () => {
      expect(noTheme.bg("selectedBg", "hello")).toBe("hello");
    });
  });

  describe("fromPiTheme", () => {
    it("delegates inverse to theme.inverse", () => {
      const piTheme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => `<b>${text}</b>`,
        inverse: (text: string) => `<inv>${text}</inv>`,
        bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
      };
      const theme = fromPiTheme(piTheme as never);
      expect(theme.inverse("test")).toBe("<inv>test</inv>");
    });

    it("delegates bg to theme.bg", () => {
      const piTheme = {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => `<b>${text}</b>`,
        inverse: (text: string) => `<inv>${text}</inv>`,
        bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
      };
      const theme = fromPiTheme(piTheme as never);
      expect(theme.bg("selectedBg", "test")).toBe("<bg:selectedBg>test</bg>");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/dashboard-theme.test.ts
```

Expected: FAIL -- `noTheme.inverse` is not a function, `noTheme.bg` is not a function.

- [ ] **Step 3: Add `inverse` and `bg` to DashboardTheme interface and implementations**

In `src/tui/dashboard-theme.ts`, apply the following changes:

**Update the `DashboardTheme` interface** (replace the existing interface):

```typescript
export interface DashboardTheme {
  /** Foreground color for a themed string. */
  fg: (color: DashboardColor, text: string) => string;
  /** Background color for a themed string. */
  bg: (color: DashboardColor, text: string) => string;
  /** Bold modifier. */
  bold: (text: string) => string;
  /** Dim modifier. */
  dim: (text: string) => string;
  /** Inverse modifier (swap fg/bg). */
  inverse: (text: string) => string;
}
```

**Update `DashboardColor`** to include the new color roles (replace the existing type):

```typescript
export type DashboardColor =
  | "accent"
  | "border"
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "muted"
  | "dim"
  | "text";
```

**Update `noTheme`** (replace the existing const):

```typescript
export const noTheme: DashboardTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  inverse: (text) => text,
};
```

**Update `fromPiTheme`** (replace the existing function body):

```typescript
export function fromPiTheme(theme: Theme): DashboardTheme {
  return {
    fg: (color, text) => theme.fg(color, text),
    bg: (color, text) => theme.bg(color as never, text),
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    inverse: (text) => theme.inverse(text),
  };
}
```

Note: `bg` casts `color` to `never` because `DashboardColor` is a superset that includes fg-only colors. Only `"selectedBg"` is a valid `ThemeBg` key, but the cast keeps the adapter simple. The caller is responsible for passing valid bg colors.

- [ ] **Step 4: Run new tests to verify they pass**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run tests/dashboard-theme.test.ts
```

Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass. The existing code still compiles because the new methods are additive.

- [ ] **Step 6: Update `makeAnsiTheme` test helper for the new methods**

In `tests/dashboard.test.ts`, replace the `makeAnsiTheme` function with:

```typescript
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
```

- [ ] **Step 7: Run all tests again**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/lanh/Developer/pi-vault/pi-usage
git add src/tui/dashboard-theme.ts tests/dashboard-theme.test.ts tests/dashboard.test.ts
git commit -m "feat(tui): add inverse and bg methods to DashboardTheme

Extend the theme adapter with inverse() for active tab pill styling
and bg() for inactive tab pill background. Add selectedBg and
borderAccent to DashboardColor. Update noTheme, fromPiTheme, and
test helper.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
```
