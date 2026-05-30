# Pi Usage Extension Phase 3: OpenAI Codex Live Usage

## Goal

Add OpenAI/Codex live usage while keeping the offline dashboard stable and immediately usable.

## Scope

- Implement live-provider cache under `<agentDir>/cache/pi-usage/`.
- Store per-provider snapshots with fetched timestamp, source label, diagnostics, and normalized data.
- Use atomic writes: temp file then rename.
- Add file lock with atomic creation, 5s stale-lock recovery, and short wait when another instance is fetching.
- Add shared backoff file; respect `Retry-After` when available and default to 60s.
- Never overwrite good cached data with errors.
- Add cache watchers so one Pi instance can reuse data fetched by another.
- Add stale-data display with cache age.
- Suppress first transient failure when prior data exists; surface repeated failures in provider diagnostics.
- Add lifecycle refresh rules:
  - `session_start`: load cached data, fetch stale/missing provider, emit `usage-core:ready`
  - `model_select` and `session_switch`: allow forced refresh for affected provider
  - `turn_start` and `turn_end`: update context only; never force-refresh
  - periodic timer: refresh stale provider data without blocking the UI
  - `session_shutdown`: clear timers, watchers, and global guard
- Add provider detection with the Bedrock fix:
  - match known providers by explicit `model.provider`
  - only fall back to model-name tokens when provider is empty
  - return `undefined` when provider is explicitly set but unknown
- Implement OpenAI/Codex provider sources:
  - Pi `openai-codex` auth first
  - `CODEX_HOME` or `~/.codex/auth.json` ambient credentials
  - Codex app-server JSON-RPC over stdio fallback
- Normalize 5-hour and weekly rate-limit windows.
- Select model-specific Codex buckets when available, falling back to the generic Codex bucket.
- Mark monthly unavailable unless returned by the source.
- Use 5-minute TTL for OpenAI/Codex rate-limit snapshots unless `/usage --refresh` is used.

## Usable Checkpoint

- `/usage` shows OpenAI/Codex 5-hour and weekly live usage when credentials exist.
- Offline session dashboard remains fully functional.
- Missing auth, unavailable monthly data, and source errors render as provider diagnostics, not command failures.

## Acceptance Criteria

- `/usage --refresh` bypasses the OpenAI/Codex cache.
- No network fetch is triggered on `turn_start` or `turn_end`.
- Concurrent Pi instances do not stampede the Codex usage endpoint.
- Cache files are never left half-written.
- 429 responses create shared backoff and preserve last good data.
- Model-specific snapshots are preferred over the generic Codex bucket when present.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Add cache tests for atomic writes, lock contention, stale lock recovery, backoff, `Retry-After`, cache watching, and never caching errors.
- Add detection tests for explicit provider matching, model-token fallback, and Bedrock false-positive prevention.
- Add OpenAI/Codex adapter tests with mocked Pi auth, `CODEX_HOME`, app-server fallback, missing auth, 429, partial windows, and model-specific buckets.
- Load the extension in Pi and verify `/usage` displays OpenAI/Codex usage or actionable diagnostics.

## Out Of Scope

- MiniMax live usage.
- OpenCode Go live usage.
- Command Code live usage.
- Browser/dashboard-derived OpenAI monthly usage unless directly returned by the implemented sources.
