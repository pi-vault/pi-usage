# Pi Usage Extension Phase 5: OpenCode Go Live Usage

## Goal

Add OpenCode Go 5-hour, weekly, and monthly live usage while preserving all previously shipped functionality.

## Scope

- Add an OpenCode Go provider adapter.
- Add local usage probe strategy.
- Add authenticated OpenCode web/session source strategy.
- Cache discovered web/session credentials where safe.
- Clear cached web credentials and retry once on 401.
- Normalize dollar-value windows:
  - 5-hour usage
  - weekly usage
  - monthly usage
- Use documented OpenCode Go limits only as labels or expected limit values when the source confirms current usage.
- Never infer current usage from plan limits alone.
- Integrate OpenCode Go into provider registry, fetch-all concurrency, cache, diagnostics, and UI provider cards.

## Usable Checkpoint

- `/usage` shows OpenCode Go current usage windows when local or web source data exists.
- Missing live source, expired session, or unsupported response shape produces provider diagnostics only.
- Offline dashboard, OpenAI/Codex, and MiniMax remain usable.

## Acceptance Criteria

- Local probe is attempted before web/session source.
- A 401 clears cached web credentials and retries once.
- 5-hour, weekly, and monthly windows render independently; partial data is allowed.
- Current usage is never guessed from static limits.
- Provider diagnostics show which source succeeded or failed.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Add OpenCode Go adapter tests for local probe success, web source success, 401 retry, missing auth, partial windows, malformed response, and no-current-usage available.
- Add renderer tests for dollar-value windows and partial unavailable windows.
- Load the extension in Pi and verify `/usage` shows OpenCode Go data or actionable diagnostics.

## Out Of Scope

- Command Code live usage.
- OpenCode account login flow.
- Browser automation beyond reading existing session/cookie/local state.
