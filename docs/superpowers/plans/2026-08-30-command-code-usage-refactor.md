# Command Code Usage Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Command Code provider into two focused modules and publish its reliable 5-hour and weekly limits with existing balance data.

**Architecture:** A pure parser converts Command Code JSON payloads into rolling windows, balances, and a plan name. The existing provider entrypoint keeps authentication, endpoint, cache-runtime, and error-classification behavior and delegates payload interpretation to that parser. The phase plans below are authoritative and intentionally avoid duplicating their implementation steps here.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, native Fetch API, Vitest 4, pnpm 11, Biome.

**Spec:** `docs/superpowers/specs/2026-08-30-command-code-usage-refactor-design.md`

## Global Constraints

- Change only `pi-usage`; `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/codexbar` are read-only references.
- Keep Node.js support at `>=24.15.0`.
- Add no dependencies, public exports, shared usage types, environment variables, local estimates, or static plan-price catalog.
- Preserve the existing `COMMAND_CODE_COOKIE_HEADER` configuration, provider cache/backoff behavior, monthly and purchased balances, request/token balances, and partial-success behavior.
- Do not synthesize a monthly usage window from request-history cost and remaining credits.
- Rolling windows expose percentages and reset timing, not currency-valued ratios.

---

### Phase 1: Build the Pure Usage Parser

**Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor-phase-1-usage-parser.md`

**Atomic Result:** A tested `parseCommandCodeUsage()` implementation exists. It emits reliable 5-hour and weekly windows, preserves balances and plan names, and leaves the live adapter unchanged.

- [ ] Execute every Phase 1 checkbox in order.
- [ ] Confirm `pnpm exec vitest run tests/provider-command-code.test.ts` passes.
- [ ] Confirm the Phase 1 commit exists before starting Phase 2.

### Phase 2: Integrate the Parser with the Provider

**Plan:** `docs/superpowers/plans/2026-08-30-command-code-usage-refactor-phase-2-provider-integration.md`

**Prerequisite:** Phase 1 is complete and its focused tests pass.

**Atomic Result:** The existing provider uses the parser, snapshots expose available rolling windows and balances, partial failures retain usable data, and the complete project check passes.

- [ ] Execute every Phase 2 checkbox in order.
- [ ] Confirm `pnpm exec vitest run tests/provider-command-code.test.ts` passes.
- [ ] Confirm `pnpm typecheck` passes.
- [ ] Confirm `pnpm check` passes on Node.js `>=24.15.0`.
- [ ] Confirm `git diff --check` exits 0 and the final diff stays within the planned provider, registry, tests, spec, and plan files.
