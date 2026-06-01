# OpenRouter Themed Usage Dashboard Phase 3: Add OpenRouter Live Usage

## Goal

Add OpenRouter as a first-class live provider using the existing cache runtime and the aligned Current Usage rows from Phase 2.

## Summary

OpenRouter support follows the CodexBar integration shape: account credits are authoritative and current-key data is optional enrichment.

## Changes

- Add `"openrouter"` to provider IDs, labels, registry order, TTLs, model detection, cache watching, placeholders, and emitted provider snapshots.
- Place OpenRouter after OpenAI/Codex in registry order.
- Add `src/providers/openrouter.ts` using `fetchWithLiveRuntime`.
- Read required `OPENROUTER_API_KEY`.
- Support optional:
  - `OPENROUTER_API_URL`
  - `OPENROUTER_HTTP_REFERER`
  - `OPENROUTER_X_TITLE`
- Default `X-Title` to `pi-usage`.
- Require `GET /api/v1/credits` and expose:
  - remaining balance
  - total credits
  - total usage
- Fetch `GET /api/v1/key` as bounded best-effort enrichment and expose:
  - `Key quota` USD window when `limit` and `usage` are valid
  - `Today`
  - `This week`
  - `This month`
- Ignore deprecated `rate_limit`.
- Preserve shared TTL, cache, stale snapshot, credential error, and `Retry-After` behavior.

## Usable Checkpoint

- `/usage` and `/usage:refresh` include OpenRouter in Current Usage.
- OpenRouter account credits remain visible even when `/key` enrichment fails.
- Existing providers remain behaviorally unchanged.

## Acceptance Criteria

- Missing `OPENROUTER_API_KEY` produces a credential diagnostic.
- `/credits` failure prevents a live OpenRouter snapshot.
- `/key` failure does not hide valid `/credits` data.
- Cached and stale OpenRouter snapshots follow the shared runtime behavior.
- OpenRouter appears after OpenAI/Codex in provider tabs.

## Test Coverage

- Verify registry order, labels, placeholders, model detection, and cache-watch behavior.
- Verify successful credits and key enrichment.
- Verify missing credentials.
- Verify optional headers and base URL.
- Verify `/key` failure degradation.
- Verify malformed `/credits`.
- Verify authentication failures.
- Verify caching, stale fallback, and `429` backoff.
- Run `pnpm check`.
- Run `git diff --check`.

## Deferred Scope

- Final Pi theme styling.
- ANSI-safe rendering helpers.
- Final keyboard-control remapping.
