# Pi Usage Refactor Phase 7: Phase-Neutral Cleanup and Constants Extraction

## Goal

Remove all phase-development metadata and wording from the runtime, types, and UI while centralizing existing static
values into a shared constants module. Keep `/usage` behavior and layout effectively unchanged.

## Summary

The current codebase still carries implementation-phase scaffolding from the original rollout:

- `phase` fields in snapshot and adapter types
- `phaseByProvider`
- placeholder diagnostics such as `Unavailable in Phase 3`
- future-implementation text such as `will be implemented in Phase X`

This phase removes that scaffolding cleanly and extracts the remaining static values into `src/constants.ts`. It is a
low-risk refactor checkpoint that should not change provider behavior, cache semantics, or the dashboard structure.

## Changes

- Add `src/constants.ts` for shared static values currently embedded in `src/providers.ts` and `src/index.ts`:
  - provider order
  - provider display labels
  - live-provider TTLs
  - lock/backoff timings
  - period labels and ordering
  - existing help/footer strings that remain valid in the current UI
- Remove `phase` from:
  - `ProviderUsageSnapshot`
  - `UsageProviderAdapter`
  - `UnavailableProviderState`
- Delete all phase-related support code and strings:
  - `phaseByProvider`
  - `Unavailable in Phase 3`
  - `will be implemented in Phase X`
  - any phase-oriented placeholder diagnostics in tests
- Replace the OpenAI monthly placeholder reason with a phase-neutral string such as
  `Unavailable from ChatGPT usage API`.
- Keep `src/providers.ts`, `src/opencode-go.ts`, and the current dashboard renderer structurally intact in this phase.

## Usable Checkpoint

- `/usage` still loads and behaves as it does today.
- Live providers keep the same availability, cache, stale, and diagnostic behavior except that no user-visible text
  mentions development phases.
- Existing consumers of emitted events keep working because event names and core payload structure stay unchanged.

## Acceptance Criteria

- No runtime or test output includes `Phase 2`, `Phase 3`, `Phase 4`, `Phase 5`, `Phase 6`, or similar wording.
- OpenAI monthly unavailability remains visible, but the reason is phase-neutral.
- Provider labels, order, TTLs, and fetch behavior do not regress.
- No new provider modules are required yet; this is cleanup plus constants extraction only.

## Test Coverage

- Update type-level and provider tests to compile without `phase`.
- Update dashboard/render expectations to remove phase-based diagnostics.
- Verify provider registry order and display labels are unchanged.
- Verify OpenAI, MiniMax, OpenCode Go, and Command Code snapshots retain current behavior apart from diagnostic text.
- Run `npm run check`.
- Run `git diff --check`.

## Deferred Scope

- Provider module splitting.
- Offline-as-adapter registry normalization.
- OpenCode Go consolidation.
- Offline table token/data-model changes.
- Dashboard redesign.
