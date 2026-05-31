# Pi Usage Extension Phase 4: MiniMax Token Plan Live Usage

## Goal

Add MiniMax Token Plan live request usage through the verified read-only API-token path while preserving the Offline
dashboard and OpenAI/Codex live usage from earlier phases.

## Summary

Implement MiniMax as the second real live provider. Use the existing Token Plan environment contract and call:

`https://api.minimax.io/v1/api/openplatform/coding_plan/remains`

A redacted live probe on 2026-05-30 confirmed an HTTP `200` response with top-level `base_resp`, `category_remains`,
and `model_remains`. Category and model rows expose interval and weekly totals, misleadingly named `*_usage_count`
remaining values, reset timestamps, and remaining durations.

This phase intentionally ships the smaller durable API-token checkpoint. Browser cookies, Chromium storage import,
HTML parsing, and billing history are deferred because they require a separate credential-import subsystem.

## Credential And Request Contract

- Resolve the MiniMax token in this order:
  1. `MINIMAX_CODING_API_KEY`
  2. `MINIMAX_API_KEY`
- Resolve the host from `MINIMAX_API_HOST`, defaulting to `https://api.minimax.io`.
- Trim trailing slashes before appending `/v1/api/openplatform/coding_plan/remains`.
- Send:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
  - `Content-Type: application/json`
  - `MM-API-Source: pi-coding-agent`
- Apply a 5-second timeout and honor caller cancellation.
- When the default global host returns HTTP `401` or `403`, retry once against `https://api.minimaxi.com`.
- Do not retry China when the configured host is already `api.minimaxi.com` or when `MINIMAX_API_HOST` is an explicit
  custom host.
- Preserve the original global invalid-credentials diagnostic if the China retry also fails.
- Never include tokens, authorization headers, or raw response bodies in diagnostics.

## Response Normalization

- Parse both top-level and `data`-wrapped payloads.
- Prefer `category_remains` for service-level display and fall back to `model_remains` when category rows are absent.
- Accept integer, finite numeric, and numeric-string values.
- Treat these fields as remaining request counts:
  - `current_interval_usage_count`
  - `current_weekly_usage_count`
- Compute `used = clamp(total - remaining, 0, total)`.
- Emit an interval window when `current_interval_total_count > 0` and the matching remaining value exists.
- Emit a weekly window when `current_weekly_total_count > 0` and the matching remaining value exists.
- Derive `usedPercent` from `used / total`.
- Prefer row `display_name`, then `category`, then `model_name` for service labels.
- Use `end_time` or `weekly_end_time` as reset timestamps, supporting epoch seconds and milliseconds.
- Fall back to `remains_time` or `weekly_remains_time` as a duration from fetch time, supporting seconds and
  milliseconds.
- Mark reset unavailable when neither reset representation is usable; do not infer a reset.
- Parse optional plan-name aliases when returned. Render plan name as unavailable when no verified plan value exists.
- Keep partial rows instead of failing the provider snapshot when at least one valid quota window exists.

## Shared Live Runtime

- Replace the MiniMax placeholder with a live adapter.
- Extract the OpenAI/Codex cache workflow into a shared live-provider helper:
  - per-provider snapshot file
  - atomic writes
  - lock acquisition with 5-second stale-lock recovery and 750ms wait
  - shared `429` backoff using `Retry-After`, defaulting to 60 seconds
  - last-good-cache preservation
  - first transient failure suppression and repeated-failure diagnostics
- Keep OpenAI/Codex behavior unchanged while moving it onto the helper.
- Store MiniMax files under `<agentDir>/cache/pi-usage/providers/`:
  - `minimax.json`
  - `minimax.lock`
  - `minimax.backoff.json`
  - `minimax.failures.json`
- Use a 60-second MiniMax TTL. Keep OpenAI/Codex at five minutes.
- Watch `openai-codex.json` and `minimax.json`. Ignore lock, backoff, failure, and temp-file events.
- Fetch live providers with a concurrency limit of three.
- Preserve provider isolation: a MiniMax failure must not affect Offline or OpenAI/Codex cards.

## Types, Detection, And UI

- Extend `LiveUsageWindow` with optional:
  - `used`
  - `limit`
  - `unit`
- Extend `ProviderUsageSnapshot` with optional `planName`.
- Detect explicit Pi provider `minimax`.
- Add MiniMax model-name fallback only when `model.provider` is empty.
- Continue returning `undefined` for unknown explicit providers to preserve the Bedrock false-positive fix.
- Force-refresh MiniMax on `model_select` when it becomes current.
- Keep `turn_start` and `turn_end` context-only; do not fetch from turn events.
- Keep compatibility fields OpenAI/Codex-only.
- Render MiniMax windows below its provider row with:
  - service and interval label
  - used requests over assigned requests
  - used percentage
  - reset time, or unavailable
  - plan name, or unavailable
- Render stale age, source label, and diagnostics consistently with OpenAI/Codex.

## Usable Checkpoint

- `/usage` shows MiniMax interval and weekly request counts for the configured Token Plan API key.
- `/usage --refresh` bypasses the MiniMax TTL while respecting active backoff and another instance's lock.
- Missing credentials, invalid credentials, unsupported response shapes, and partial data render as provider
  diagnostics.
- Offline dashboard and OpenAI/Codex live usage continue to work.

## Acceptance Criteria

- MiniMax snapshots use the shared cache, lock, stale-data, failure-suppression, and backoff system.
- `*_usage_count` fields are interpreted as remaining counts and never displayed as used counts directly.
- Region fallback is visible in diagnostics.
- MiniMax failures do not affect other provider cards.
- Partial valid MiniMax data renders without crashing or discarding the snapshot.
- Missing reset time is displayed as unavailable instead of inferred.
- No raw credentials or raw response bodies appear in diagnostics.

## Test Coverage

- Credential and request tests:
  - `MINIMAX_CODING_API_KEY` precedence over `MINIMAX_API_KEY`
  - default and explicit host resolution
  - request headers
  - timeout and cancellation
  - global-to-China fallback on `401` and `403`
  - no fallback for explicit custom or China hosts
  - `429` backoff
  - missing token and invalid-token diagnostics
- Parser tests:
  - verified top-level `category_remains` shape
  - `model_remains` fallback
  - `data` wrapper
  - numeric strings
  - interval and weekly remaining-count interpretation
  - partial rows and zero totals
  - epoch-second and epoch-millisecond reset timestamps
  - remaining-duration reset fallback
  - unavailable reset
  - optional and unavailable plan name
- Shared-runtime regression tests:
  - OpenAI/Codex cache behavior remains unchanged
  - MiniMax atomic writes, lock contention, stale-lock recovery, backoff, and never caching errors over good data
  - watcher refreshes both provider snapshot files and ignores runtime metadata files
  - live-provider fetch concurrency never exceeds three
- Runtime and renderer tests:
  - MiniMax explicit-provider and empty-provider model fallback detection
  - Bedrock false-positive prevention
  - forced `model_select` refresh
  - no live fetch on `turn_start` or `turn_end`
  - used/assigned counts, percentage, plan unavailable, reset unavailable, stale cache, and partial data rendering

## Verification

- Run `npm run check`.
- Run `git diff --check`.
- Load the extension in Pi and verify:
  - `/usage`
  - `/usage --refresh`
  - `<agentDir>/cache/pi-usage/providers/minimax.json` creation
  - interval and weekly MiniMax rows
  - model changes to and from `minimax`

## Deferred Scope

- Browser cookie import.
- Manual cookie or cURL capture parsing.
- Chromium localStorage, sessionStorage, and IndexedDB token extraction.
- MiniMax group-ID discovery.
- Coding Plan HTML and `__NEXT_DATA__` parsing.
- Billing history and 30-day token charts.
- OpenCode Go live usage.
- Command Code live usage.
