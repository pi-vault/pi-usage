# Pi Usage Extension Phase 3: Direct OpenAI/Codex Live Usage

## Goal

Add OpenAI/Codex live usage while keeping the offline dashboard stable and immediately usable.

## Summary

Implement `openai-codex` as the first real live provider on top of the current Phase 2 extension. Use the direct ChatGPT usage API approach from `marckrenn-pi-sub`: read existing OAuth credentials and call `https://chatgpt.com/backend-api/wham/usage`.

Keep offline session aggregation unchanged. Load cached live data immediately, refresh in the background, and surface stale or unavailable live data as provider diagnostics rather than command failures.

This phase standardizes the live-provider runtime that later phases can reuse, but only `openai-codex` is implemented here.

## Scope

- Replace the placeholder `openai-codex` provider with a real live provider adapter.
- Keep MiniMax, OpenCode Go, and Command Code as unavailable placeholders for later phases.
- Use direct HTTP only. Do not invoke the Codex CLI or app-server.
- Use Pi's native agent-directory semantics for sessions, auth, and live cache files.
- Keep the live-provider runtime responsible for:
  - current-model detection
  - provider refresh deduplication
  - cache reads and writes
  - lock handling
  - shared backoff
  - periodic refresh
  - cache watchers
- Use per-provider cache files under `<agentDir>/cache/pi-usage/providers/`.
- Store OpenAI/Codex snapshot data in `openai-codex.json`.
- Store lock state in `openai-codex.lock`.
- Store shared backoff state in `openai-codex.backoff.json`.
- Use atomic cache writes: write temp file, then rename.
- Never overwrite a prior good cached snapshot with an error result.
- Add lock acquisition with:
  - exclusive create
  - 5s stale-lock recovery
  - up to 750ms short wait when another Pi instance is already fetching
- Add shared backoff handling:
  - respect `Retry-After` when available
  - otherwise back off for 60s
  - treat HTTP `429` as a backoff-producing failure
- Add cache watchers so one Pi instance can reuse snapshot data fetched by another.
- Ignore watcher events for locks, backoff state, failure counters, and atomic-write temp files.
- Add stale-data display with cache age and source label.
- Suppress the first transient refresh failure when prior good data exists; surface the second consecutive transient failure in provider diagnostics.

## Lifecycle And Detection

- Use only real Pi lifecycle hooks:
  - `session_start`: load cached live data, start offline scan and live refresh in parallel, emit `usage-core:ready` once offline data plus initial live state are available
  - `model_select`: update current provider context and allow forced refresh for the affected provider
  - `turn_start` and `turn_end`: update current provider context only; never force-refresh
  - periodic timer: refresh stale provider data without blocking the UI
  - `session_shutdown`: clear timers, watchers, and global guard
- Do not use `session_switch`; Pi exposes session changes through `session_shutdown` plus `session_start`.
- Add provider detection with the Bedrock fix:
  - match known providers by explicit `model.provider`
  - only fall back to model-name tokens when provider is empty
  - return `undefined` when provider is explicitly set but unknown

## Agent Directory And Credentials

- Add one injected `agentDir()` dependency backed by Pi's exported `getAgentDir()`.
- Use `agentDir()` for:
  - offline sessions at `<agentDir>/sessions`
  - live cache files under `<agentDir>/cache/pi-usage/providers/`
  - Pi credentials at `<agentDir>/auth.json`
- Resolve OpenAI/Codex credentials in this order:
  1. Token environment variables:
     - `OPENAI_CODEX_OAUTH_TOKEN`
     - `OPENAI_CODEX_ACCESS_TOKEN`
     - `CODEX_OAUTH_TOKEN`
     - `CODEX_ACCESS_TOKEN`
  2. Account environment variables:
     - `OPENAI_CODEX_ACCOUNT_ID`
     - `CHATGPT_ACCOUNT_ID`
  3. Pi credentials at `<agentDir>/auth.json`:
     - `openai-codex.access`
     - optional `openai-codex.accountId`
  4. Codex credentials at `$CODEX_HOME/auth.json`, otherwise `~/.codex/auth.json`:
     - prefer `OPENAI_API_KEY`
     - otherwise use `tokens.access_token`
     - use optional `tokens.account_id`
- Treat unreadable or malformed auth files as missing credential sources and continue fallback discovery.
- Never log access tokens or include them in diagnostics.

## Direct HTTP Adapter

- Fetch `https://chatgpt.com/backend-api/wham/usage`.
- Send:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
  - `ChatGPT-Account-Id: <accountId>` when available
- Apply a 5-second timeout and honor caller cancellation.
- Set successful snapshot source label to `ChatGPT usage API`.
- Preserve the last good cache on:
  - missing credentials
  - timeout
  - network error
  - malformed JSON
  - HTTP error
  - responses with no parseable usage windows
- On HTTP `429`, parse `Retry-After`, default to 60 seconds, and persist shared backoff.
- Forced refresh bypasses snapshot TTL but still respects active backoff and another instance's lock.
- On HTTP `401` or `403`, expose a diagnostic instructing the user to log into `openai-codex` again.

## Window Normalization

- Parse generic windows from:
  - `rate_limit.primary_window`
  - `rate_limit.secondary_window`
- Parse every entry in `additional_rate_limits`.
- Preserve all model-specific quotas, including Codex Spark.
- Prefix additional windows using:
  1. `limit_name`
  2. `metered_feature`
  3. `Additional`
- Derive labels from `limit_window_seconds`:
  - less than 24h: `<hours>h`
  - at least 24h and less than 144h: `Day`
  - at least 144h: `Week`
  - missing duration: `Primary` or `Secondary`
- Use normalized keys:
  - generic 5-hour window: `fiveHour`
  - generic weekly window: `weekly`
  - other generic windows: `primary` or `secondary`
  - additional windows: `additional:<index>:primary` or `additional:<index>:secondary`
  - monthly placeholder: `monthly`
- Keep monthly visible as unavailable in Phase 3.
- Keep credits and spend-control parsing out of scope.
- Populate compatibility live-provider fields from generic windows only. Do not expose model-specific additional windows through legacy compatibility fields.

## Required Type And Runtime Changes

- Expand `LiveUsageWindow.key` from a fixed union to `string`.
- Keep `LiveUsageWindow` fields:
  - `key`
  - `label`
  - `usedPercent`
  - `resetAt`
  - `windowDurationMins`
  - `unavailableReason`
- Keep `ProviderUsageSnapshot` fields:
  - `status`: `live` | `cached` | `stale` | `unavailable`
  - `sourceLabel`
  - `sourceKind`
  - `fetchedAt`
  - `expiresAt`
  - `staleAgeMs`
  - `windows`
  - `balances`
  - `diagnostics`
- Remove app-server-specific `rawLimitId`.
- Keep `ProviderFetchOutcome` fields:
  - `snapshot`
  - `shouldWriteCache`
  - `nextRetryAt`
- Keep `UsageProviderAdapter.fetch` inputs:
  - `force`
  - `signal`
- Remove `currentModel` from the adapter input because all additional limits render independently.
- Remove `runCommand` and subprocess helpers from `UsageDeps`.
- Keep explicit helpers required by the live runtime:
  - `agentDir`
  - exclusive file open for lock creation
  - `unlink`
  - `watch` with disposable cleanup handle
- Keep existing compatibility fields on emitted state.

## UI Behavior

- Rename the dashboard title to `Pi Usage Dashboard`.
- Keep the current dashboard layout and offline table behavior.
- Replace the placeholder OpenAI/Codex row with a live row showing:
  - availability status
  - source label
  - cache age or stale age
  - diagnostics when unavailable or stale
- Show generic and model-specific additional windows below the OpenAI/Codex row.
- Show monthly as unavailable in this phase.
- Leave MiniMax, OpenCode Go, and Command Code visible as unavailable future phases.
- Keep missing live data as a partial provider row, not a command failure.

## Usable Checkpoint

- `/usage` shows OpenAI/Codex primary and secondary live usage when credentials are available.
- `/usage` shows every model-specific `additional_rate_limits` window when returned.
- Cached OpenAI/Codex data renders immediately when available.
- Offline session dashboard remains fully functional.
- Missing auth, unavailable monthly data, and source errors render as provider diagnostics, not command failures.
- No running Codex daemon or installed Codex CLI is required.

## Acceptance Criteria

- `/usage --refresh` bypasses the OpenAI/Codex TTL and forces a direct HTTP fetch attempt.
- No live fetch is triggered on `turn_start` or `turn_end`.
- Concurrent Pi instances do not stampede the ChatGPT usage endpoint.
- Cache files are never left half-written.
- HTTP `429` creates shared backoff and preserves the last good snapshot.
- HTTP `401` and `403` produce a login diagnostic.
- Additional rate-limit windows render with stable prefixed labels.
- Session switching works through `session_shutdown` plus `session_start`; no nonexistent `session_switch` hook is used.
- The extension has no Codex CLI or app-server runtime dependency.

## Verification

- Run `npm run check`.
- Run `git diff --check`.
- Add credential-discovery tests for:
  - environment override precedence
  - `<agentDir>/auth.json`
  - `$CODEX_HOME/auth.json`
  - `~/.codex/auth.json`
  - malformed and unreadable auth fallback
  - no token leakage in diagnostics
- Add direct HTTP adapter tests for:
  - authorization and account headers
  - generic 5-hour and weekly windows
  - generic nonstandard durations
  - every `additional_rate_limits` entry
  - `limit_name`, `metered_feature`, and `Additional` prefixes
  - missing duration fallback labels
  - malformed JSON
  - empty windows
  - timeout
  - network failure
  - HTTP `401`
  - HTTP `403`
  - HTTP `429`
- Keep cache tests for:
  - atomic writes
  - lock contention
  - stale-lock recovery
  - short wait on active lock
  - shared backoff
  - `Retry-After`
  - cache watching
  - never caching errors over a good snapshot
- Keep runtime/state tests for:
  - `session_start` cached load plus background refresh
  - `model_select` forced refresh behavior
  - `turn_start` and `turn_end` context-only behavior
  - `session_shutdown` cleanup
  - compatibility field population from generic OpenAI/Codex windows only
  - no subprocess dependency
- Load the extension in Pi and verify:
  - `/usage`
  - `/usage --refresh`
  - `<agentDir>/cache/pi-usage/providers/openai-codex.json` creation
  - model changes to and from `openai-codex`
  - session changes via `/new` or `/resume`

## Out Of Scope

- MiniMax live usage.
- OpenCode Go live usage.
- Command Code live usage.
- Codex CLI or app-server integration.
- Browser/dashboard-derived OpenAI monthly usage.
- Credits and spend-control parsing.
