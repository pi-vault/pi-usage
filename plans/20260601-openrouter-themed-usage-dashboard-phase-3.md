# OpenRouter Themed Usage Dashboard Phase 3: Add OpenRouter Live Usage

## Goal

Add OpenRouter as a first-class live provider using the existing cache runtime and the aligned Current Usage rows from Phase 2.

## Summary

OpenRouter support uses account credits as the required authoritative source and treats current-key metadata as optional enrichment. This phase keeps the existing compatibility contract unchanged and does not alter dashboard controls or styling.

## Changes

- Add `"openrouter"` to provider IDs, labels, TTLs, registry order, runtime live-provider ID handling, cache watching, placeholders, and emitted provider snapshots.
- Place OpenRouter immediately after OpenAI/Codex in provider order and Current Usage tabs.
- Add `src/providers/openrouter.ts` using `fetchWithLiveRuntime`.
- Read required `OPENROUTER_API_KEY`.
- Support optional:
  - `OPENROUTER_API_URL`
  - `OPENROUTER_HTTP_REFERER`
  - `OPENROUTER_X_TITLE`
- Default the request title to `pi-usage` and send it as the `X-OpenRouter-Title` header.
- Use `https://openrouter.ai` as the default base URL when `OPENROUTER_API_URL` is unset.
- Require `GET /api/v1/credits` and expose these balances in USD:
  - `Remaining balance`
  - `Total credits`
  - `Total usage`
- Derive `Remaining balance` from `total_credits - total_usage`, clamped at zero.
- Fetch `GET /api/v1/key` only after `/credits` succeeds, as bounded best-effort enrichment, and expose:
  - a `Key quota` USD window when a finite limit can be established from `limit`, or from `usage + limit_remaining`
  - `Today`
  - `This week`
  - `This month`
- Treat `Today`, `This week`, and `This month` as balances, not quota-bar windows.
- Ignore deprecated `rate_limit`.
- Preserve shared TTL, cache, stale snapshot, credential error, and `/credits` `Retry-After` behavior.
- Keep `state.provider`, `state.usage`, and `compatibility.currentLiveProviderId` unchanged for OpenRouter in this phase. Compatibility fields remain reserved for providers exposing the existing `fiveHour` and `weekly` window shape.
- Extend provider detection to recognize OpenRouter only from `model.provider`. Do not add `id` or `name` fallback heuristics for OpenRouter.

## Usable Checkpoint

- `/usage` and `/usage:refresh` include OpenRouter in Current Usage.
- OpenRouter account-credit balances remain visible even when `/key` enrichment fails.
- Existing providers remain behaviorally unchanged, including compatibility fields and dashboard controls.

## Acceptance Criteria

- Missing `OPENROUTER_API_KEY` produces a credential diagnostic.
- `/credits` failure prevents a live OpenRouter snapshot.
- `/credits` `401` and `403` produce a credential result.
- `/credits` `429` uses the shared runtime backoff path.
- `/key` failure does not hide valid `/credits` data and does not create provider backoff.
- Cached and stale OpenRouter snapshots follow the shared runtime behavior.
- OpenRouter appears after OpenAI/Codex in provider tabs.
- Empty-provider model IDs do not infer OpenRouter.

## Test Coverage

- Verify registry order, labels, placeholders, runtime live-provider ID handling, model detection, and cache-watch behavior.
- Verify successful `/credits` only.
- Verify successful `/credits` plus `/key` enrichment.
- Verify missing credentials.
- Verify optional headers and base URL.
- Verify `/key` failure degradation, including `429` without provider backoff.
- Verify malformed `/credits`.
- Verify `/credits` authentication failures.
- Verify caching, stale fallback, and `/credits` `429` backoff.
- Verify event and dashboard expectations so OpenRouter appears in Current Usage after OpenAI/Codex.
- Run `pnpm check`.
- Run `git diff --check`.

## Assumptions

- `OPENROUTER_X_TITLE` remains the env var name, but maps to the `X-OpenRouter-Title` request header.
- OpenRouter daily, weekly, and monthly key usage values are displayed as balances rather than quota bars.
- No compatibility behavior is added for OpenRouter until a separate phase explicitly broadens the current compatibility contract.

## Deferred Scope

- Final Pi theme styling.
- ANSI-safe rendering helpers.
- Final keyboard-control remapping.
