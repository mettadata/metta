# Tasks: iterative-discovery-metta-prop

## Batch 1 — Skill file rewrites (parallel, no shared files)

### Task 1.1 — Rewrite metta-propose SKILL.md: DISCOVERY GATE → DISCOVERY LOOP

**Files:**
- `src/templates/skills/metta-propose/SKILL.md` (write)
- `.claude/skills/metta-propose/SKILL.md` (write — byte-identical copy)

**Action:**
Replace step 2 "DISCOVERY GATE" block in `src/templates/skills/metta-propose/SKILL.md` with a DISCOVERY LOOP block following the labeled-block idiom used by the existing REVIEW-FIX LOOP in step 5. Keep all content outside step 2 exactly as-is (no whitespace, wording, or structural changes to steps 1 or 3–8).

The replacement step 2 MUST contain all of the following, in order:

1. Header label: `**DISCOVERY LOOP (mandatory — do NOT skip this step):**`
2. Opening instruction preserving the "YOU (the orchestrator, not a subagent)" identity and the codebase-scan prerequisite (read relevant files before asking).
3. Exit-option declaration: every `AskUserQuestion` call within the loop MUST include a final selectable option `I'm done — proceed with these answers`.
4. Round definitions as lettered or labeled sub-bullets:
   - **Round 1 (scope + architecture):** ALWAYS runs — no zero-question path in `/metta:propose`. Ask 2–4 questions.
   - **Round 2 (data model + integration points):** Conditional — run when the change involves file schemas, API contracts, external system calls, or store methods. Skip otherwise.
   - **Round 3 (edge cases + non-functional):** Conditional — run when the change touches runtime code paths. Skip for docs-only or skill-only changes.
   - **Round 4+ (open-ended):** Run while the AI honestly finds remaining ambiguity; stop when none remains.
5. Between-round status line template (verbatim in the skill body):
   `Resolved: <A>, <B>. Open: <C> — proceeding to Round N.`
   When no further rounds: `Resolved: all questions. Proceeding to proposer subagent.`
6. Exit criterion (REQ-4): a statement inside the step body that the loop exits when (a) you honestly find no further ambiguity or (b) the user selects an early-exit option.
7. Cumulative context instruction: pass the full set of all question-answer pairs from all completed rounds to the proposer subagent; answers from later rounds supplement, not replace, earlier answers.

After writing `src/templates/skills/metta-propose/SKILL.md`, copy it byte-identically to `.claude/skills/metta-propose/SKILL.md`.

Verify byte identity with: `diff src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md`

**Verify:**
- `diff src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md` produces no output.
- The string `DISCOVERY LOOP` appears in the file; the string `DISCOVERY GATE` does not.
- The string `I'm done — proceed with these answers` appears in the file.
- `Round 1`, `Round 2`, `Round 3` each appear in the file.
- The file contains text referencing both "no further ambiguity" and an early-exit option within the discovery step block.
- The between-round status line template is present.
- Steps 1 and 3–8 are unchanged from the original file.

**Done:** Both files written, diff clean, all verify checks pass.

---

### Task 1.2 — Rewrite metta-quick SKILL.md: LIGHT DISCOVERY → gated DISCOVERY LOOP

**Files:**
- `src/templates/skills/metta-quick/SKILL.md` (write)
- `.claude/skills/metta-quick/SKILL.md` (write — byte-identical copy)

**Action:**
Replace step 2 "LIGHT DISCOVERY" block in `src/templates/skills/metta-quick/SKILL.md` with a gated DISCOVERY LOOP. Keep all content outside step 2 exactly as-is (steps 1 and 3–12 unchanged, including the Critical and Subagent Rules sections).

The replacement step 2 MUST contain all of the following, in order:

1. Header label: `**LIGHT DISCOVERY (mandatory — do NOT skip):**`  (keep existing label for CLI Critical section cross-reference compatibility)
2. Trivial-detection gate as the first action: YOU (the orchestrator) evaluate whether the change carries meaningful ambiguity BEFORE asking any questions. Three canonical calibration examples MUST appear:
   - Trivial: single-line fix, typo correction, one-file delete — zero questions, proceed directly to spawning the proposer subagent.
   - Functional criterion: "the description leaves no approach, scope, or integration decisions unresolved" → trivial.
   - Non-trivial: multi-file change, existing contract touched, scope or approach unclear → enter the DISCOVERY LOOP below.
3. DISCOVERY LOOP sub-block (entered only when non-trivial), structurally identical to the metta-propose version:
   - Exit-option declaration: every `AskUserQuestion` call includes a final selectable option `I'm done — proceed with these answers`.
   - Round 1 (scope + architecture): always runs when the loop is entered.
   - Round 2 (data model + integration points): conditional — same trigger categories as metta-propose.
   - Round 3 (edge cases + non-functional): conditional — runtime code path trigger, skip for docs/skill-only.
   - Round 4+ (open-ended): repeat while AI honestly finds remaining ambiguity.
   - Between-round status line template (same verbatim format as metta-propose).
   - Exit criterion (REQ-4): loop exits when (a) you honestly find no further ambiguity or (b) the user selects an early-exit option. This statement MUST appear inside the step body.
4. Cumulative context instruction: pass all question-answer pairs from all completed rounds to the proposer subagent.

After writing `src/templates/skills/metta-quick/SKILL.md`, copy it byte-identically to `.claude/skills/metta-quick/SKILL.md`.

**Verify:**
- `diff src/templates/skills/metta-quick/SKILL.md .claude/skills/metta-quick/SKILL.md` produces no output.
- File contains text describing the trivial-detection gate (e.g., "trivially scoped" or "zero questions").
- File contains `DISCOVERY LOOP` (confirming the loop sub-block is present).
- File contains `I'm done — proceed with these answers`.
- File contains the exit criterion referencing both "no further ambiguity" and an early-exit option.
- Steps 1 and 3–12, plus Critical and Subagent Rules sections, are unchanged from the original file.

**Done:** Both files written, diff clean, all verify checks pass.

---

## Batch 2 — Static test file (depends on Batch 1)

### Task 2.1 — Add skill-discovery-loop.test.ts with 11 assertions

**Files:**
- `tests/skill-discovery-loop.test.ts` (create new)

**Dependencies:** Task 1.1 and Task 1.2 must be complete (test reads the actual skill files).

**Action:**
Create `tests/skill-discovery-loop.test.ts` as a standalone Vitest test file. Follow the same file structure used by `tests/discovery-gate.test.ts` (import from vitest, describe/it/expect blocks, no mocking). All 11 assertions are read-only file content checks; no fixtures, no mocks.

The file MUST implement exactly these 11 assertions, grouped as shown:

```
describe('metta-propose SKILL.md — discovery loop', () => {
  // check 1: DISCOVERY LOOP header present, DISCOVERY GATE absent
  // check 2: canonical exit-option phrase present
  // check 3: Round 1 marker present
  // check 4: Round 2 marker present
  // check 5: Round 3 marker present
  // check 6: exit criterion — file contains both "no further ambiguity" and "early-exit" (or equivalent)
})

describe('metta-quick SKILL.md — gated discovery loop', () => {
  // check 7: trivial-detection gate present ("trivially scoped" or "zero questions")
  //          AND DISCOVERY LOOP sub-block present
  // check 8: canonical exit-option phrase present
  // check 9: exit criterion present (same match as check 6)
})

describe('byte-identity — REQ-3', () => {
  // check 10: src/templates/skills/metta-propose/SKILL.md content ===
  //           .claude/skills/metta-propose/SKILL.md content
  // check 11: src/templates/skills/metta-quick/SKILL.md content ===
  //           .claude/skills/metta-quick/SKILL.md content
})
```

Use `fs.readFileSync` with `utf-8` encoding and `path.resolve` from the repo root (use `process.cwd()` or `import.meta.url` + `path.dirname` to locate repo root). Do NOT hard-code absolute paths.

**Verify:**
- `npx vitest run tests/skill-discovery-loop.test.ts` exits 0.
- Output shows 11 tests passing across 3 describe blocks.
- No TypeScript errors: `npx tsc --noEmit` clean.

**Done:** File created, all 11 tests pass, no type errors.

---

## Batch 3 — Full suite gate (depends on Batch 1 and Batch 2)

### Task 3.1 — Build and full test suite verification

**Files:** None modified — read-only gate task.

**Dependencies:** Tasks 1.1, 1.2, 2.1 must be complete.

**Action:**
Run the following in sequence:

1. `npm run build` — confirm template files are copied to `dist/` and TypeScript compiles without errors.
2. `npx vitest run` — run the full test suite.

Report:
- Total test count (MUST be >= 372 including the 11 new assertions from Task 2.1).
- Any failures (there MUST be zero).
- Confirm `tests/skill-discovery-loop.test.ts` appears in the run output with 11 passing tests.
- Confirm no other skill test files regressed.

**Verify:**
- `npm run build` exits 0.
- `npx vitest run` exits 0.
- Test count >= 372.
- Zero failures.
- `tests/skill-discovery-loop.test.ts` listed: 11 passed.

**Done:** Build and full suite green, 11 new tests counted, zero regressions.

---

## Scenario Coverage

| Scenario | Req | Description | Covered by |
|----------|-----|-------------|------------|
| 1a | REQ-1 | Simple change: Round 1 only, AI exits | Task 1.1 (loop structure with conditional rounds) |
| 1b | REQ-1 | Complex change: all four rounds run | Task 1.1 (Round 1–4+ definitions) |
| 1c | REQ-1 | User early-exits at Round 2 | Task 1.1 (exit-option on every AskUserQuestion) |
| 1d | REQ-1 | AI declares done at Round 3, no Round 4 | Task 1.1 (Round 4+ conditional on genuine ambiguity) |
| 2a | REQ-2 | Typo fix: zero questions | Task 1.2 (trivial-detection gate → skip loop) |
| 2b | REQ-2 | Multi-file refactor: loop engages | Task 1.2 (non-trivial path → DISCOVERY LOOP) |
| 2c | REQ-2 | User early-exits from quick-mode loop | Task 1.2 (exit-option on every AskUserQuestion in loop) |
| 3a | REQ-3 | metta-propose template matches deployed copy | Tasks 1.1 + 2.1 check 10 |
| 3b | REQ-3 | metta-quick template matches deployed copy | Tasks 1.2 + 2.1 check 11 |
| 4a | REQ-4 | Exit criterion present in metta-propose | Tasks 1.1 + 2.1 check 6 |
| 4b | REQ-4 | Exit criterion present in metta-quick | Tasks 1.2 + 2.1 check 9 |
