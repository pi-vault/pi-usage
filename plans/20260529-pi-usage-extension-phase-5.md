# Pi Usage Extension Phase 5: OpenCode Go Manual Web Source With Combined Local Fallback

## Goal

Add OpenCode Go 5-hour, weekly, and monthly usage without bundling browser-cookie import or workspace discovery.
Prefer an authoritative manually configured dashboard source, then fall back to clearly labeled local dollar
estimates from OpenCode SQLite and Pi JSONL history. Preserve the Offline dashboard, OpenAI/Codex live usage, and
MiniMax live usage.

## Summary

OpenCode Go enforces dollar-value limits: `$12` per 5 hours, `$30` weekly, and `$60` monthly. The official
documentation includes model-dependent request examples, but those are not fixed request caps. OpenCode computes the
authoritative percentages and reset times server-side in the `lite.subscription.get` SolidStart query.

Implement the smallest verified authoritative path from CodexBar: when a user provides a dashboard cookie and
workspace ID, fetch `https://opencode.ai/workspace/<workspaceID>/go` and parse the serialized hydration payload.
Avoid CodexBar's broader browser import, Keychain cache, workspace discovery, and optional Zen balance layers in this
checkpoint.

When the dashboard source is not configured or cannot be used, estimate local dollar windows from both stores:

- OpenCode client sessions recorded under its XDG SQLite database.
- Pi sessions recorded independently under `<agentDir>/sessions/**/*.jsonl`.

Pi sends OpenCode Go inference requests directly to `https://opencode.ai/zen/go/...`; those requests do not pass
through the OpenCode client's SQLite projector. Combining both local stores gives a more useful degraded estimate on
the current machine while remaining explicitly non-authoritative.

## Public Configuration And Dependencies

- Add environment variables:
  - `OPENCODE_GO_COOKIE_HEADER`: a manual cookie header containing `auth` or `__Host-auth`.
  - `OPENCODE_GO_WORKSPACE_ID`: a raw `wrk_...` ID or an OpenCode workspace URL containing that ID.
- Keep `OPENCODE_DB` support for overriding the OpenCode SQLite database path.
- Raise `package.json` `engines.node` from `>=22` to `>=22.12`. `node:sqlite` added `DatabaseSync({ readOnly: true })`
  in Node 22.12.
- Add an injected read-only SQLite opener to `UsageDeps`, defaulting to
  `new DatabaseSync(path, { readOnly: true })`. Always close the connection in `finally`.
- Extend the shared live-runtime provider ID union to include `opencode-go`.

## Authoritative Dashboard Source

- Attempt the dashboard source first only when both `OPENCODE_GO_COOKIE_HEADER` and `OPENCODE_GO_WORKSPACE_ID`
  normalize successfully. Otherwise, record a setup diagnostic and continue to the local fallback.
- Normalize the workspace ID by accepting:
  - a raw `wrk_...` value
  - `https://opencode.ai/workspace/<wrk_...>/...`
- Filter the outgoing cookie header to `auth` and `__Host-auth` only. Never forward unrelated cookies.
- Fetch `https://opencode.ai/workspace/<workspaceID>/go` with:
  - `GET`
  - `Cookie: <filtered-cookie-header>`
  - a browser-like `User-Agent`
  - a 5-second timeout combined with caller cancellation
- Follow redirects manually with a small fixed redirect limit. Allow only same-host `https://opencode.ai` redirects.
- Parse only the verified serialized hydration fields:
  - `rollingUsage.usagePercent` and `rollingUsage.resetInSec`
  - `weeklyUsage.usagePercent` and `weeklyUsage.resetInSec`
  - optional `monthlyUsage.usagePercent` and `monthlyUsage.resetInSec`
- Normalize web windows as percentage-only `LiveUsageWindow` values with reset timestamps derived from fetch time.
- Treat HTTP `401`, HTTP `403`, signed-out content, timeout, network errors, and unsupported hydration shapes as
  sanitized source diagnostics, then attempt the local fallback.
- Use source label `OpenCode Go dashboard` when the dashboard strategy succeeds.
- Do not fetch the hashed SolidStart `_server` workspace-discovery action. Requiring the workspace ID keeps this
  checkpoint independent of unstable server-function hashes.

## Combined Local Fallback

### OpenCode SQLite

- Resolve the OpenCode data directory from `${XDG_DATA_HOME?.trim() || join(homeDir(), ".local/share")}/opencode`.
- Resolve the SQLite database in this order:
  1. `OPENCODE_DB`, absolute or relative to the OpenCode data directory.
  2. `<dataDir>/opencode.db`, used by `latest`, `beta`, and `prod` channels.
  3. The only `<dataDir>/opencode-*.db` file, used by other channel builds.
  4. If multiple channel databases remain, report an actionable diagnostic asking for `OPENCODE_DB`; do not merge
     potentially overlapping databases.
- Reject `OPENCODE_DB=:memory:` because another process cannot inspect that database.
- Open the selected database read-only. Do not require an auth file: OpenCode is migrating legacy `auth.json` state
  to `account.json`, and historical rows are sufficient.
- Prefer current `session_message` rows when the table contains qualifying records:
  - `type = "assistant"`
  - `data.model.providerID = "opencode-go"`
  - `data.cost` is a finite positive number
  - timestamp comes from `data.time.created`, falling back to `session_message.time_created`
- Otherwise, read legacy direct assistant message costs from `message.data` when:
  - `providerID = "opencode-go"`
  - `role = "assistant"`
  - `cost` is a finite positive number
  - timestamp comes from `data.time.created`, falling back to `message.time_created`
- In the legacy path, when the `part` table exists, add `step-finish` part costs only for qualifying OpenCode Go
  assistant messages that do not already have a direct message cost.
- Never combine current and legacy SQLite projections. OpenCode can maintain both schemas during migration.

### Pi JSONL

- Reuse the existing recursive Pi session scan under `<agentDir>/sessions/**/*.jsonl`.
- Extend the offline parser to accept both:
  - legacy numeric `message.usage.cost`
  - current numeric `message.usage.cost.total`
- Preserve the existing row-ID and fallback-ID deduplication for copied Pi history.
- Select Pi fallback rows with:
  - `message.role = "assistant"`
  - `message.provider = "opencode-go"`
  - a finite positive parsed cost
  - an existing valid timestamp
- Do not deduplicate across SQLite and Pi JSONL. They represent independent client histories.

### Estimate Normalization

- Combine qualifying SQLite and Pi JSONL rows, then emit dollar windows with `used`, `limit`, `unit: "USD"`, and
  `usedPercent`.
- Use the documented dollar limits:
  - rolling 5-hour: `$12`
  - weekly: `$30`
  - monthly: `$60`
- Replay chronological rows into the server-compatible fixed rolling bucket model:
  - start a bucket at the first row
  - include rows through exactly `bucketStart + 5 hours`
  - start a new bucket only when a later row exceeds that boundary
  - if the latest bucket has expired, report `$0` used and an approximate reset at `now + 5 hours`
- Compute the weekly window from the current UTC Monday through the next UTC Monday.
- Approximate the unavailable subscription timestamp with the earliest combined positive-cost row. Preserve its UTC
  day/time in later monthly windows and clamp short months to their final day.
- Preserve observed dollar amounts above the documented limits and clamp displayed percentages to `0..100`.
- Skip malformed rows and include a sanitized diagnostic when useful local rows remain. Treat missing databases,
  missing tables, SQLite failures, and no qualifying combined rows as fallback diagnostics without breaking other
  provider cards.
- Use source label `OpenCode/Pi local estimate` and always explain that local values can omit other machines and use
  an approximate monthly anchor.

## Shared Runtime, Detection, And UI

- Replace the OpenCode Go placeholder with a web-first adapter using the existing cache, lock, stale-cache
  preservation, and failure-suppression helper.
- Store OpenCode Go runtime files under `<agentDir>/cache/pi-usage/providers/`:
  - `opencode-go.json`
  - `opencode-go.lock`
  - `opencode-go.failures.json`
- Use a 60-second TTL. Do not add a network backoff file in this phase.
- Watch `opencode-go.json` alongside the existing OpenAI/Codex and MiniMax snapshot files.
- Detect explicit Pi provider `opencode-go`. Add model-name fallback for `opencode-go` only when `model.provider` is
  empty. Preserve the existing unknown-explicit-provider behavior.
- Force-refresh OpenCode Go on `model_select` when it becomes current. Keep `turn_start` and `turn_end` context-only.
- Render successful dashboard windows as percentages with reset timestamps.
- Render fallback windows with dollar values, percentages, reset timestamps, and the local-estimate diagnostic.
- Keep compatibility fields OpenAI/Codex-only.
- Keep the existing provider fetch concurrency limit of three.

## Usable Checkpoint

- `/usage` shows authoritative OpenCode Go percentage windows when the two dashboard environment variables are valid.
- `/usage` falls back to combined local OpenCode/Pi dollar estimates when dashboard configuration is missing or the
  dashboard request cannot be used.
- `/usage --refresh` bypasses the OpenCode Go TTL while respecting another instance's lock.
- OpenCode Go diagnostics identify which source failed without exposing cookies, database rows, raw HTML, or raw
  response bodies.
- Offline, OpenAI/Codex, and MiniMax cards remain usable when OpenCode Go fails.

## Test Coverage

- Dashboard-source tests:
  - missing and malformed environment variables
  - workspace ID normalization from raw values and URLs
  - cookie filtering for `auth` and `__Host-auth`
  - same-host HTTPS redirect guard and redirect limit
  - verified hydration parsing, optional monthly data, and reset timestamps
  - signed-out content, `401`, `403`, timeout, network failure, and unsupported payload fallback
  - sanitized diagnostics with no cookie or raw HTML leakage
- SQLite-reader tests:
  - `OPENCODE_DB`, stable database, single channel database, ambiguous channel databases, and `:memory:`
  - direct message costs, `step-finish` fallback costs, and no double counting
  - current `session_message` preference over projected legacy rows
  - malformed rows, unsupported schema, missing database, and connection close behavior
- Pi JSONL tests:
  - nested `usage.cost.total` and legacy numeric `usage.cost`
  - positive-cost filtering and malformed rows
  - copied-history deduplication
  - combined SQLite and Pi summation without cross-store deduplication
- Normalization tests:
  - fixed rolling buckets, exact 5-hour boundary, and expired bucket
  - UTC-week boundary
  - approximate anchored-month boundary and short-month clamp
  - observed cost above limit with clamped percentage
- Runtime and renderer tests:
  - OpenCode Go cache TTL, forced refresh, lock contention, stale-lock recovery, and last-good-cache preservation
  - watcher refresh for `opencode-go.json`
  - explicit-provider and empty-provider model fallback detection
  - Bedrock false-positive prevention
  - forced `model_select` refresh and no live fetch on `turn_start` or `turn_end`
  - web percentage windows, fallback dollar windows, diagnostics, stale cache, and missing local state

## Verification

- Run `npm run check`.
- Run `git diff --check`.
- Load the extension in Pi and verify:
  - `/usage` with `OPENCODE_GO_COOKIE_HEADER` and `OPENCODE_GO_WORKSPACE_ID`
  - `/usage` without the dashboard variables
  - `/usage --refresh`
  - `<agentDir>/cache/pi-usage/providers/opencode-go.json` creation
  - model changes to and from `opencode-go`

## Deferred Scope

- Automatic browser-cookie import.
- Cached browser-cookie storage and invalidation.
- Workspace discovery through hashed SolidStart `_server` actions.
- Optional Zen balance scraping.
- Model-specific request-count projections.
- Direct API-key quota fetching unless OpenCode adds a read-only endpoint.
- Command Code live usage.
