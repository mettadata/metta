# Review — fix-instruction-payload-output-path-cwd-relative

Three parallel reviews (iteration #1). Verdicts: Correctness PASS_WITH_WARNINGS, Security PASS_WITH_WARNINGS, Quality PASS_WITH_WARNINGS. No critical issues.

## Major (fix before ship)

1. **Spec drift — living spec contradicts new contract.** `spec/specs/context-engine/spec.md:359` and `:376-384` still mandate `output_path` = `spec/changes/{changeName}/{artifact.generates}`, "relative to the project root"; the new `change_root` field and the `changeRoot` generate param are absent from the section-10 contract tables. The trivial-tier workflow carries no spec.md delta, so nothing merges at ship. Flagged by correctness + quality. **Resolution: edit the living spec directly in this change.**

## Minor

2. Security: unquoted `{change_root}`/`{output_path}` interpolation in skill git commands (`metta-plan` SKILL.md:51, `metta-propose` SKILL.md:~331, both trees) — breaks on paths with spaces. **Resolution: quote in templates (cheap).**
3. Security (pre-existing): `resolveChangeRoot` containment guard is lexical, not realpath-based — symlinked worktree host could escape. Accepted for a local dev tool; not introduced here.
4. Correctness: check-constitution now re-roots the constitution read (`spec/project.md`) to the worktree checkout too — behavior change not documented in intent Impact. **Resolution: note in summary.md; behavior is more correct.**
5. Correctness/Quality: `updateChange({worktree: <discovered-host>})` is indistinguishable from injection round-trip and silently reverted — in-band stale-path repair foreclosed. Deliberate, documented, no current caller affected.
6. Correctness (pre-existing): `resolveChangeRoot` never checks candidate path existence.
7. Quality: no Zod validation of emitted instruction JSON — pre-existing pattern (Zod covers state reads/writes only).
8. Quality: duplicated ENOENT/ENOTDIR fallback in check-constitution.ts vs context.ts (~10 lines, 2nd occurrence — extract at 3rd).
9. Quality: test nits — dynamic fs import in cli-check-constitution-paths.test.ts:132; stale comment in instructions-payload-paths.test.ts:93; runCli helper duplication (matches repo pattern).

## Follow-ups to log as issues (out of this change's scope)

- `metta-uat` SKILL.md:36 — plain `git add`/`git commit` without `-C {change_root}`; identical wrong-checkout failure family.
- `metta-quick`/`metta-auto`/`metta-fix-issues`/`metta-fix-gap`/`metta-execute` SKILL.md — still direct subagents to relative `spec/changes/<change>/` paths with plain git; quick/auto changes are worktree-hosted, so the wrong-tree class persists there.

## Verified by reviewers

Absolute output_path correct for worktree-hosted and local changes; containment guard strengthened by discovered-host precedence; never-persist invariant extended correctly; template mirrors byte-identical; slug validation ordered before all joins/lookups in complete/instructions/check-constitution; no remaining relative-path consumer of the contract; tsc clean; touched suites green.
