# Pi Usage Extension Plan

## Summary

Build `pi-usage` as a standalone TypeScript Pi extension. It registers `/usage`, scans Pi session JSONL files recursively for historical usage totals, and shows an interactive terminal dashboard with live provider quota cards.

The extension should combine the reliable parts of `juanibiapina/pi-usage`, the dashboard from `tmustier/usage-extension`, the Codex-specific fallback behavior from `pi-codex-usage`, and CodexBar's provider-source strategy pattern.

## Key Changes

- Scaffold the package with `package.json`, `tsconfig.json`, `index.ts`, `src/`, and focused tests.
- Configure Pi loading through `pi: { "extensions": ["./index.ts"] }`.
- Register `/usage` with an interactive TUI dashboard.
- Add `/usage --refresh` to bypass live-provider cache while keeping session aggregation local.
- Read sessions from `/Users/lanh/Developer/dotfiles/configs/pi/sessions`, with `PI_CODING_AGENT_DIR` overriding the agent directory when present.
- Show historical usage tabs for Today, This Week, Last Week, and All Time.
- Group historical usage by total, provider, and model.
- Display sessions, messages, input tokens, output tokens, cache tokens, total tokens, and cost.
- Display live provider cards for OpenAI/Codex, OpenCode Go, MiniMax, and Command Code.
- Fetch current usage for all configured providers with a concurrency limit of 3.
- Render requested provider windows even when data is unavailable, with a short reason, source attempts, and last-attempt time.

## Runtime Architecture

- Use a single package and keep status-bar rendering out of scope.
- Emit standardized events for consumers:
  - `usage-core:ready` with `{ state }` after startup refresh.
  - `usage-core:update-current` whenever provider snapshots change.
- Add a global init guard on `globalThis.__piUsage` to prevent double initialization when loaded by multiple extensions.
- Add dependency injection for all I/O: `fetch`, file reads/writes, file existence, command execution, home directory, environment, clock, and timers.
- Add provider detection with the Bedrock fix:
  - Match known providers by explicit `model.provider` first.
  - Only fall back to model-name tokens when `model.provider` is empty.
  - If `model.provider` is set but unknown, return `undefined`.
- Lifecycle refresh rules:
  - `session_start`: load cached data, fetch stale/missing providers, emit `usage-core:ready`.
  - `model_select` and `session_switch`: allow forced refresh for affected providers.
  - `turn_start` and `turn_end`: update context only; never force-refresh.
  - periodic timer: refresh stale provider data without blocking the UI.
  - `session_shutdown`: clear timers, cache watchers, and global guard.

## Cache And Failure Handling

- Store live provider snapshots under the Pi agent cache directory, e.g. `<agentDir>/cache/pi-usage/`.
- Use one cache file with per-provider entries, fetched timestamp, source label, diagnostics, and normalized snapshot.
- Use atomic writes: write temp file, then rename.
- Use a lock file with atomic creation, 5s stale-lock recovery, and short wait when another instance is fetching.
- Use a backoff file shared across instances; respect `Retry-After` when available and default to 60s otherwise.
- Never overwrite good cached data with errors.
- Use cache watchers so one Pi instance can reuse data fetched by another.
- Display stale data with age when fresh fetches fail.
- Suppress the first transient failure when prior data exists, then surface repeated failures in provider diagnostics.
- Default TTLs:
  - 60s for general live providers.
  - 5 minutes for OpenAI/Codex rate-limit snapshots unless `/usage --refresh` is used.

## Provider Model

- Add `UsageProviderAdapter` with `id`, `displayName`, `credentialSources`, `sourceModes`, `detectCredentials(ctx)`, and `fetch(ctx)`.
- Add `ProviderFetchStrategy` with `id`, `kind`, `isAvailable(ctx)`, `fetch(ctx)`, and `shouldFallback(error, ctx)`.
- Add `ProviderFetchOutcome` with final result plus all source attempts.
- Add `ProviderUsageSnapshot` with `provider`, `capturedAt`, `source`, `windows`, `balances`, `identity`, and `diagnostics`.
- Add `UsageWindow` with `label`, `used`, `limit`, `unit`, `usedPercent`, `resetAt`, and `unavailableReason`.
- Add `ProviderBalance` for non-window values such as credits, available balance, consumed cost, or total cost.
- Normalize provider-specific concepts into the same UI shape, but preserve raw source labels and diagnostics for expanded views.

## Provider Sources

- OpenAI/Codex:
  - Use Pi `openai-codex` auth first.
  - Fallback to Codex app-server JSON-RPC over stdio when Pi auth is unavailable.
  - Read `CODEX_HOME` or `~/.codex/auth.json` for ambient Codex credentials.
  - Normalize 5-hour and weekly windows from Codex rate-limit snapshots.
  - Select model-specific rate-limit buckets when available, falling back to the generic Codex bucket.
  - Treat monthly usage as optional: show it only when returned by additional limits, credits data, or a verified dashboard-derived source.
  - If dashboard/browser-cookie work is implemented, verify account identity before attaching data; otherwise mark dashboard-derived monthly usage unavailable.
- OpenCode Go:
  - Use a local usage probe first.
  - Fallback to authenticated OpenCode web source using browser/session credentials.
  - Clear cached web credentials and retry once on 401.
  - Normalize 5-hour, weekly, and monthly dollar-value usage windows.
  - Use documented limits as labels only; never infer current usage from limits alone.
- MiniMax:
  - Use Coding Plan / Token Plan source first.
  - Support MiniMax browser/localStorage token context with group IDs where required.
  - Support global and China-region source selection, including retrying China on global auth failure when applicable.
  - Parse `https://api.minimax.io/user-center/payment/coding-plan` HTML `__NEXT_DATA__` or JSON responses when used by the source.
  - Interpret `/coding_plan/remains` `*_usage_count` fields as remaining when that response shape is returned.
  - Compute used requests as `total - remaining`.
  - Display used requests over assigned requests, reset time, plan name, and service breakdown when available.
  - Use flexible JSON path parsing for MiniMax response variants.
- Command Code:
  - Reuse credential discovery from the Command Code provider package: Pi auth, `COMMANDCODE_API_KEY`, `~/.commandcode/auth.json`, and `~/.pi/agent/auth.json`.
  - Treat live Command Code usage as a discovery spike because the research docs do not establish a stable usage endpoint.
  - Try discovered Studio/API usage source for consumed, available, and total cost if available.
  - Fall back to Pi session-file totals for consumed and total cost while marking live available balance unavailable.

## Session Aggregation

- Recursively scan `.jsonl` files under the session root.
- Parse only assistant `message` entries with `message.usage`, `message.provider`, and `message.model`.
- Count fresh processed tokens as `input + output + cacheWrite`.
- Track `cacheRead` and `cacheWrite` separately for display.
- Show `Input` as `input + cacheWrite`.
- Deduplicate copied branched history with a stable hash based on timestamp and token totals.
- Skip malformed lines and unreadable directories without failing `/usage`.
- Yield periodically during parsing so large session sets do not block the UI.
- Add insights view with the `v` key:
  - parallel sessions: cost while 4+ sessions were active within +/- 2 minutes.
  - large context: cost from turns over 150k context tokens.
  - large uncached prompts: cost from turns over 100k fresh input tokens.
  - long sessions: cost from sessions active for 8+ hours.
  - top-N concentration: cost share from the top 5 sessions.

## UI Behavior

- Start with a cancellable loading state while session aggregation and live provider fetches run.
- Show a dashboard with two main sections: historical session totals and current provider usage.
- Support `Tab` / left-right for period tabs.
- Support up-down selection and Enter/Space provider expansion.
- Support `v` to toggle table and insights view.
- Support `q` / Esc to close.
- Keep the layout responsive for narrow terminals by dropping lower-priority columns in stages.
- Show reset timestamps in local time and compact relative form where space is constrained.
- Show provider source, cache age, stale status, and diagnostics when a provider is expanded.
- Keep missing live quota data as a partial row, not a command failure.

## Test Plan

- Session parser tests for valid assistant messages, malformed JSONL, missing usage, missing provider/model, duplicate branched history, recursive directories, unreadable paths, and timestamp variants.
- Aggregation tests for period boundaries, provider/model grouping, session counts, cost totals, token accounting, cache-write formula, and all-time totals.
- Insights tests for parallel sessions, large context, large uncached prompts, long sessions, top-N concentration, and empty/zero-cost periods.
- Provider adapter tests with mocked HTTP/local sources for success, missing auth, partial windows, fallback order, account mismatch, cache TTL, stale data, transient failure, repeated failure, and `--refresh`.
- Cache tests for atomic writes, lock contention, stale lock recovery, backoff, `Retry-After`, cross-instance cache watching, and never caching errors.
- Detection tests for explicit provider matches, model-token fallback only when provider is empty, and Bedrock false-positive prevention.
- Renderer tests for narrow terminal width, unavailable provider rows, reset timestamps, cache age, expansion state, insights toggle, and keyboard navigation.
- Verification commands: `npm test`, `npm run typecheck`, and a local Pi smoke run with `/usage`.

## Assumptions

- The default session directory is `/Users/lanh/Developer/dotfiles/configs/pi/sessions`.
- `PI_CODING_AGENT_DIR` should override the default agent directory by appending `sessions`.
- Default UI is interactive; no `--json` or plain-report mode in v1.
- Live provider fetches may use layered CodexBar-style sources, including local probes and authenticated web sources when needed.
- Browser/dashboard sources must prove account identity before attaching data to a provider snapshot.
- Command Code live balance requires discovery; session-file fallback is the only known reliable source today.
- Status-bar UI is out of scope, but event emissions are in scope so another extension can render status.
