# Research: fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Decision: direct line-level edits + single byte-identical replacement paragraph

### Approaches Considered

1. **Direct per-file edits with a shared replacement paragraph** (selected) — five of the six skill files have an explicit subagent-commit rule in a `## Rules` or `## Subagent Rules` section. Replace each with a byte-identical paragraph. `metta-propose` has no such rule and is exempt from the replacement; its step-level prose about subagent commits does not carry a normative `MUST`, so no wording change is needed there.

2. **Introduce a shared `src/templates/skills/_common.md` include** (rejected) — the templates engine does not support includes today, and adding one for one paragraph would be overreach.

### Rationale

The old rule is a one-line bullet in each affected skill. A five-line paragraph that unambiguously states orchestrator-vs-executor commit ownership fits cleanly into the existing `## Rules` sections. No structural rewrite, no new infrastructure.

### Scope adjustments from findings

1. **`metta-propose` has no subagent-commit rule to replace.** Updating the spec to require the paragraph in all six would force us to either (a) invent a new `## Rules` section in `metta-propose` just for this, or (b) require a paragraph that doesn't exist to be removed. Neither is worth it. **Exempt `metta-propose` from the paragraph-replacement requirement.** The other five (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`) get the paragraph.

2. **`metta-fix-gap` has a duplicate of the old rule on lines 107 and 108.** Pre-existing bug. Removing the duplicate is a freebie.

3. **`metta-next` line 22 is a fused bullet** — `- MUST write files, git commit, and call \`metta complete\` for each artifact`. Need to split: keep `- MUST call \`metta complete\` for each artifact` as a separate bullet, then add the replacement paragraph.

4. **Byte-identity tests only cover `metta-init` and `metta-product`.** Skills we're editing (`metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick`) do NOT have automated byte-identity tests. So we must manually update `.claude/skills/<name>/SKILL.md` for each edited template, but nothing will fail CI if we miss one. Low risk because the 7 mirrors all start byte-identical today (verified via `diff`).

### Per-file edit locations (verified)

| File | Line(s) | Current text |
|---|---|---|
| `src/templates/skills/metta-fix-issues/SKILL.md` | 27 | `metta issue show` → fix to `metta issues show` |
| `src/templates/skills/metta-fix-issues/SKILL.md` | 107 | `- Every subagent MUST write files to disk and git commit — no exceptions` → replace with paragraph |
| `src/templates/skills/metta-fix-gap/SKILL.md` | 107-108 | two duplicate old rules → replace both with single paragraph |
| `src/templates/skills/metta-auto/SKILL.md` | 83 | `- Every subagent MUST write files to disk and git commit` → replace with paragraph |
| `src/templates/skills/metta-next/SKILL.md` | 22 | `- MUST write files, git commit, and call \`metta complete\` for each artifact` → split + replace |
| `src/templates/skills/metta-quick/SKILL.md` | 91 | `- MUST git commit after each step` → replace with paragraph |
| `src/templates/agents/metta-product.md` | 4 | `tools: [Read, Write]` → `tools: [Read, Write, Bash]` |

### Replacement paragraph (verbatim, identical across all five files)

```
- Commit ownership: the orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation. Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git.
```

### Deployed mirrors

All seven affected mirrors are byte-identical to their sources today (verified via `diff -r src/templates/ .claude/`). Each source edit must be mirrored:

- `.claude/skills/metta-fix-issues/SKILL.md`
- `.claude/skills/metta-fix-gap/SKILL.md`
- `.claude/skills/metta-auto/SKILL.md`
- `.claude/skills/metta-next/SKILL.md`
- `.claude/skills/metta-quick/SKILL.md`
- `.claude/agents/metta-product.md`

Enforcing tests: `tests/agents-byte-identity.test.ts` (covers `metta-product` only), `tests/skill-structure-metta-init.test.ts` (covers `metta-init` only). These will pass as long as `metta-product` mirror is updated.

### Artifacts Produced

None — decision is direct text edits.

### Risks carried forward

- Spec.md's requirement 2 should be relaxed from "all six skill files" to "five skill files (metta-propose exempt)". I'll amend the spec before tasks.
- No automated byte-identity coverage for five of the six skill mirrors. Not a regression — it wasn't covered before either. Out of scope to add tests for this.
