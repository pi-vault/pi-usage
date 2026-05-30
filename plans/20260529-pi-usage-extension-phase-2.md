# Pi Usage Extension Phase 2: Offline Dashboard

## Goal

Make `/usage` useful without network or provider credentials by reading Pi session files and rendering historical usage statistics.

## Summary

Implement the offline dashboard on top of the current Phase 1 extension shell. Real Pi session records use `type: "message"` with top-level `id` and `timestamp`, nested `message.role`, `message.provider`, `message.model`, and `message.usage`. Usage includes `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and `cost`.

Implementation review completed after Phase 2 work: parser/scanner, aggregation, dashboard rendering, keyboard navigation, insights, provider placeholders, and verification checks are implemented. The remaining manual item is a local Pi smoke test.

## Scope

- Resolve the session root as `${PI_CODING_AGENT_DIR ?? homeDir() + "/.config/pi"}/sessions`.
- Recursively scan `.jsonl` session files.
- Parse only assistant `message` entries with usable `message.usage`, `message.provider`, `message.model`, and a timestamp.
- Tolerate missing roots, unreadable directories/files, malformed lines, non-message entries, missing usage, missing provider/model, and timestamp variants.
- Deduplicate copied branched history using `id` when present, otherwise a stable fallback key based on timestamp, provider, model, token totals, and cost.
- Aggregate periods:
  - Today
  - This Week
  - Last Week
  - All Time
- Group by total, provider, and model.
- Track session count, message count, token totals, cache totals, and cost totals.
- Use token formulas:
  - `Tokens = input + output + cacheWrite`
  - `Input = input + cacheWrite`
  - `Cache = cacheRead + cacheWrite`
  - `Cost = usage.cost` when numeric, otherwise zero
- Add responsive table layout with staged column dropping:
  - Drop cost/cache first.
  - Then drop message/session counts.
  - Then collapse provider/model detail.
- Add keyboard navigation:
  - `Tab` / left-right for periods
  - up-down for row selection
  - Enter/Space for provider expansion
  - `v` for insights
  - `q` / Esc to close
- Use `@earendil-works/pi-tui` key helpers for keyboard handling and `truncateToWidth` for width-safe rendering.
- Add cancellable loading and periodic event-loop yielding while scanning large histories; closing the dashboard cancels any in-flight scan.
- Keep `/usage --refresh`; in Phase 2 it forces a fresh offline scan instead of using any in-memory scan result.
- Keep `usage-core:ready` and `usage-core:update-current` event payloads as `{ state }`.
- Keep provider cards for OpenAI/Codex, MiniMax, OpenCode Go, and Command Code visible as unavailable future phases, including when `/usage` runs before `session_start`.
- Add insights view:
  - parallel sessions: cost from turns where 4+ distinct sessions were active within +/- 2 minutes
  - large context: cost from turns over 150k context tokens
  - large uncached prompts: cost from turns over 100k fresh input tokens
  - long sessions: cost from sessions active for 8+ hours
  - top-N concentration: cost share from the top 5 sessions

## Usable Checkpoint

- `/usage` shows real historical usage from local session files.
- The dashboard works offline.
- Empty or missing session roots render an empty state, not an error.
- Provider cards for OpenAI/Codex, MiniMax, OpenCode Go, and Command Code remain visible as unavailable future phases.

## Acceptance Criteria

- Session scanning includes nested session directories.
- Provider/model drilldown matches the parsed session data.
- Period tabs update totals correctly.
- Cost totals use `message.usage.cost`.
- Token totals use the Phase 2 token formulas, not `usage.totalTokens`.
- The dashboard remains usable in narrow terminals and every rendered line stays within the provided width.
- Keyboard input changes period, selection, expansion, insights mode, and close state as specified.
- Insights view renders meaningful results when enough data exists and clear empty states when it does not.
- `/usage --refresh` triggers a fresh offline scan path.
- Future provider placeholders render before and after `session_start`.

## Test Coverage

- Parser/scanner tests:
  - valid assistant usage rows
  - malformed JSONL
  - missing usage/provider/model/timestamp
  - recursive directories
  - missing session root
  - unreadable directory/file tolerance
  - deduplication by id and fallback key
- Aggregation tests:
  - Today, This Week, Last Week, and All Time boundaries
  - provider/model grouping
  - session/message counts
  - token formulas
  - cost totals from `usage.cost`
  - empty data behavior
- Insights tests:
  - parallel sessions with 4+ distinct active sessions within +/- 2 minutes
  - large context over 150k total context tokens
  - large uncached prompts over 100k fresh input tokens
  - long sessions active for 8+ hours
  - top 5 session concentration
  - empty/zero-cost states
- Renderer/input tests:
  - loading, empty, table, expanded row, and insights views
  - narrow-width rendering never exceeds width
  - keyboard period navigation, selection, expansion, insights toggle, and close
  - `/usage --refresh` triggers a fresh offline scan path

## Verification

- `pnpm test` passed with 19 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm check` passed.
- `NPM_CONFIG_CACHE=/private/tmp/pi-usage-npm-cache pnpm pack:dry-run` passed.
- Plain `pnpm pack:dry-run` hit root-owned files in `/Users/lanh/.npm`; this is an external npm cache permission issue, not a repo failure.
- Load the extension in Pi and verify `/usage` displays local session usage offline.

## Out Of Scope

- Live provider quota fetching.
- Cache lock/backoff for network providers.
- Provider credentials.
- Status-bar rendering.
- Packaging metadata cleanup unrelated to the offline dashboard.
