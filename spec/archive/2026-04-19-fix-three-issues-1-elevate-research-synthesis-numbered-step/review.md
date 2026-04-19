# Review: fix-three-issues-1-elevate-research-synthesis-numbered-step

3 reviewers (correctness, security, quality) + 3 verifiers (npm test, typecheck/lint, fix-to-evidence) ran in parallel.

## Verdict: PASS_WITH_WARNINGS — no FAIL, no critical issues

All gates green:
- `npm test` → 745/745 pass (608s)
- `tsc --noEmit` clean
- `npm run lint` clean
- Fix-to-evidence trace: all 3 fixes confirmed in code

## Correctness Review (PASS_WITH_WARNINGS)

- **Minor — `.claude/statusline/statusline.mjs` not synced.** Deployed copy still emits the legacy `[metta: <artifact>]` format until `metta install` (or `npm run i`) runs. **Resolved by**: `npm run i` is already queued in the orchestrator's todo list.
- **Minor — `parsed.workflow` interpolated verbatim.** Out of scope; CLI-bounded enum values today.
- **Minor — Happy-path test bypasses gate ordering.** Intentional and acceptable (relies on wildcard `generates` skip).

## Security Review (PASS_WITH_WARNINGS)

- **Medium — ANSI/control-sequence injection via `workflow`** (`src/templates/statusline/statusline.mjs:67-68`). `workflow` is `z.string()` in the schema, no charset constraint. A malicious branch checked out while the statusline polls could embed `\x1b[…` sequences. Same weakness exists for the pre-existing `slug` interpolation. **Action**: tracking as a follow-up issue; sanitization (e.g. `replace(/[^a-zA-Z0-9_-]/g, '')`) should be added to both `workflow` and `slug` in a future hardening pass.
- **Low — Prompt-injection guidance gap in synthesis step.** Skill templates instruct the orchestrator to read `research-<slug>.md` files but don't suggest `<RESEARCH>...</RESEARCH>` wrapping (cf. existing `<INTENT>...</INTENT>` convention for stories). Researchers may quote external docs containing adversarial directives. **Action**: tracking as a follow-up.

## Quality Review (PASS_WITH_WARNINGS)

- **Minor — Over-commented try/catch** in `src/cli/commands/complete.ts:439-444, 458-460`. Two narrative comment blocks describing what well-named code says. **Fixed in cleanup commit below.**
- **Minor — Wording drift** between top-level step 4 ("files you just created") and Per-Artifact Loop block (line 227, "files the researchers created") in `metta-propose/SKILL.md`. **Fixed in cleanup commit below.**
- **Nit — Loose test assertion** `tests/statusline-format.test.ts:103-104`. Acceptable for now.
- **Nit — `runCli` boilerplate duplication** with other test files. Pre-existing pattern; out of scope.
- **Nit — Module-level `TASKS_MD` comment**. Acceptable.

## Cleanup commit landed

Trimmed the duplicate try/catch comments in `complete.ts` and aligned the synthesis wording across both blocks of `metta-propose/SKILL.md` (and its `.claude/` mirror).

## Follow-up issues to log

1. **`workflow`/`slug` ANSI injection in statusline** — sanitize before rendering.
2. **Synthesis step prompt-injection wrapping** — add `<RESEARCH>` tag guidance to all 4 fan-out skills (parallels existing intent-wrapping convention).

These are deferred to keep this change scoped to the 3 originally-reported issues.
