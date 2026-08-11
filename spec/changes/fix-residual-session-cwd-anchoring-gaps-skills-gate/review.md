# Review: fix-residual-session-cwd-anchoring-gaps-skills-gate

Reviewed commit fc656e7da (diff main...HEAD). Subagent spawn limit was exhausted this session, so the three review lenses were executed by the skill-host orchestrator itself, sequentially, against the full diff. Noted per the orphaning/observability discipline: no reviewer subagents were dispatched.

## Correctness reviewer — PASS

- All flagged spots from the issue are anchored: propose verifier prompts/scope list, ship + propose push steps, gate commands, review/verify mkdir + test -s preconditions, Output path / Forbidden clauses.
- Sweep coverage verified by re-grep: no remaining unanchored `Run/runs` gate commands, `Read spec.md`, `mkdir -p`/`test -s spec/changes/`, backticked bare `spec/changes/<change>` paths, or bare change-branch pushes in change-scoped skills.
- metta-ship and metta-verify previously never defined `{change_root}`; both now carry a resolution preamble (`metta status --json` → `worktree`, null → main checkout root), so the placeholder is well-defined in every file that uses it.
- Regression test logic checked against both trees: line-level scan, `{change_root}` presence short-circuits rules; prose lines in metta-quick (`Tests (`npm test -- --run`) ... run on every change`) and elliptical anti-example blocks do not match any rule shape (confirmed by the passing run — 0 violations, 2/2 tests).
- Nit (non-blocking): verifier prompt strings nest double quotes (`"Run `cd "{change_root}" && npm test` ..."`). The backticks delimit the command unambiguously and the same convention already exists elsewhere in the templates.

## Security reviewer — PASS

- Instruction-template and test changes only; no runtime code paths touched.
- Quoting `"{change_root}"` in shell commands hardens against word-splitting on paths with spaces — strictly an improvement.
- No secrets, no new command execution surface, no injection vectors introduced. The `<INTENT>` prompt-injection wrapper guidance is untouched.

## Quality reviewer — PASS

- Both template trees byte-identical (diff -rq clean; existing template-deploy-sync test passed in the full suite).
- New test is data-driven, documents each rule and the session-rooted allowlist (metta-release, metta-import, metta-init, metta-refresh), and emits file:line diagnostics on failure.
- Consistent anchoring idiom across all seven skills (`cd "{change_root}" && ...` for gates, `git -C "{change_root}"` for git, absolute `{change_root}/spec/changes/<change>/...` for artifact paths).

## Verdict

3/3 PASS. No critical issues. Review-fix loop exits after iteration 1.
