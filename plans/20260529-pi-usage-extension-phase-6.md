# Pi Usage Extension Phase 6: Command Code Aggregate Web Usage With Local Fallback

## Goal

Replace the Command Code placeholder with a real provider that shows authoritative current-cycle usage when a valid web
session is available and otherwise falls back to local Pi session totals without breaking `/usage`.

## Summary

Command Code billing is not exposed through the inference API-key flow used by the separate provider package.
The verified live source is the signed-in web usage API on `https://api.commandcode.ai`, authenticated with a Better
Auth session cookie from `commandcode.ai`.

Redacted live responses captured on `2026-05-31` confirm the intended aggregate contract:

- `GET /internal/usage/summary` returns consumed current-cycle cost and aggregate request/token counts
- `GET /internal/billing/credits` returns remaining monthly and purchased credits
- `GET /internal/billing/subscriptions` returns the active plan identifier and renewal window

For the validated sample:

- `summary.totalCost = 4.2888`
- `credits.monthlyCredits = 5.7116`
- `credits.purchasedCredits = 0`
- `subscriptions.data.planId = individual-go`
- `4.2888 + 5.7116 = 10`, which reconciles exactly with the Go monthly allowance

This phase should implement the smallest durable checkpoint:

- use a manually supplied session cookie for aggregate web usage
- treat `summary.totalCost` as the authoritative consumed amount for the current cycle
- treat `credits` as the authoritative remaining balance
- use subscription metadata only for plan labeling and renewal timing
- keep local Pi session-file totals as an offline fallback
- defer paginated request-history ingestion from `/internal/usage`

The existing offline scanner already supports nested `usage.cost.total` rows, and local session history on this machine
confirms that Command Code turns are recorded under provider `command-code`.

## Live Source Contract

- Add `COMMAND_CODE_COOKIE_HEADER` as the Phase 6 configuration input.
- Accept either:
  - a raw `Cookie:` header or cookie fragment
  - a bare Better Auth session token
- Normalize and retain only one supported session cookie:
  - `__Secure-commandcode_prod_.session_token`
  - `__Host-better-auth.session_token`
  - `__Secure-better-auth.session_token`
  - `better-auth.session_token`
- Ignore `__Secure-commandcode_prod_.session_data`; it is optional cached session data, not the authentication token.
- Never forward unrelated cookies.
- Do not use `COMMAND_CODE_API_KEY` or `COMMANDCODE_API_KEY` for usage or billing reads in this phase.
- Fetch these endpoints concurrently:
  - `GET https://api.commandcode.ai/internal/usage/summary`
  - `GET https://api.commandcode.ai/internal/billing/credits`
  - `GET https://api.commandcode.ai/internal/billing/subscriptions`
- Send:
  - `Cookie: <normalized-session-cookie>`
  - `Accept: application/json, text/plain, */*`
  - `Accept-Language: en-US,en;q=0.9`
  - browser-like `User-Agent`
  - `Origin: https://commandcode.ai`
  - `Referer: https://commandcode.ai/`
- Apply a 5-second timeout and honor caller cancellation.
- Treat HTTP `401` and `403` as expired or invalid session diagnostics.
- Treat non-2xx responses, parse failures, and network failures as live-source diagnostics without exposing raw
  response bodies.

## Usage Normalization

- Parse `/internal/usage/summary` from the verified shape:
  - `totalCount`
  - `totalCost`
  - `totalTokensIn`
  - `totalTokensOut`
  - `totalTokens`
  - `totalCredits`
  - `totalFreeCredits`
  - `totalMonthlyCredits`
  - `totalPurchasedCredits`
- Parse `/internal/billing/credits` from the verified shape:
  - `credits.monthlyCredits`
  - `credits.purchasedCredits`
  - `credits.premiumMonthlyCredits`
  - `credits.opensourceMonthlyCredits`
- Parse `/internal/billing/subscriptions` from the verified shape:
  - `success`
  - optional `data`
  - `data.planId`
  - `data.status`
  - `data.currentPeriodStart`
  - `data.currentPeriodEnd`
- Treat `success: true` with `data: null` as free-tier or unsubscribed state, not a hard failure.
- Compute the current-cycle window as:
  - `used = summary.totalCost`
  - `remaining = monthlyCredits + purchasedCredits`
  - `limit = used + remaining`
  - `usedPercent = used / limit`, guarded for zero
- Do not derive the live meter from static plan pricing when summary and credits are available.
- Parse known `planId` values into display labels:
  - `individual-go` -> `Go`
  - `individual-pro` -> `Pro`
  - `individual-max` -> `Max`
  - `individual-ultra` -> `Ultra`
- If the subscription is active but `planId` is unknown:
  - do not fail the snapshot
  - surface the raw plan ID only as sanitized diagnostic or label detail
  - keep the aggregate usage window if summary and credits are usable
- Render the live Command Code window as a current-cycle USD window with:
  - `used`
  - `limit`
  - `unit: "USD"`
  - `usedPercent`
  - `resetAt` from `currentPeriodEnd` when available
- Render request count and token totals when present in summary.
- Render purchased-credit balance separately when non-zero.
- Treat `premiumMonthlyCredits` and `opensourceMonthlyCredits` as descriptive detail only unless later verified to
  change the user-visible balance contract.

## Partial Live Data Rules

- If summary succeeds but credits fail:
  - show consumed current-cycle cost
  - leave remaining balance and percentage unavailable
  - retain the live-source diagnostic
- If credits succeed but summary fails:
  - show remaining balances
  - leave consumed current-cycle cost unavailable
  - retain the live-source diagnostic
- If subscriptions fail but summary and credits succeed:
  - show the aggregate current-cycle meter
  - leave plan label and reset time unavailable
  - retain a sanitized enrichment diagnostic
- Return a fully unavailable live snapshot only when no useful aggregate data can be derived.

## Pi Session Fallback

- Reuse the existing recursive Pi session scan under `<agentDir>/sessions/**/*.jsonl`.
- Select Command Code fallback rows where:
  - `message.role = "assistant"`
  - provider is `command-code`
  - provider alias `commandcode` is also accepted for compatibility
  - parsed cost is finite and positive
  - timestamp is valid
- Keep using the existing nested-cost support:
  - legacy numeric `message.usage.cost`
  - current numeric `message.usage.cost.total`
- Aggregate Pi fallback into an all-time local total cost for Command Code sessions.
- Do not infer current-cycle allowance, remaining balance, or reset time from session history.
- Use Pi session fallback only when no useful web aggregate is available.
- When live usage is unavailable but local rows exist:
  - return a partial Command Code snapshot backed by local totals
  - mark the source as local fallback rather than live billing
  - state clearly that the snapshot reflects only local Pi session history
- When live usage succeeds:
  - local totals may still be shown as a secondary signal if the existing card model allows it
  - make clear that local totals are not authoritative account-wide usage

## Shared Runtime, Detection, And UI

- Replace the Command Code placeholder with a real provider adapter using the existing shared live-runtime helper.
- Extend the live runtime provider union and registry to include `command-code`.
- Store runtime files under `<agentDir>/cache/pi-usage/providers/`:
  - `command-code.json`
  - `command-code.lock`
  - `command-code.backoff.json`
  - `command-code.failures.json`
- Use a 60-second TTL.
- Reuse the shared atomic write, stale-lock recovery, `Retry-After` backoff, last-good-cache preservation, and
  repeated-failure suppression behavior already used by other live providers.
- Watch `command-code.json` alongside the existing live snapshot files.
- Force-refresh Command Code on `model_select` when it becomes current.
- Detect explicit Pi provider `command-code`.
- Also detect explicit legacy provider `commandcode` as Command Code.
- Preserve the existing Bedrock-safe rule: only use model-name fallback when `model.provider` is empty.
- Extend the snapshot model and renderer as needed so Command Code can show:
  - a current-cycle USD live window
  - request count and token totals from summary
  - remaining purchased credits when present
  - a local all-time fallback row when only session history is available
  - diagnostics that distinguish invalid session, partial live data, and local fallback
- Add a local-source status marker if needed so fallback cards do not present themselves as live-provider results.
- Keep compatibility fields OpenAI/Codex-only.
- Replace the stale generic bootstrap diagnostic with a phase-neutral live-runtime diagnostic.

## Usable Checkpoint

- `/usage` shows authoritative Command Code current-cycle usage when `COMMAND_CODE_COOKIE_HEADER` is valid.
- `/usage` still shows Command Code local session totals when live usage is unavailable or not configured.
- `/usage --refresh` bypasses the Command Code TTL while respecting lock contention and active backoff.
- Command Code failures do not affect Offline, OpenAI/Codex, MiniMax, or OpenCode Go cards.
- Diagnostics remain sanitized and actionable.

## Acceptance Criteria

- Live usage uses only the verified cookie-authenticated aggregate endpoints.
- API-key-based auth is not misrepresented as a usage or billing source.
- The displayed current-cycle meter is derived from `summary.totalCost + credits.remaining`, not guessed plan pricing.
- Unknown active plans do not block the aggregate meter.
- Session fallback remains usable without network and without live configuration.
- Supported provider detection covers both `command-code` and `commandcode`.
- No cookie values, raw response bodies, or session contents appear in diagnostics.

## Test Coverage

- Cookie normalization tests:
  - secure, host, and plain Better Auth cookie names
  - bare token normalization
  - unrelated-cookie stripping
  - malformed and empty cookie input
- Live fetch tests:
  - request headers
  - timeout and cancellation
  - HTTP `401` and `403`
  - HTTP `429` backoff
  - network failure
  - non-2xx API failure
- Aggregate parser tests:
  - the verified summary, credits, and subscription response shapes
  - numeric-string token fields
  - known plan IDs
  - free tier with `data: null`
  - unknown active plan
  - purchased credits
  - ISO reset timestamps
  - malformed JSON and unsupported shapes
  - partial endpoint success
- Session fallback tests:
  - provider `command-code`
  - legacy provider alias `commandcode`
  - nested `usage.cost.total`
  - positive-cost filtering
  - no local rows
- Runtime and renderer tests:
  - cache TTL
  - forced refresh
  - lock contention
  - watcher refresh for `command-code.json`
  - explicit-provider detection
  - current-cycle USD rendering
  - request and token-count rendering
  - local fallback rendering
  - sanitized diagnostics

## Verification

- Run `npm run check`.
- Run `git diff --check`.
- Load the extension in Pi and verify:
  - `/usage` with `COMMAND_CODE_COOKIE_HEADER`
  - `/usage` without `COMMAND_CODE_COOKIE_HEADER`
  - `/usage --refresh`
  - `<agentDir>/cache/pi-usage/providers/command-code.json` creation
  - model changes to and from `command-code`

## Deferred Scope

- Automatic browser-cookie import.
- Reading usage or billing directly from inference API keys.
- Browser-storage extraction.
- Studio HTML scraping.
- Paginated request-history import from `GET /internal/usage?limit=100&offset=...`.
- `GET /internal/usage/charts`.
- Model-level breakdown unless a verified summary field is exposed for it.
- Cross-machine reconciliation beyond the aggregate web endpoints.
