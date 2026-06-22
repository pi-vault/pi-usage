# Phase 4: Skill and MCP Server Breakdowns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract skill invocations and MCP tool calls from session JSONL data, then compute "Top skills" and "Top MCP servers" insight categories that render alongside the project breakdown from Phase 3.

**Architecture:** Three tasks. Task 4.1 extracts skill names from user messages containing `<skill name="...">` tags and tracks the active skill per session. Task 4.2 extracts MCP server names from assistant tool calls by taking the first underscore-separated segment (excluding known built-in tools). Task 4.3 adds skill and MCP grouping to `buildInsights()`. The category-grouped rendering from Phase 3 picks up the new categories automatically.

**Tech Stack:** TypeScript, Vitest, regex extraction

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-enhancements-design.md` → Feature 2 (part 2)

**Parent plan:** `docs/superpowers/plans/2026-06-21-dashboard-enhancements.md` → Phase 4

**Prerequisite:** Phase 3 must be completed first (this phase depends on the `category` field on `InsightItem`, the `project` field on `UsageTurn`, and the category-grouped rendering in the dashboard).

---

## File Map

| File                    | Action | Responsibility                                                                                                                                                                       |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/offline.ts`   | Modify | Add `activeSkill` and `mcpTools` to `UsageTurn`; add `extractSkillName()`, `extractMcpServers()`, `BUILTIN_TOOLS`; extract in scan loop; add skill/MCP insights to `buildInsights()` |
| `tests/offline.test.ts` | Modify | Skill extraction, MCP extraction, skill insights, MCP insights tests                                                                                                                 |

---

### Task 4.1: Extract skill invocations from user messages

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for skill extraction**

Add to `describe("offline scanner", ...)` in `tests/offline.test.ts`:

```ts
it("tags turns with the active skill from user messages", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const skillMessage = JSON.stringify({
    type: "message",
    id: "u1",
    timestamp: "2026-05-30T10:00:00Z",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: '<skill name="career-ops" location="/path/to/SKILL.md">\nSkill content\n</skill>\nDo the thing',
        },
      ],
    },
  });
  const assistantTurn = JSON.stringify({
    type: "message",
    id: "a1",
    timestamp: "2026-05-30T10:01:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
    },
  });
  const secondSkill = JSON.stringify({
    type: "message",
    id: "u2",
    timestamp: "2026-05-30T10:02:00Z",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: '<skill name="writing-plans" location="/p">\ncontent\n</skill>',
        },
      ],
    },
  });
  const assistantTurn2 = JSON.stringify({
    type: "message",
    id: "a2",
    timestamp: "2026-05-30T10:03:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 2.0 },
    },
  });
  writeFileSync(
    join(sessions, "s.jsonl"),
    [skillMessage, assistantTurn, secondSkill, assistantTurn2].join("\n") +
      "\n",
    "utf8",
  );
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-05-30T12:00:00Z"),
  });
  expect(result.turns).toHaveLength(2);
  expect(result.turns[0].activeSkill).toBe("career-ops");
  expect(result.turns[1].activeSkill).toBe("writing-plans");
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — `activeSkill` doesn't exist on `UsageTurn` yet.

- [ ] **Step 3: Implement skill extraction**

In `src/core/offline.ts`:

**1. Add `activeSkill` to the `UsageTurn` interface:**

```ts
export interface UsageTurn {
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
  project?: string;
  activeSkill?: string;
}
```

**2. Add a skill extraction helper (place near other helpers, before `scanOfflineUsage`):**

```ts
const SKILL_NAME_RE = /<skill\s+name="([^"]+)"/;

function extractSkillName(line: string): string | undefined {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row?.type !== "message") return undefined;
    const message = row.message as Record<string, unknown> | undefined;
    if (message?.role !== "user") return undefined;
    const content = message.content;
    if (!Array.isArray(content)) return undefined;
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text"
      ) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") {
          const match = SKILL_NAME_RE.exec(text);
          if (match) return match[1];
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}
```

**3. In the per-file scan loop (inside `scanOfflineUsage`), track `activeSkill` as session-level state alongside `sessionProject`:**

```ts
let activeSkill: string | undefined;
```

Before calling `parseLine()`, check for skill invocations:

```ts
const skillName = extractSkillName(line);
if (skillName !== undefined) {
  activeSkill = skillName;
}
```

After `parseLine()` returns a turn, set the active skill:

```ts
turn.activeSkill = activeSkill;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract active skill from user messages"
```

---

### Task 4.2: Extract MCP tool calls from assistant messages

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing test for MCP tool extraction**

Add to `describe("offline scanner", ...)` in `tests/offline.test.ts`:

```ts
it("extracts MCP server names from tool call prefixes", async () => {
  const root = mkTmp();
  const sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  const message = JSON.stringify({
    type: "message",
    id: "a1",
    timestamp: "2026-05-30T10:00:00Z",
    message: {
      role: "assistant",
      provider: "minimax",
      model: "m",
      content: [
        {
          type: "toolCall",
          id: "c1",
          name: "playwright_browser_click",
          arguments: {},
        },
        { type: "toolCall", id: "c2", name: "read", arguments: {} },
        { type: "toolCall", id: "c3", name: "tavily", arguments: {} },
      ],
      usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 1.0 },
    },
  });
  writeFileSync(join(sessions, "s.jsonl"), `${message}\n`, "utf8");
  const result = await scanOfflineUsage({
    ...createDefaultDeps(),
    agentDir: () => root,
    now: () => Date.parse("2026-05-30T12:00:00Z"),
  });
  expect(result.turns).toHaveLength(1);
  // "read" is built-in so excluded; "playwright" from prefix; "tavily" is single-word non-built-in
  expect(result.turns[0].mcpTools).toEqual(
    expect.arrayContaining(["playwright", "tavily"]),
  );
  expect(result.turns[0].mcpTools).not.toContain("read");
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — `mcpTools` doesn't exist on `UsageTurn` yet.

- [ ] **Step 3: Implement MCP tool extraction**

In `src/core/offline.ts`:

**1. Add `mcpTools` to `UsageTurn`:**

```ts
export interface UsageTurn {
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
  project?: string;
  activeSkill?: string;
  mcpTools?: string[];
}
```

**2. Add the built-in tools set and extraction helper (place near other helpers):**

```ts
const BUILTIN_TOOLS = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "ls",
  "find",
]);

function extractMcpServers(
  message: Record<string, unknown>,
): string[] | undefined {
  const content = message.content;
  if (!Array.isArray(content)) return undefined;
  const servers = new Set<string>();
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "toolCall"
    ) {
      const name = (block as Record<string, unknown>).name;
      if (typeof name !== "string") continue;
      if (BUILTIN_TOOLS.has(name)) continue;
      const firstSegment = name.split("_")[0];
      if (firstSegment) servers.add(firstSegment);
    }
  }
  return servers.size > 0 ? [...servers] : undefined;
}
```

**3. In `parseLine()`, extract MCP tools from the message.**

After building the turn object but before returning it, call `extractMcpServers`:

```ts
// In parseLine(), after constructing the turn fields but before return:
const mcpTools = extractMcpServers(message as Record<string, unknown>);
// Include mcpTools in the returned object
return {
  id,
  sessionId,
  timestamp,
  provider,
  model,
  input,
  output,
  cacheRead,
  cacheWrite,
  tokens,
  cost,
  mcpTools,
};
```

The exact integration depends on how `parseLine` currently constructs and returns the turn. The key change: pass the `message` object to `extractMcpServers()` and include the result in the returned `UsageTurn`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(offline): extract MCP server names from tool call prefixes"
```

---

### Task 4.3: Add skill and MCP server insights to buildInsights

**Files:**

- Modify: `src/core/offline.ts`
- Modify: `tests/offline.test.ts`

- [ ] **Step 1: Write failing tests for skill and MCP insights**

Add to `describe("insights", ...)` in `tests/offline.test.ts`:

```ts
it("produces skill breakdown insights", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 8,
      activeSkill: "career-ops",
    },
    {
      id: "2",
      sessionId: "s1",
      timestamp: 2,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 2,
    },
  ];
  const insights = buildInsights(turns);
  const skillInsights = insights.filter((i) => i.category === "skill");
  expect(skillInsights.length).toBeGreaterThanOrEqual(2);
  expect(skillInsights[0].label).toBe("/career-ops");
  expect(skillInsights[0].detail).toContain("80.0%");
  const noSkill = skillInsights.find((i) => i.label === "(no skill)");
  expect(noSkill).toBeDefined();
});

it("produces MCP server breakdown insights", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 5,
      mcpTools: ["playwright"],
    },
    {
      id: "2",
      sessionId: "s1",
      timestamp: 2,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 3,
      mcpTools: ["playwright", "firefox"],
    },
    {
      id: "3",
      sessionId: "s1",
      timestamp: 3,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 2,
    },
  ];
  const insights = buildInsights(turns);
  const mcpInsights = insights.filter((i) => i.category === "mcp");
  // playwright: $5 + $3 = $8, firefox: $3
  expect(mcpInsights.length).toBeGreaterThanOrEqual(2);
  expect(mcpInsights[0].label).toBe("playwright");
  expect(mcpInsights[1].label).toBe("firefox");
});

it("caps skill insights at 5 with overflow summary", () => {
  const turns = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    sessionId: `s${i}`,
    timestamp: i,
    provider: "p",
    model: "m",
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 2,
    cost: 7 - i,
    activeSkill: `skill-${String.fromCharCode(97 + i)}`,
  }));
  const insights = buildInsights(turns);
  const skillInsights = insights.filter((i) => i.category === "skill");
  expect(skillInsights).toHaveLength(6);
  expect(skillInsights[0].label).toBe("/skill-a");
  expect(skillInsights[4].label).toBe("/skill-e");
  expect(skillInsights[5].label).toBe("+2 more");
  expect(skillInsights[5].cost).toBe(3);
});

it("caps MCP insights at 5 with overflow summary", () => {
  const turns = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    sessionId: `s${i}`,
    timestamp: i,
    provider: "p",
    model: "m",
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 2,
    cost: 7 - i,
    mcpTools: [`server-${String.fromCharCode(97 + i)}`],
  }));
  const insights = buildInsights(turns);
  const mcpInsights = insights.filter((i) => i.category === "mcp");
  expect(mcpInsights).toHaveLength(6);
  expect(mcpInsights[0].label).toBe("server-a");
  expect(mcpInsights[4].label).toBe("server-e");
  expect(mcpInsights[5].label).toBe("+2 more");
  expect(mcpInsights[5].cost).toBe(3);
});

it("omits skill/mcp insights when no data present", () => {
  const turns = [
    {
      id: "1",
      sessionId: "s1",
      timestamp: 1,
      provider: "p",
      model: "m",
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      tokens: 20,
      cost: 1,
    },
  ];
  const insights = buildInsights(turns);
  expect(insights.filter((i) => i.category === "skill")).toHaveLength(0);
  expect(insights.filter((i) => i.category === "mcp")).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/offline.test.ts`

Expected: FAIL — no skill or MCP insights produced.

- [ ] **Step 3: Implement skill and MCP insights in buildInsights**

In `src/core/offline.ts`, in `buildInsights()`, add skill and MCP grouping after the `projectInsights` block (added in Phase 3, Task 3.3) and before the return:

```ts
// Skill insights
const bySkill = new Map<string, number>();
let hasAnySkill = false;
for (const t of turns) {
  if (t.activeSkill) {
    hasAnySkill = true;
    const key = `/${t.activeSkill}`;
    bySkill.set(key, (bySkill.get(key) ?? 0) + t.cost);
  } else {
    bySkill.set("(no skill)", (bySkill.get("(no skill)") ?? 0) + t.cost);
  }
}
const allSkillEntries = hasAnySkill
  ? [...bySkill.entries()].sort((a, b) => b[1] - a[1])
  : [];
const skillInsights: InsightItem[] = allSkillEntries
  .slice(0, maxProjects)
  .map(([skill, cost]) => ({
    category: "skill",
    label: skill,
    cost,
    detail: pct(cost),
  }));
if (allSkillEntries.length > maxProjects) {
  const remainingCost = allSkillEntries
    .slice(maxProjects)
    .reduce((sum, [, c]) => sum + c, 0);
  skillInsights.push({
    category: "skill",
    label: `+${allSkillEntries.length - maxProjects} more`,
    cost: remainingCost,
    detail: pct(remainingCost),
  });
}

// MCP server insights
const byMcp = new Map<string, number>();
for (const t of turns) {
  if (t.mcpTools) {
    for (const server of t.mcpTools) {
      byMcp.set(server, (byMcp.get(server) ?? 0) + t.cost);
    }
  }
}
const allMcpEntries = [...byMcp.entries()].sort((a, b) => b[1] - a[1]);
const mcpInsights: InsightItem[] = allMcpEntries
  .slice(0, maxProjects)
  .map(([server, cost]) => ({
    category: "mcp",
    label: server,
    cost,
    detail: pct(cost),
  }));
if (allMcpEntries.length > maxProjects) {
  const remainingCost = allMcpEntries
    .slice(maxProjects)
    .reduce((sum, [, c]) => sum + c, 0);
  mcpInsights.push({
    category: "mcp",
    label: `+${allMcpEntries.length - maxProjects} more`,
    cost: remainingCost,
    detail: pct(remainingCost),
  });
}
```

Update the return to include all categories in order:

```ts
return [
  ...projectInsights,
  ...skillInsights,
  ...mcpInsights,
  {
    category: "cost",
    label: "Parallel sessions",
    cost: parallelCost,
    detail: `${pct(parallelCost)} cost while >=4 active`,
  },
  {
    category: "cost",
    label: "Large context",
    cost: largeContext,
    detail: `${pct(largeContext)} over 150k context`,
  },
  {
    category: "cost",
    label: "Large uncached",
    cost: largeUncached,
    detail: `${pct(largeUncached)} over 100k input`,
  },
  {
    category: "cost",
    label: "Long sessions",
    cost: longSessionCost,
    detail: `${pct(longSessionCost)} from 8h+ sessions`,
  },
  {
    category: "cost",
    label: "Top-5 concentration",
    cost: top5,
    detail: `${pct(top5)} in top 5 sessions`,
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/offline.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: all lint, typecheck, and tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/offline.ts tests/offline.test.ts
git commit -m "feat(insights): add skill and MCP server breakdowns"
```
