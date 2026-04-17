# Review: claude-md-workflow-section-man

## Verdict: PASS_WITH_WARNINGS → resolved in refactor

Initial 3-reviewer pass on commit `28269eea1`:

- **Correctness:** PASS_WITH_WARNINGS — all three template sources updated, mandate stated in bold, three entry-point skills listed, CLI reference tables preserved. INFO: abbreviated blocks lacked humans-at-terminal scope caveat.
- **Quality:** PASS_WITH_WARNINGS — test coverage tightened (not weakened), no dead imports, template-literal escapes correct. WARNING: workflow primer duplicated across three sites, drift risk.
- **Verifier:** PASS — `npx tsc --noEmit` clean, 526/526 tests pass.

## Fixes applied in `13979a202`

1. **Duplication eliminated.** Extracted `src/delivery/workflow-primer.ts` with two exported functions `workflowPrimerShort()` and `workflowPrimerLong()` sharing a `MANDATE` constant and `ENTRY_POINTS_BULLETS` array. All three consumers (`refresh.ts`, `discovery-helpers.ts`, `claude-code-adapter.ts`) now call the helpers.
2. **Scope caveat** "(Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)" baked into the shared `MANDATE` so it appears in both short and long variants.
3. **Barrel export** added in `src/index.ts`.

Re-verification after refactor: `npx tsc --noEmit` clean, 526/526 tests pass.
