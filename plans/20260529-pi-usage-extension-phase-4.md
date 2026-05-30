# Pi Usage Extension Phase 4: MiniMax Live Usage

## Goal

Add MiniMax current request usage while preserving the Offline and OpenAI/Codex functionality from earlier phases.

## Scope

- Add a MiniMax provider adapter.
- Add ordered MiniMax fetch strategies for Coding Plan / Token Plan sources.
- Support browser/localStorage token context with group IDs where required.
- Support global and China-region source behavior, including retrying China on global auth failure when applicable.
- Parse `https://api.minimax.io/user-center/payment/coding-plan` HTML `__NEXT_DATA__` or JSON responses when used by the source.
- Interpret `/coding_plan/remains` `*_usage_count` fields as remaining when that response shape is returned.
- Compute used requests as `total - remaining`.
- Display:
  - used requests
  - assigned/total requests
  - reset time
  - plan name
  - service breakdown when available
- Use flexible JSON path parsing for MiniMax response variants.
- Integrate MiniMax into provider registry, fetch-all concurrency, cache, diagnostics, and UI provider cards.

## Usable Checkpoint

- `/usage` shows MiniMax used/assigned request counts and reset data when source data exists.
- Missing MiniMax credentials or unsupported response shapes render as diagnostics.
- Offline dashboard and OpenAI/Codex live usage continue to work.

## Acceptance Criteria

- MiniMax failures do not affect other provider cards.
- MiniMax snapshots use the shared cache and backoff system.
- Region fallback is visible in diagnostics.
- Response parsing handles known response variants without crashing.
- If no reset time is available, the reset field is marked unavailable instead of inferred.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Add MiniMax adapter tests for successful Coding Plan response, `/coding_plan/remains`, remaining-count interpretation, region fallback, missing credentials, malformed response, and partial data.
- Add renderer tests for MiniMax request-count display and unavailable reset values.
- Load the extension in Pi and verify `/usage` shows MiniMax data or actionable diagnostics.

## Out Of Scope

- OpenCode Go live usage.
- Command Code live usage.
- Any MiniMax write/login flow; only discover and use existing credentials/sessions.
