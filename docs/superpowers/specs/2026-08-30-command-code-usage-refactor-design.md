# Command Code Usage Refactor Design

## Goal

Refactor the Command Code provider into focused modules and expose its reliable 5-hour and weekly usage windows alongside the existing credit and activity balances.

## Context

- Command Code documents two rolling limits—5 hours and 7 days—on top of the included monthly credit pool. Purchased credits bypass those rolling limits.
- CodexBar's captured production payloads show `windowLimits.fiveHour` and `windowLimits.weekly`, each containing `cap`, `used`, and `resetAt`. `windowLimits` may appear at the response root or inside `credits`.
- The rolling values are credit-value quotas, not a universally safe USD ratio. CodexBar therefore retains their percentage and reset timing without presenting a currency ratio.
- `summary.totalCost` is request-history cost, while `credits.monthlyCredits` is the remaining included grant. Purchased usage can increase the former without reducing the latter, so the two values cannot reliably reconstruct a monthly allowance.
- `pi-usage` already has the required `LiveUsageWindow` model, cache runtime, balance model, and dashboard rendering. Pi itself has no usage-limit integration to change.

Reference: <https://commandcode.ai/docs/resources/usage-limits>

## Architecture

Replace the single `src/providers/command-code.ts` file with three modules:

- `src/providers/command-code/index.ts` owns provider orchestration, cache-runtime integration, and final error classification.
- `src/providers/command-code/api-client.ts` owns cookie normalization, request headers, concurrent endpoint fetching, response decoding, and endpoint diagnostics.
- `src/providers/command-code/usage-parser.ts` is a pure payload parser that returns rolling windows, balances, and the display plan name.

The provider registry imports the new directory entrypoint. No public exports, shared types, configuration keys, dependencies, or TUI code change.

## Usage Semantics

Emit reliable rolling windows in this order:

1. `fiveHour`, labeled `5h`, with a 300-minute duration.
2. `weekly`, labeled `Weekly`, with a 10,080-minute duration.

For each rolling window, require a positive `cap`, default missing `used` to zero, and clamp the calculated percentage to 0–100 without discarding fractional precision. Accept reset timestamps expressed as epoch seconds, epoch milliseconds, numeric strings, or ISO strings. Expose only the window key, label, percentage, reset timestamp, and duration; do not label raw rolling values as USD or render a ratio.

Do not synthesize a monthly usage window from `summary.totalCost` and `credits.monthlyCredits`. Preserve `monthlyCredits` and positive `purchasedCredits` as separate USD balances. Preserve existing request/token balances and their precedence: use `totalTokens` when available, otherwise retain the separate input/output totals.

Recognize `individual-go`, `individual-goat`, `individual-pro`, `individual-pro-v1`, `individual-max`, and `individual-ultra` display names; use an unknown plan ID verbatim.

## Failure Behavior

Fetch summary, credits, and subscription concurrently. Summary and credits are primary endpoints; subscription is enrichment only.

Publish a live snapshot whenever parsing yields at least one window or balance, attaching diagnostics for any failed endpoint. When no usable data exists, preserve the existing priority: a primary 429 response produces rate-limited state, a primary 401/403 response produces credential state, and all other cases produce a generic live-source error. Existing cache and backoff behavior remains unchanged.

## Verification

Extend the existing Command Code tests with pure parser coverage for both payload locations, value coercion, reset formats, invalid caps, percentage clamping, window ordering, the absence of a synthesized monthly window, balance preservation, token precedence, and plan names. Preserve the cookie, subscription-enrichment, and partial-failure integration coverage.

Run the focused provider test and then the complete project check on Node.js `>=24.15.0`.
