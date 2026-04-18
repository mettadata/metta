# Tasks: fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Batch 1: Independent file edits (all different files — parallel)

### Task 1.1: Fix CLI typo and replace commit rule in metta-fix-issues [x]
- **Files:** `src/templates/skills/metta-fix-issues/SKILL.md`, `.claude/skills/metta-fix-issues/SKILL.md`
- **Action:** (a) Change line 27 from `` `metta issue show <issue-slug> --json` `` to `` `metta issues show <issue-slug> --json` `` (singular → plural). (b) Replace line 107 `- Every subagent MUST write files to disk and git commit — no exceptions` with the replacement paragraph verbatim from `design.md` (a single bullet starting `- Commit ownership: ...`). Mirror both edits to `.claude/skills/metta-fix-issues/SKILL.md`. After editing, run `diff src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md` — must be empty.
- **Verify:** `grep 'metta issue show' src/templates/skills/metta-fix-issues/SKILL.md` returns 0; `grep 'metta issues show' src/templates/skills/metta-fix-issues/SKILL.md` returns 1; `grep 'Every subagent MUST' src/templates/skills/metta-fix-issues/SKILL.md` returns 0; `grep 'Commit ownership' src/templates/skills/metta-fix-issues/SKILL.md` returns 1; diff is empty.
- **Done:** Both files updated; all grep assertions pass; source and mirror byte-identical.

### Task 1.2: Dedup and replace commit rule in metta-fix-gap [x]
- **Files:** `src/templates/skills/metta-fix-gap/SKILL.md`, `.claude/skills/metta-fix-gap/SKILL.md`
- **Action:** Replace the two duplicate lines (lines 107-108) — both currently say `Every subagent MUST write files to disk and git commit` — with a single replacement paragraph verbatim from `design.md`. Mirror to `.claude/skills/metta-fix-gap/SKILL.md`. Confirm no other occurrences of the old rule remain.
- **Verify:** `grep -c 'Every subagent MUST' src/templates/skills/metta-fix-gap/SKILL.md` returns 0; `grep -c 'Commit ownership' src/templates/skills/metta-fix-gap/SKILL.md` returns 1; diff between source and mirror is empty.
- **Done:** Both files updated; duplicate removed; mirror identical.

### Task 1.3: Replace commit rule in metta-auto [x]
- **Files:** `src/templates/skills/metta-auto/SKILL.md`, `.claude/skills/metta-auto/SKILL.md`
- **Action:** Replace line 83 `- Every subagent MUST write files to disk and git commit` with the replacement paragraph verbatim from `design.md`. Mirror to `.claude/skills/metta-auto/SKILL.md`.
- **Verify:** `grep 'Every subagent MUST' src/templates/skills/metta-auto/SKILL.md` returns 0; `grep 'Commit ownership' src/templates/skills/metta-auto/SKILL.md` returns 1; diff empty.
- **Done:** Both files updated; mirror identical.

### Task 1.4: Split fused rule and insert replacement paragraph in metta-next [x]
- **Files:** `src/templates/skills/metta-next/SKILL.md`, `.claude/skills/metta-next/SKILL.md`
- **Action:** Line 22 currently reads `- MUST write files, git commit, and call \`metta complete\` for each artifact`. Split into two bullets: keep `- MUST call \`metta complete\` for each artifact` and ADD the replacement paragraph verbatim from `design.md` as a separate bullet immediately above or below it. Mirror to `.claude/skills/metta-next/SKILL.md`.
- **Verify:** `grep 'MUST write files, git commit' src/templates/skills/metta-next/SKILL.md` returns 0; `grep 'MUST call \`metta complete\`' src/templates/skills/metta-next/SKILL.md` returns ≥1; `grep 'Commit ownership' src/templates/skills/metta-next/SKILL.md` returns 1; diff empty.
- **Done:** Fused rule split cleanly; `metta complete` obligation preserved; new paragraph present; mirror identical.

### Task 1.5: Replace shorthand commit rule in metta-quick
- **Files:** `src/templates/skills/metta-quick/SKILL.md`, `.claude/skills/metta-quick/SKILL.md`
- **Action:** Replace line 91 `- MUST git commit after each step` with the replacement paragraph verbatim from `design.md`. Mirror to `.claude/skills/metta-quick/SKILL.md`.
- **Verify:** `grep 'MUST git commit after each step' src/templates/skills/metta-quick/SKILL.md` returns 0; `grep 'Commit ownership' src/templates/skills/metta-quick/SKILL.md` returns 1; diff empty.
- **Done:** Both files updated; mirror identical.

### Task 1.6: Add Bash to metta-product agent tool list [x]
- **Files:** `src/templates/agents/metta-product.md`, `.claude/agents/metta-product.md`
- **Action:** Change line 4 (frontmatter) from `tools: [Read, Write]` to `tools: [Read, Write, Bash]`. Mirror to `.claude/agents/metta-product.md`.
- **Verify:** `grep 'tools: \[Read, Write, Bash\]' src/templates/agents/metta-product.md` returns 1; diff between source and mirror is empty; `npx vitest run tests/agents-byte-identity.test.ts` passes.
- **Done:** Both files updated; byte-identity test green.

---

## Batch 2: Summary + full gate suite (sequential, depends on Batch 1)

### Task 2.1: Write summary.md and run full gate suite
- **Files:** `spec/changes/fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i/summary.md`
- **Action:** Write `summary.md` covering problem (two issues in one change), solution (direct text edits in 5 skills + 1 agent + CLI typo fix, all mirrors synced), files touched (7 source + 6 mirrors = 13 files), and cross-cutting grep verifications. Then run the full gate suite: `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Verify:** All four gate commands exit 0. Additional cross-cutting greps: (a) `grep -r "Every subagent MUST" src/templates/skills .claude/skills` returns 0 matches, (b) `grep -r "metta issue show" src/templates/skills .claude/skills` returns 0 matches, (c) `diff -r src/templates/skills .claude/skills` produces no output.
- **Done:** summary.md written; TypeScript clean; full test suite green; lint clean; build artifact up-to-date; cross-cutting greps all return 0.
