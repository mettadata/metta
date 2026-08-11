# UAT: fix-residual-session-cwd-anchoring-gaps-skills-gate

- **Change**: fix-residual-session-cwd-anchoring-gaps-skills-gate
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Anchor the flagged spots in both trees (`.claude/skills/` and `src/templates/skills/`, kept byte-identical):
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Sweep for identical residuals — grep both skill template trees for the same unanchored patterns (bare `git push`, bare `npm test` / `npx tsc` / `npm run lint` in agent-prompt or command position, unanchored `spec/changes/<change>/` paths in executable steps) and fix any additional instances found in other skills (e.g. metta-auto, metta-fix-issues, metta-verify) so the fix covers the pattern class, not just the three flagged lines.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Regression test — add a Vitest test that scans both template trees for the unanchored patterns above and fails if any reappear. Heuristics target executable instruction lines (numbered steps, backticked commands, agent prompt strings); prose mentions and intentionally-unanchored examples are excluded via narrow patterns or an explicit allowlist.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Anchored every residual session-cwd-relative command and artifact path in the change-scoped skill templates to `{change_root}`, in both template trees (`.claude/skills/` and `src/templates/skills/`, kept byte-identical), and added a regression lint test so the pattern class cannot silently return.

#### Step 2.1
- **Do**: Confirm: metta-propose verifier read — Agent 3 prompt now reads `{change_root}/spec/changes/<change>/spec.md` (was bare `Read spec.md`); the verifier scope list is likewise anchored.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: Push steps — metta-ship step 4 and metta-propose step 8b now run `git -C "{change_root}" push -u origin metta/<change-name>` (were bare `git push`).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: Gate commands — verifier prompts and scope lists now run `cd "{change_root}" && npm test`, `cd "{change_root}" && npx tsc --noEmit`, `cd "{change_root}" && npm run lint`; the review/verify `mkdir -p` and `test -s` preconditions and Output path / Forbidden prompt clauses use `{change_root}/spec/changes/<change>/...`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: metta-propose: research write paths, research synthesis step (now commits with `git -C "{change_root}"`), tasks.md read, review-section mkdir/output/test -s paths, review.md and summary.md merge steps.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: metta-quick: trivial-path verifier prompt, standard-path scope list and Agent 1/2 prompts.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: metta-auto, metta-fix-issues, metta-fix-gap: Agent 1/2 gate prompts.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.7
- **Do**: Confirm: metta-verify: spec read, summary write, and commit line anchored; added a `{change_root}` resolution preamble (via `metta status --json` `worktree` field). metta-ship got the same resolution preamble since it previously never defined `{change_root}`.
- **Observe**: behaves as described
- [ ] Pass
