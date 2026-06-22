# Project Insights Cap

Limit project breakdown insights to the top 5 projects by cost, with a summary overflow row when more exist.

## Problem

The project insights list grows unbounded. Users with many session directories see a long list that overwhelms the insights view and pushes cost-pattern insights off screen.

## Solution

In `buildInsights()`, after sorting projects by cost descending, take only the first 5. If more than 5 projects exist, append a summary item that aggregates the remaining projects' cost and percentage.

### Data layer (`src/core/offline.ts`)

After sorting `projectInsights` by cost descending:

1. If `projectInsights.length <= 5`, return as-is (no change).
2. If `projectInsights.length > 5`:
   - Keep the first 5 items.
   - Sum the cost of remaining items.
   - Append one summary item: `{ category: "project", label: "+N more", cost: remainingCost, detail: pct(remainingCost) }` where N is the count of remaining projects.

### Dashboard rendering

No changes. The renderer already handles any `InsightItem` with `category: "project"`. The overflow row renders as a normal project row in the table.

### Rendered example

```
  Projects         % of usage
  career-ops            42.3%
  dotfiles              18.1%
  pi-vault              12.0%
  homelab                8.5%
  scripts                6.2%
  +12 more              12.9%
```

## Testing

- Existing test with 2 projects: unaffected (under cap).
- New test with 7 projects: verify only 6 items returned (5 individual + 1 overflow), overflow label is "+2 more", overflow cost is sum of bottom 2 projects' costs, overflow detail contains the correct percentage.

## Verification

`pnpm check` passes.
