# Summary: fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Problem

Two framework-level skill-contract bugs:

1. **CLI typo** (`metta-fix-issues-skill-uses-wrong-cli-command-metta-issue-sh`, major) — `src/templates/skills/metta-fix-issues/SKILL.md:27` called `metta issue show` (singular). Singular `issue` only logs new issues; it rejects subcommands with exit 1. Every `/metta-fix-issues <slug>` invocation hit the error on the validate step.

2. **Skill invariant contradiction** (`metta-product-subagent-lacks-bash-tool-but-metta-fix-issues-`, major) — five skill files (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`) stated `Every subagent MUST ... git commit`, but the `metta-product` agent's tool list was `[Read, Write]` with no `Bash`. The stories-artifact subagent could not commit; orchestrators had to silently fall back.

## Solution

Direct text edits in 7 source files + 6 deployed mirrors. No code changes.

- Fixed CLI typo on line 27 of `metta-fix-issues/SKILL.md`.
- Replaced five variants of the old subagent-commit rule with a single byte-identical paragraph across five skill files:
  > Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
- Cleaned up a duplicate bullet in `metta-fix-gap/SKILL.md` (lines 107-108 both carried the old rule).
- Split a fused obligation in `metta-next/SKILL.md:22` into two clean bullets.
- Added `Bash` to `metta-product`'s agent tool list for defense-in-depth.
- Kept every `.claude/` deployed mirror byte-identical to its source template.
- `metta-propose` is exempt — it had no explicit subagent-commit rule to replace.

## Files touched (13 total)

| Source | Mirror |
|---|---|
| `src/templates/skills/metta-fix-issues/SKILL.md` | `.claude/skills/metta-fix-issues/SKILL.md` |
| `src/templates/skills/metta-fix-gap/SKILL.md` | `.claude/skills/metta-fix-gap/SKILL.md` |
| `src/templates/skills/metta-auto/SKILL.md` | `.claude/skills/metta-auto/SKILL.md` |
| `src/templates/skills/metta-next/SKILL.md` | `.claude/skills/metta-next/SKILL.md` |
| `src/templates/skills/metta-quick/SKILL.md` | `.claude/skills/metta-quick/SKILL.md` |
| `src/templates/agents/metta-product.md` | `.claude/agents/metta-product.md` |
| `src/templates/skills/metta-fix-issues/SKILL.md` (CLI typo on line 27; same file as skill paragraph edit) | same mirror |

## Cross-cutting verification

- `grep -r "Every subagent MUST" src/templates/skills .claude/skills` → zero matches
- `grep -r "metta issue show" src/templates/skills .claude/skills` → zero matches
- `diff -r src/templates/skills .claude/skills` → empty
- `diff -r src/templates/agents .claude/agents` → empty

## Resolves

- `metta-fix-issues-skill-uses-wrong-cli-command-metta-issue-sh`
- `metta-product-subagent-lacks-bash-tool-but-metta-fix-issues-`
