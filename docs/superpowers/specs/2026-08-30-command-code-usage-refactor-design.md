# Command Code Usage Refactor Design

## Goal

Refactor the Command Code provider into focused modules and expose its current 5-hour, weekly, and monthly usage windows through the existing dashboard model.

## Context

- Command Code documents two rolling limits—5 hours and 7 days—on top of the included monthly credit pool. Purchased credits bypass those rolling limits.
- CodexBar's captured production payloads show `windowLimits.fiveHour` and `windowLimits.weekly`, each containing `cap`, `used`, and `resetAt`. `windowLimits` may appear at the response root or inside `credits`.
- `pi-usage` already has the required `LiveUsageWindow` model, cache runtime, and dashboard rendering. Pi itself has no usage-limit integration to change.

Reference: <https://commandcode.ai/docs/resources/usage-limits>

## Architecture

Replace the single `src/providers/command-code.ts` file with three modules:

- `src/providers/command-code/index.ts` owns provider orchestration, cache-runtime integration, and final error classification.
- `src/providers/command-code/api-client.ts` owns cookie normalization, request headers, concurrent endpoint fetching, response decoding, and endpoint diagnostics.
- `src/providers/command-code/usage-parser.ts` is a pure payload parser that returns windows, balances, and the display plan name.

The provider registry imports the new directory entrypoint. No public exports, shared types, configuration keys, dependencies, or TUI code change.

## Usage Semantics

Emit windows in this order:

1. `fiveHour`, labeled `5h`, with a 300-minute duration.
2. `weekly`, labeled `Weekly`, with a 10,080-minute duration.
3. `monthly`, labeled `Monthly`, resetting at the subscription period end.

For rolling windows, require a positive `cap`, default missing `used` to zero, retain USD `used` and `limit`, and clamp the calculated percentage to 0–100 without discarding fractional precision. Accept reset timestamps expressed as epoch seconds, epoch milliseconds, numeric strings, or ISO strings.

Calculate the monthly window from existing API data: `used = summary.totalCost` and `limit = totalCost + credits.monthlyCredits`. Purchased credits remain a separate balance and never increase this monthly limit. If only one side of the calculation is available, retain the existing unavailable-reason window.

Preserve existing request/token balances. Recognize `individual-go`, `individual-goat`, `individual-pro`, `individual-pro-v1`, `individual-max`, and `individual-ultra` display names; use an unknown plan ID verbatim.

## Failure Behavior

Fetch summary, credits, and subscription concurrently. Summary and credits are primary endpoints; subscription is enrichment only.

Publish a live snapshot whenever parsing yields at least one window or balance, attaching diagnostics for any failed endpoint. When no usable data exists, preserve the existing priority: a primary 429 response produces rate-limited state, a primary 401/403 response produces credential state, and all other cases produce a generic live-source error. Existing cache and backoff behavior remains unchanged.

## Verification

Extend the existing Command Code tests with pure parser coverage for both payload locations, value coercion, reset formats, invalid caps, percentage clamping, window ordering, monthly purchased-credit exclusion, and plan names. Preserve the cookie, subscription-enrichment, and partial-failure integration coverage.

Run the focused provider test and then the complete project check. Node.js remains `>=24.15.0`.
