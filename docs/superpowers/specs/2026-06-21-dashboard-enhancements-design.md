# Dashboard Enhancements Design

Three independent improvements to the pi-usage dashboard: provider enable/disable toggle, richer insights from session data, and a spacing fix.

## Feature 1: Provider Enable/Disable Toggle

### Problem

Live provider cards appear for every provider that has credentials configured. There is no way to suppress a provider you have env vars set for but don't want pi-usage to query.

### Solution

A per-provider toggle stored in a config file. Disabled providers are filtered out at startup -- no API calls, no cache writes, no dashboard cards.

### Config file

**Path:** `$PI_CODING_AGENT_DIR/extensions/usage.json`

```json
{
  "providers": {
    "minimax": { "enabled": false },
    "stepfun": { "enabled": false }
  }
}
```

**Rules:**

- File is optional. Missing file means all providers enabled.
- Unmentioned providers default to enabled.
- `{ "enabled": false }` disables the provider entirely.
- Config is read once at `UsageCore` initialization. Changes require Pi restart or `/reload`.

### Type

```ts
// src/shared/types.ts
export interface UsageConfig {
  providers?: Partial<Record<ProviderId, { enabled?: boolean }>>;
}
```

### Code changes

**`src/core/usage-core.ts`:**

- Add `loadConfig(deps: UsageDeps): Promise<UsageConfig>` that reads `join(deps.agentDir(), "extensions", "usage.json")`, parses JSON, returns `UsageConfig`. Returns `{}` on missing file or parse error.
- In `UsageCore` constructor (or `init()`), after `createProviderRegistry(deps)`, filter the provider list: remove any provider where `config.providers?.[id]?.enabled === false`.
- `isLiveProvider()`, `startLiveRuntime()`, and all downstream logic operate on the filtered registry, so disabled providers vanish automatically.

**`src/tui/dashboard.ts`:** No changes. Dashboard renders what `state.providers` contains, which already excludes filtered-out providers.

---

## Feature 2: Richer Insights

### Problem

The current insights (toggled with `v`) show five cost-pattern categories: parallel sessions, large context, large uncached, long sessions, and top-5 concentration. These are useful but miss the most actionable information: which projects, skills, and MCP servers are driving usage.

### Solution

Enrich the offline scan to extract additional data from session JSONL files, then compute new insight categories for projects, skills, and MCP servers.

### Data extraction

Enhance the JSONL scan in `src/core/offline.ts` to extract three new data points per session/turn:

**1. Session CWD (project attribution):**

- Source: `type: "session"` header entry (first line of each JSONL file), `cwd` field.
- Derive project name from last path segment (e.g. `/Users/lanh/Developer/career-ops` -> `career-ops`).
- Tag every turn in that session with the project name.

**2. Skill invocations:**

- Source: `type: "message"` entries with `role: "user"`, text content containing `<skill name="...">`.
- Extract skill name with regex: `<skill name="([^"]+)"`.
- When a skill is invoked, tag subsequent assistant turns in that session with that skill name until the next skill invocation or session end.
- Turns before any skill invocation in a session have no active skill.

**3. MCP tool calls:**

- Source: `type: "message"` entries with `role: "assistant"`, `content` array containing `type: "toolCall"` items.
- Extract tool names from each `toolCall`.
- Infer MCP server from tool name prefix: take the first underscore-separated segment as the server name (e.g. `playwright_browser_click` -> `playwright`, `firefox_devtools_take_snapshot` -> `firefox`, `minimax_coding_plan_web_search` -> `minimax`). This is a heuristic -- multi-word server names like `firefox-devtools` will appear as their first segment (`firefox`). Acceptable for v1; can be refined with a known-prefix mapping later.
- Built-in tools are excluded from MCP attribution. Known built-in tools: `bash`, `read`, `write`, `edit`, `web_search`, `questionnaire`, `get_subagent_result`, `ask_user_question`, `Agent`, `mcp`.
- Single-word tool names that aren't built-in (e.g. `tavily`, `ddgs`, `exa`, `firecrawl`) are treated as direct MCP server calls and attributed to that server name.

### Enriched turn type

```ts
// src/core/offline.ts
export interface UsageTurn {
  // existing fields
  id: string;
  sessionId: string;
  timestamp: number;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  // new fields
  project?: string;
  activeSkill?: string;
  mcpTools?: string[];
}
```

### New insight categories

Added to the output of `buildInsights()`. Each entry uses the existing `InsightItem` type with an added `category` field:

```ts
// src/core/offline.ts
export interface InsightItem {
  category?: string; // "project" | "skill" | "mcp" | "cost"
  label: string;
  cost: number;
  detail: string;
}
```

**Top projects:** Group turns by `project`, sum cost, return top entries sorted by cost descending. Label: project name. Detail: percentage of total cost.

**Top skills:** Group turns by `activeSkill` (where set), sum cost, return top entries sorted by cost descending. Turns with no active skill are grouped as "(no skill)". Label: skill name (with `/` prefix for display). Detail: percentage of total cost.

**Top MCP servers:** For each turn, extract unique MCP server prefixes from `mcpTools`. Attribute that turn's full cost to each server used. Return top entries sorted by cost descending. Label: server name. Detail: percentage of total cost.

Existing five cost-pattern insights remain, tagged with `category: "cost"`.

### Dashboard rendering

The insights view (toggled with `v`) groups insights by category:

```
Insights

  Projects                % of usage
  career-ops                   91.2%
  pi-packages                   6.1%
  dotfiles                      2.7%

  Skills                  % of usage
  /executing-plans             45.6%
  /writing-plans               22.3%
  (no skill)                   32.1%

  MCP servers             % of usage
  playwright                   50.0%
  firefox-devtools             12.3%

  Cost patterns
  - Parallel sessions: $0.50 (10.8%)
  - Large context: $1.20 (26.0%)
  - Top-5 concentration: $3.80 (82.4%)
```

Rendering changes in `src/tui/dashboard.ts`:

- Group `state.insights` by `category`.
- For `project`, `skill`, `mcp` categories: render as a two-column table (label + percentage), with a category header.
- For `cost` category (or items without a category): render as the existing `- label: $cost (detail)` format.

---

## Feature 3: Spacing Fix

### Problem

The "Usage Statistics" section title runs directly into the period tabs with no visual separation. The "Current Usage" section has a border separator between its title and tabs, creating an inconsistency.

### Solution

Add one empty line between the "Usage Statistics" section title and the period tabs.

### Code change

**`src/tui/dashboard.ts`, `renderUsageStatistics()` method:**

```ts
// Before
lines.push(
  this.sectionTitle(UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics),
);
lines.push(
  ...this.renderTabs(
    PERIODS.map((period) => PERIOD_LABELS[period]),
    this.periodIndex,
    w,
  ),
);

// After
lines.push(
  this.sectionTitle(UI_STRINGS.dashboardBorderedSectionTitles.usageStatistics),
);
lines.push("");
lines.push(
  ...this.renderTabs(
    PERIODS.map((period) => PERIOD_LABELS[period]),
    this.periodIndex,
    w,
  ),
);
```

---

## Testing

### Feature 1 (provider toggle)

- Unit test: `loadConfig()` returns empty object for missing file, parses valid config, ignores malformed JSON.
- Unit test: `UsageCore` with config disabling a provider excludes it from the registry.
- Integration: disabled provider has no snapshot in `state.providers`.

### Feature 2 (richer insights)

- Unit test: `parseLine()` / scan loop extracts `project`, `activeSkill`, `mcpTools` from session entries.
- Unit test: skill tagging propagates across turns within a session.
- Unit test: MCP server inference from tool name prefixes (underscore splitting, known built-ins excluded).
- Unit test: `buildInsights()` produces correct project/skill/mcp categories with percentages.
- Snapshot test: insights rendering groups by category.

### Feature 3 (spacing)

- Existing dashboard render tests should be updated to expect the extra empty line.

## Verification

- `pnpm check` (lint + typecheck + tests) passes.
- Manual verification: open `/usage` dashboard, toggle insights with `v`, confirm new categories render.
- Manual verification: disable a provider in config, reload Pi, confirm provider card is absent and no API calls are made.
