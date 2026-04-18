# Design: fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Approach

Direct line-level edits in seven files: one CLI typo fix, five paragraph replacements in skill templates, one agent frontmatter addition. Mirror each source edit to its deployed copy under `.claude/`. No code changes, no test changes.

## Components

- `src/templates/skills/metta-fix-issues/SKILL.md` — line 27: `metta issue show` → `metta issues show`. Line 107: old rule → replacement paragraph.
- `src/templates/skills/metta-fix-gap/SKILL.md` — lines 107-108: two duplicate old rules → single replacement paragraph.
- `src/templates/skills/metta-auto/SKILL.md` — line 83: old rule → replacement paragraph.
- `src/templates/skills/metta-next/SKILL.md` — line 22: fused bullet split into `- MUST call \`metta complete\` for each artifact` plus the replacement paragraph as a new bullet.
- `src/templates/skills/metta-quick/SKILL.md` — line 91: old shorthand → replacement paragraph.
- `src/templates/agents/metta-product.md` — frontmatter `tools: [Read, Write]` → `tools: [Read, Write, Bash]`.
- Six deployed mirrors under `.claude/` — updated byte-identically after each source edit.

## Data Model

None. All edits are to human-readable markdown/frontmatter.

## API Design

No API surface changes. Only skill template prose and one agent frontmatter key.

## Replacement paragraph (verbatim, identical across five files)

```
- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
```

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Drift between source and deployed mirror | Edit each pair together; `diff -r src/templates .claude` exits clean at end. |
| Missing a copy of the old rule during grep-based removal | Verification grep in summary step: `grep -r "Every subagent MUST" src/templates/skills .claude/skills` must return 0 matches. |
| metta-next fused-bullet split loses the `metta complete` obligation | Explicit split in the tasks action: keep `- MUST call \`metta complete\` for each artifact` as its own bullet. |
| Existing byte-identity tests (`tests/agents-byte-identity.test.ts`, `tests/skill-structure-metta-init.test.ts`) break | Only cover `metta-product` and `metta-init`. Metta-product mirror is part of this change; metta-init is untouched. Tests stay green. |
| Adding `Bash` to `metta-product` breaks `tests/agents-byte-identity.test.ts:24` regex `tools:.*Read.*Write` | Regex is non-anchored; `Read, Write, Bash` still matches. Verified. |
