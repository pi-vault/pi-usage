# Next Release Docs Design

## Summary

Prepare the next release by refreshing the project’s release-facing documentation around the current shipped codebase.

This work covers three surfaces:
- `README.md`: rewrite it as a usage-first guide
- `CHANGELOG.md`: add or refresh the next release entry based on code changes since `v0.4.0`
- `LICENSE`: verify existing MIT licensing stays correctly surfaced

## Goals

- Make `README.md` reflect current user-facing usage rather than internal implementation details
- Ensure `CHANGELOG.md` clearly explains what changed for the next release
- Keep licensing aligned across `LICENSE`, `package.json`, and README references
- Keep the scope narrow enough to support a single follow-up implementation plan

## Non-goals

- Retroactively rewriting all past changelog entries
- Making feature or behavior changes just to support documentation updates
- Changing the project license
- Performing unrelated repository cleanup

## Current context

Current repo state already includes:
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- package version `0.4.0`

Commits since `v0.4.0` include user-visible changes around provider toggles, richer dashboard insights, offline extraction improvements, and runtime/tooling updates.

## Deliverable 1: README.md

### Intent

Rewrite `README.md` as a practical usage guide for people installing and operating `@pi-vault/pi-usage`.

### Required structure

1. **What it is**
   - brief description of the dashboard and its value
2. **Install**
   - installation command
   - Pi reload step
3. **Commands**
   - `/usage`
   - `/usage:refresh`
   - when to use each
4. **What the dashboard shows**
   - offline usage aggregation
   - live provider status, quota, and balance surfaces
   - currently shipped insights, including project, skill, and MCP breakdowns where applicable
5. **How to use it**
   - period switching
   - provider tab switching
   - row expansion and navigation
   - keyboard shortcuts
6. **Configuration**
   - provider environment variables for live usage cards
   - `usage.json` configuration for provider enable/disable
7. **Changelog pointer**
   - short pointer to `CHANGELOG.md`
8. **License**
   - short pointer to MIT licensing

### README style rules

- Prefer usage-first language over architecture-first language
- Do not describe internal module names, refactors, or test/tooling details unless directly relevant to usage
- Keep examples copy-pasteable
- Only document behavior that exists in the current codebase

### usage.json section requirements

Document the config file at:
- `$PI_CODING_AGENT_DIR/extensions/usage.json`

The README must make the default behavior explicit:
- missing file means all providers remain enabled
- omitted providers remain enabled
- malformed JSON is ignored and falls back to default behavior

The README should include both:
- the effective default example: `{}`
- an explicit full example that lists the current configurable live providers with `enabled: true`: `openai-codex`, `minimax`, `stepfun`, `opencode-go`, `command-code`, and `openrouter`

It should also include at least one focused example showing how to disable a provider such as `minimax`.

## Deliverable 2: CHANGELOG.md

### Intent

Update the next release entry so it reflects code changes after `v0.4.0`, written as release notes rather than a raw commit list.

If the final version has not yet been chosen when editing begins, use an `Unreleased` section first and convert it to the final version heading once the release number is decided.

### Writing policy

- Lead with user-visible changes
- Include internal/runtime changes only when they materially affect compatibility, support expectations, or release risk
- Keep older release entries mostly intact
- Allow light consistency edits to nearby text if needed, but do not perform a full historical rewrite

### Planned content areas

#### User-visible additions
- provider enable/disable config via `usage.json`
- richer dashboard insights, including:
  - project breakdowns
  - active skill breakdowns
  - MCP server breakdowns
  - grouped and capped insight presentation where shipped

#### Behavior fixes and improvements
- improved offline extraction from session data
- more accurate project-name extraction
- MCP server-name extraction from tool prefixes
- builtin tool handling improvements where they affect insight accuracy
- TUI readability fixes such as spacing or grouped rendering improvements

#### Notable internal/runtime changes
- Node engine raised to `>=24.15.0`
- dependency refreshes
- CI/runtime alignment updates

These internal items should appear after user-facing notes and remain brief.

### Versioning guidance

The final version bump should be chosen after drafting the release notes. Based on currently known changes, a minor bump appears more likely than a patch because the release includes new shipped capability.

## Deliverable 3: LICENSE

### Intent

Treat licensing as a verification task, not a legal/content change.

### Requirements

- keep the existing MIT license text
- verify `LICENSE` remains at repository root
- verify `package.json` still declares `"license": "MIT"`
- verify README badge/linking remains aligned with the root license file
- if inconsistencies exist, fix docs or metadata rather than changing the license itself

## Success criteria

This design is complete when the follow-up implementation produces:
- a usage-first `README.md` aligned with current shipped behavior
- a next release changelog entry that accurately summarizes changes since `v0.4.0`
- verified MIT license surfacing across repository files
- enough release-note clarity to choose the next version intentionally
