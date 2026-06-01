# OpenRouter and Themed Usage Dashboard

## Summary

Update only `pi-usage`. Add OpenRouter live usage, register `/usage:refresh`, remove all `/usage --refresh` support, and refactor the dashboard to follow Pi's themed TUI style.

## Public Interfaces

- Add `"openrouter"` to `ProviderId`, registry, cache watching, model detection, labels, TTLs, and additive `UsageCoreState.providers` snapshots.
- Keep `/usage` for opening cached usage.
- Add `/usage:refresh` for force-refreshing providers, rescanning local history, and opening the dashboard.
- Treat any `/usage` arguments as unsupported. Do not add compatibility or deprecation handling for `--refresh`.

## Implementation

1. Add `src/providers/openrouter.ts` using the existing cached provider runtime.
   - Read `OPENROUTER_API_KEY`.
   - Support optional `OPENROUTER_API_URL`, `OPENROUTER_HTTP_REFERER`, and `OPENROUTER_X_TITLE`; default `X-Title` to `pi-usage`.
   - Require `GET /api/v1/credits`; expose balance, total credits, and total usage.
   - Fetch `GET /api/v1/key` as bounded best-effort enrichment; expose a `Key quota` window when `limit` and `usage` are valid plus `Today`, `This week`, and `This month` USD lines.
   - Ignore deprecated `rate_limit`.
   - Preserve existing TTL, cache, stale snapshot, credential error, and `Retry-After` behavior.
   - Place OpenRouter after OpenAI/Codex in provider order.

2. Replace refresh argument parsing in `src/index.ts`.
   - Register separate `usage` and `usage:refresh` commands.
   - Remove `--refresh` parsing and related documentation.
   - Keep `/usage` side-effect-light: use cached providers and scan local history only when needed.
   - Make `/usage:refresh` explicitly force provider refresh and offline rescan.

3. Refactor `src/ui/dashboard.ts` with Pi theme primitives and ANSI-visible width handling.
   - Pass `theme` and `tui.requestRender()` into the component.
   - Add themed borders, accent titles, dim inactive tabs, border separators, and dim help text.
   - Default Usage Statistics to `All Time`.
   - Use `Left`/`Right` for periods, `Up`/`Down` for rows, `Enter` or `Space` for expansion, `Tab` and `Shift-Tab` for Current Usage providers, `v` for insights, and `q`/`Esc` to close.
   - Remove the extra `>` cursor. Highlight only the selected disclosure arrow and provider label.
   - Use wide columns `Provider / Model`, `Sessions`, `Msgs`, `Cost`, `Tokens`, `In`, `Out`, `Cache`; retain directional arrow prefixes on `In` and `Out`, and dim `In`, `Out`, `Cache`, expanded model rows, and the formula legend.
   - Preserve responsive compact layouts.

4. Redesign Current Usage quota lines.
   - Pad labels to a shared width so all bars align vertically.
   - Render `label: [bar] X% left (resets HH:mm[ on D MMM]) - used/limit`.
   - Dim labels, reset text, and optional ratio. Highlight remaining bar fill and percentage.
   - Keep fixed-width bars and render `(reset unavailable)` where needed.

## Test Plan

- Add OpenRouter tests for credits and key enrichment, missing credentials, optional headers/base URL, `/key` failure degradation, malformed `/credits`, authentication failures, and `429` backoff.
- Update registry, provider detection, placeholder, cache-watch, and event payload tests for OpenRouter.
- Update command tests for `/usage`, `/usage:refresh`, unsupported `/usage` arguments, and non-UI behavior.
- Add dashboard tests for themed ANSI output, visible-width alignment, combined `Cache`, All Time default, arrow statistics navigation, Tab provider navigation, selected-row styling, aligned bars, compact reset formatting, and responsive layouts.
- Run `pnpm check` and `pnpm pack --dry-run`, then manually verify `/usage` and `/usage:refresh` in Pi.

## Assumptions

- `pi-status` and all statusline configuration are out of scope.
- No backward compatibility is required for `/usage --refresh`.
- Existing untracked `plans/` screenshots remain untouched.
- OpenRouter endpoint behavior follows the official [credits](https://openrouter.ai/docs/api-reference/get-credits) and [current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key) documentation.
