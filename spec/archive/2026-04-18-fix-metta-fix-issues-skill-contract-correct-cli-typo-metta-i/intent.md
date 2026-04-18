# fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Problem

Two major framework inconsistencies surface every time `/metta-fix-issues` runs, forcing orchestrator fallback and manual recovery.

**Issue `metta-fix-issues-skill-uses-wrong-cli-command-metta-issue-sh` (major):** Line 27 of `src/templates/skills/metta-fix-issues/SKILL.md` instructs the orchestrator to run `metta issue show <slug>` (singular). The singular `metta issue` command is a logger — it creates new issues and rejects subcommands with exit 1. The correct form is `metta issues show <slug>` (plural). Every `/metta-fix-issues` invocation hits this typo at the first validate step.

**Issue `metta-product-subagent-lacks-bash-tool-but-metta-fix-issues-` (major):** Five skill files (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`) carry a rule stating "Every subagent MUST write files to disk and git commit — no exceptions." The `metta-propose` skill body contains equivalent commit directives in its subagent prompts. But `metta-product`'s agent frontmatter lists only `[Read, Write]` — no Bash tool. When the orchestrator spawns `metta-product` to write `stories.md` and commit, the agent reports "I don't have a Bash tool available" and the commit rule is silently broken. The prose contract and the agent capability list are out of sync.

## Proposal

**Fix 1 — CLI typo:** Change `metta issue show <issue-slug> --json` to `metta issues show <issue-slug> --json` on line 27 of `src/templates/skills/metta-fix-issues/SKILL.md`. One word, singular to plural.

**Fix 2 — Commit rule realignment:** Replace the "Every subagent MUST write files to disk and git commit" clause in all five skill templates (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`) and the equivalent subagent prompt language in `metta-propose/SKILL.md` with accurate language: "The orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation." Simultaneously, add `Bash` to `metta-product`'s `tools:` frontmatter so the agent's declared capability matches the commit rule it carries in its own body (line 55 of `metta-product.md`). Both the prose and the tool list must converge on the same truth.

**Deployed mirrors:** The `.claude/skills/` directory contains deployed copies of all skill files. A byte-identity test enforces that deployed mirrors match source templates. All edited skill files MUST be kept byte-identical between `src/templates/skills/` and `.claude/skills/`.

## Impact

- `src/templates/skills/metta-fix-issues/SKILL.md` — CLI typo fix (line 27) and commit rule update (line 107)
- `src/templates/skills/metta-fix-gap/SKILL.md` — commit rule update (lines 107–108)
- `src/templates/skills/metta-auto/SKILL.md` — commit rule update (line 83)
- `src/templates/skills/metta-next/SKILL.md` — commit rule update (line 22)
- `src/templates/skills/metta-quick/SKILL.md` — commit rule update (lines 90–91)
- `src/templates/skills/metta-propose/SKILL.md` — commit directive language in subagent prompts
- `src/templates/agents/metta-product.md` — add `Bash` to `tools:` frontmatter
- `.claude/skills/metta-fix-issues`, `.claude/skills/metta-fix-gap`, `.claude/skills/metta-auto`, `.claude/skills/metta-next`, `.claude/skills/metta-quick`, `.claude/skills/metta-propose` — deployed mirrors updated to stay byte-identical with source templates
- Vitest tests covering skill byte-identity will exercise the updated files — no test logic changes expected, just content parity

No changes to `src/cli/`, `src/finalize/`, or any other source module.

## Out of Scope

- Updating tool lists for any agent other than `metta-product`
- Refactoring how CLI commands handle commit logic at runtime
- Auditing CLI typos in non-metta-* skills or agent files
- Changing `metta instructions` behavior or its reporting of subagent tool lists (stale list bug is a separate issue to log)
- Adding Bash to agents that do not already carry commit rules in their own body
