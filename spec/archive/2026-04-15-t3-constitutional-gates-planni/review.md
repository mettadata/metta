# Review: t3-constitutional-gates-planni

Three reviewers + three verifiers ran in parallel. (Initial draft from correctness reviewer was overwritten with this consolidated synthesis.)

## Correctness — PASS_WITH_WARNINGS → applied
- All severity handling, exit codes, byte-identity, plan-skill integration confirmed via cited line numbers.
- Warning: `getSpecVersion` used `git rev-parse HEAD:<path>` (committed blob) not working-tree content. **Applied:** switched to `git hash-object <abs-path>` so version reflects what was actually evaluated.
- Warning: `justified: true` on minor violations is conceptually wrong but harmless. Deferred (cosmetic).

## Security — NEEDS_CHANGES → applied
**Critical:** `--change` slug was unsanitized → path traversal via `../../etc` would let `checker.ts` read/write arbitrary files. **Applied:** added `assertSafeSlug(changeName, 'change name')` in the CLI handler immediately after slug resolution. Re-uses the shared `src/util/slug.ts` shipped earlier this session.

Other security checks PASS (`execFile` argv form, no shell, prompt-injection defended via XML delimiters + Zod-validated structured output, API key via env only).

## Quality — PASS_WITH_WARNINGS → applied
- Warning 1: blocking predicate `critical || (major && !justified)` duplicated 3 times (checker.ts, renderViolationLine, console output). **Applied:** extracted `isBlockingViolation()` from `checker.ts`; CLI imports it. Single source of truth.
- Warning 2: `escapeBackticks` corrupted verbatim evidence by replacing `` ` `` with `'`. **Applied:** switched evidence rendering to double-quoted string with escaped inner quotes; preserves the verbatim contract the agent prompt promises.
- Deferred: type cast in `provider.generateObject<T>` (cosmetic).
- Deferred: minor `justified:true` semantic asymmetry.
- Deferred: dedicated test for malformed-JSON Zod rejection (provider tests cover throw path).

## Tests — PASS (415/415)
## Typecheck + Lint — PASS
## Scenario coverage — PASS 15/15

## Verdict
All reviewers PASS after 3 applied fixes (slug guard, isBlockingViolation extraction, evidence quoting + git hash-object). Targeted re-tests green. Full suite re-running for final confirmation.
