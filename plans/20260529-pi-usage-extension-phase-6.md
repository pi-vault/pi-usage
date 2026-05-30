# Pi Usage Extension Phase 6: Command Code Usage

## Goal

Represent Command Code accurately with best-effort live usage and reliable session-file fallback.

## Scope

- Add a Command Code provider adapter.
- Reuse Command Code credential discovery:
  - Pi auth
  - `COMMAND_CODE_API_KEY`
  - `~/.commandcode/auth.json`
  - `PI_CODING_AGENT_DIR/auth.json`
- Perform a discovery spike for stable live usage sources that can provide:
  - consumed usage
  - available balance or remaining usage
  - total cost
- Implement any discovered stable Studio/API source behind a provider strategy.
- Always provide session-file fallback for consumed and total cost.
- Mark live available balance unavailable when no stable source is found.
- Integrate Command Code into provider registry, fetch-all concurrency, cache, diagnostics, and UI provider cards.

## Usable Checkpoint

- `/usage` shows Command Code consumed and total cost from session history at minimum.
- If a stable live source is discovered, `/usage` also shows available balance with source diagnostics.
- The dashboard remains usable even when live Command Code data is unavailable.

## Acceptance Criteria

- Command Code credential discovery covers all known local credential sources.
- Session-file fallback works without network and without Command Code credentials.
- Live-source failure does not hide session fallback totals.
- Available balance is not guessed.
- Diagnostics clearly distinguish live source unavailable, credentials missing, and session fallback active.

## Verification

- Run `npm test`.
- Run `npm run typecheck`.
- Add Command Code tests for credential discovery, session fallback, live source success if implemented, missing auth, live source failure, and partial unavailable balance.
- Add renderer tests for consumed cost, total cost, unavailable balance, and fallback diagnostics.
- Load the extension in Pi and verify `/usage` shows Command Code fallback usage or live usage if available.

## Out Of Scope

- Blocking phase completion on live available balance when no stable source exists.
- Command Code login flow.
- Modifying the separate Command Code provider package.
