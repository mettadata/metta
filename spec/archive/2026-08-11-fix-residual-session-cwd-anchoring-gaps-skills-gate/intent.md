# fix-residual-session-cwd-anchoring-gaps-skills-gate

## Problem

PR #60 (`fix-remaining-skills-still-direct-subagents-session-cwd`, 66a4cddcb) anchored artifact writes and git add/commit paths in the skill templates to `{change_root}` — the root of the checkout hosting a change, which for worktree-hosted changes is *not* the session cwd. The pass was mechanical and scoped to enumerated spots, and reviewers have since flagged three residual gaps where skill instructions still resolve against the session cwd:

1. **Unanchored verifier read** — the metta-propose verification fan-out tells Agent 3 to "Read spec.md, check each Given/When/Then scenario has a passing test" with no `{change_root}` prefix (`.claude/skills/metta-propose/SKILL.md:269`, mirrored in `src/templates/skills/metta-propose/SKILL.md`).
2. **Unanchored branch push** — metta-ship step 4 and metta-propose step 8b run a bare `git push -u origin metta/<change-name>` without `git -C "{change_root}"` (`.claude/skills/metta-ship/SKILL.md:16`, `.claude/skills/metta-propose/SKILL.md`, both mirrored in `src/templates/skills/`).
3. **Unanchored gate commands and verify paths** — the verifier scope list and literal agent prompts assign `npm test`, `npx tsc --noEmit`, and `npm run lint` with no working-directory anchoring, and the surrounding `mkdir -p spec/changes/<change>/verify` / `test -s spec/changes/<change>/verify/<aspect>.md` preconditions are session-cwd-relative (`.claude/skills/metta-propose/SKILL.md:227`, `:256`, `:261`, `:267-268`, mirrored in `src/templates/skills/`).

Who is affected: any AI orchestrator session whose cwd is the main checkout while the active change lives in a `.metta/worktrees/` worktree. Such a session can read the wrong `spec.md`, run gates against main instead of the change branch, or push from the wrong checkout — producing **false verification results** and mis-shipped branches. Both the installed skills (`.claude/skills/`) and the shipped templates (`src/templates/skills/`) carry identical copies of the gaps, so every downstream metta install inherits them.

## Proposal

Adopt candidate solution 3 from the issue: an inline anchoring pass over both template trees, plus a regression test so the gap class cannot silently return.

1. **Anchor the flagged spots in both trees** (`.claude/skills/` and `src/templates/skills/`, kept byte-identical):
   - Verifier reads: prefix with `{change_root}/spec/changes/<change>/` (e.g. "Read `{change_root}/spec/changes/<change>/spec.md`, ...").
   - Push steps: `git -C "{change_root}" push -u origin metta/<change-name>`.
   - Gate commands: anchor to the change root (e.g. `cd "{change_root}" && npm test`, `cd "{change_root}" && npx tsc --noEmit`, `cd "{change_root}" && npm run lint`) in both the scope list and the literal agent prompt strings.
   - Verify-directory paths: `mkdir -p "{change_root}/spec/changes/<change>/verify"`, `test -s "{change_root}/spec/changes/<change>/verify/<aspect>.md"`, and the per-verifier output-path instruction.
2. **Sweep for identical residuals** — grep both skill template trees for the same unanchored patterns (bare `git push`, bare `npm test` / `npx tsc` / `npm run lint` in agent-prompt or command position, unanchored `spec/changes/<change>/` paths in executable steps) and fix any additional instances found in other skills (e.g. metta-auto, metta-fix-issues, metta-verify) so the fix covers the pattern class, not just the three flagged lines.
3. **Regression test** — add a Vitest test that scans both template trees for the unanchored patterns above and fails if any reappear. Heuristics target executable instruction lines (numbered steps, backticked commands, agent prompt strings); prose mentions and intentionally-unanchored examples are excluded via narrow patterns or an explicit allowlist.

## Impact

- Skill instruction templates change in both `.claude/skills/` and `src/templates/skills/` — behavior change is limited to *where* commands run and *which* files are read for worktree-hosted changes; main-checkout-hosted changes (where `{change_root}` is the main root) see no behavioral difference.
- One new test file under `tests/` (template-tree lint), extending the existing gate surface (`npm test`).
- No TypeScript runtime/CLI code paths change; `dist/` picks up the template edits through the existing build-time copy step.
- Risk: over-eager regression-lint patterns could false-positive on legitimate prose in future skill edits — mitigated by scoping patterns to executable-line shapes and keeping an allowlist.

## Out of Scope

- No changes to CLI/runtime TypeScript behavior (worktree resolution, guard hook, instruction payloads) — this is a template + test change only.
- No re-architecture of the `{change_root}` anchoring convention itself (e.g. templating engine for skill files, automatic substitution).
- No changes to GSD skills or any non-metta skill trees.
- No retroactive fixing of past changes' verification artifacts.
