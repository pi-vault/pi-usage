# MiniMax OpenAI Provider Alias Design

## Problem

`pi-usage` selects the live usage snapshot from the active Pi model's provider ID. A trusted custom Pi provider named `minimax-openai` serves `MiniMax-M3`, but `detectProviderFromModel()` recognizes only `minimax`. Because explicit unknown providers intentionally bypass model-name inference, the current provider remains unset and compatible MiniMax usage windows are not published to consumers.

Pi itself does not define `minimax-openai`. Its built-in MiniMax provider is `minimax`, while custom provider IDs may be arbitrary strings. The new mapping is therefore a local, explicit contract for this trusted custom route rather than an upstream Pi alias.

## References

- Pi `dcd461925`: `packages/ai/src/providers/minimax.ts` defines the built-in provider ID as `minimax`; `packages/ai/src/types.ts` permits custom string provider IDs; `packages/coding-agent/docs/models.md` documents custom providers.
- CodexBar `89765dc2b`: `MiniMaxUsageSnapshot.toUsageSnapshot()` owns fetched coding-plan usage under canonical provider identity `.minimax`, independently of the model transport used by another client.
- CodexBar's provider-scoped pricing tests reject fallback across providers. The same isolation rule applies here: a MiniMax-looking model name must not override an unrelated explicit provider ID.

## Considered Approaches

### Exact detector alias

Map normalized `minimax-openai` to the existing `minimax` usage provider at the detection boundary. This is the smallest change and preserves downstream provider identity and provider isolation.

### Alias table or configuration

Move provider aliases into a table or user configuration. This adds indirection and a new configuration contract for one known alias, so it is not justified.

### Rename the external provider

Require the custom Pi configuration to use `minimax`. This avoids a code change but obscures that the model transport uses OpenAI compatibility and changes configuration outside this repository.

## Design

Extend the existing explicit MiniMax condition in `src/shared/provider-detection.ts` so normalized provider IDs `minimax` and `minimax-openai` both return canonical provider ID `minimax`.

Keep the existing early return for every other non-empty provider. In particular, `{ provider: "custom-proxy", id: "MiniMax-M3" }` must remain unrecognized. Model-ID fallback continues to apply only when the provider field is empty.

No provider registry, MiniMax adapter, cache, state projection, event, public type, configuration, or consumer changes are needed. Once detection returns `minimax`, the existing state flow selects the already-fetched MiniMax snapshot and publishes its compatible five-hour and weekly windows.

## Error Handling

The alias introduces no new I/O or failure mode. Missing credentials, unavailable MiniMax usage, stale cache handling, and absent compatible windows retain their current behavior. Unknown explicit providers continue to produce no selected live usage provider instead of being guessed from a model name.

## Testing

Add two assertions to the existing provider-detection test:

1. `minimax-openai` with `MiniMax-M3` resolves to `minimax`.
2. An unrelated explicit provider with `MiniMax-M3` remains unrecognized.

Run the focused provider-registry test first, then `pnpm check` under the repository's required Node.js version. The full check already covers provider parsing, state projection, usage-core behavior, formatting, and type checking, so no additional intermediate suite is required.

## Scope

Only `src/shared/provider-detection.ts` and `tests/provider-registry.test.ts` will change during implementation. Support for other MiniMax aliases, generalized model-name inference, configuration-driven aliases, and consumer changes are out of scope.
