# Pi Usage Extension Phase 2: Offline Dashboard

## Goal

Make `/usage` useful without network or provider credentials by reading Pi session files and rendering historical usage statistics.

## Scope

- Resolve session root from `PI_CODING_AGENT_DIR/sessions`.
- Recursively scan `.jsonl` session files.
- Parse assistant `message` entries with `message.usage`, `message.provider`, and `message.model`.
- Tolerate unreadable directories, malformed lines, missing usage, and timestamp variants.
- Deduplicate copied branched history with a stable hash based on timestamp and token totals.
- Aggregate periods:
  - Today
  - This Week
  - Last Week
  - All Time
- Group by total, provider, and model.
- Use token formulas:
  - `Tokens = input + output + cacheWrite`
  - `Input = input + cacheWrite`
  - `Cache = cacheRead + cacheWrite`
- Add responsive table layout with staged column dropping.
- Add keyboard navigation:
  - `Tab` / left-right for periods
  - up-down for selection
  - Enter/Space for provider expansion
  - `v` for insights
  - `q` / Esc to close
- Add cancellable loading and periodic event-loop yielding while scanning large histories.
- Add insights view:
  - parallel sessions: cost while 4+ sessions were active within +/- 2 minutes
  - large context: cost from turns over 150k context tokens
  - large uncached prompts: cost from turns over 100k fresh input tokens
  - long sessions: cost from sessions active for 8+ hours
  - top-N concentration: cost share from the top 5 sessions

## Usable Checkpoint

- `/usage` shows real historical usage from local session files.
- The dashboard works offline.
- Provider cards for OpenAI/Codex, MiniMax, OpenCode Go, and Command Code remain visible as unavailable future phases.

## Acceptance Criteria

- Empty or missing session directory renders an empty state, not an error.
- Session scanning includes nested session directories.
- Provider/model drilldown matches the parsed session data.
- Period tabs update totals correctly.
- The dashboard remains usable in narrow terminals.
- Insights view renders meaningful results when enough data exists and clear empty states when it does not.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Add unit tests for parser, recursive scanning, deduplication, period grouping, token formulas, and insights.
- Add renderer tests for narrow-width table fallback and insights toggle.
- Load the extension in Pi and verify `/usage` displays local session usage.

## Out Of Scope

- Live provider quota fetching.
- Cache lock/backoff for network providers.
- Provider credentials.
- Status-bar rendering.
