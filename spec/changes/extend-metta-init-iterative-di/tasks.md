# Tasks — extend-metta-init-iterative-di

Three files change. Tasks 1.1 and 1.2 target different files and are parallel-safe.
Task 2.1 is also parallel-safe with 1.x (different file). Batch 3 is the gate and
runs after all edits are merged.

---

## Batch 1 — Edit SKILL.md and metta-discovery.md (parallel)

### Task 1.1 — Add DISCOVERY LOOP to metta-init SKILL.md [x]

**Files:** `src/templates/skills/metta-init/SKILL.md`

**Action:**
Replace the existing single-pass discovery steps (current steps 2–3, the spawn
block) with the 5-step structure defined in design.md § File 1. Specifically:

1. Keep step 1 (`metta init --json` + parse `discovery` object) unchanged.
2. Insert step 2 — **DISCOVERY LOOP** preamble with exit-option declaration, exit
   criterion, and between-round status-line format.
3. Add three round sections as `## Round N — <Title>` headings (ADR-1 — not bold
   list items) immediately inside the loop block:
   - `## Round 1 — Project Identity` — 4 AskUserQuestion calls, NO WebSearch,
     includes early-exit phrase (`I'm done \u2014 proceed with these answers`) as
     the final selectable option in every call.
   - `## Round 2 — Stack and Technology` — WebSearch fires once before any
     AskUserQuestion; brownfield and greenfield paths; 4 AskUserQuestion calls max;
     early-exit phrase in every call.
   - `## Round 3 — Conventions and Constraints` — WebSearch fires once before any
     AskUserQuestion; 4 AskUserQuestion calls max; early-exit phrase in every call.
4. Insert step 3 — **Build `<DISCOVERY_ANSWERS>`** XML block (6 child elements in
   fixed order: `<project>`, `<stack>`, `<conventions>`, `<architectural_constraints>`,
   `<quality_standards>`, `<off_limits>`). Include partial/early-exit example.
   Append `<CITATIONS>` when WebSearch was used. Do NOT write to disk (REQ-23).
5. Rewrite the existing spawn step as step 4 — **Spawn metta-discovery** with the
   `<DISCOVERY_ANSWERS>` block embedded inline and the "Do NOT re-ask" instruction.
6. Keep step 5 (`metta refresh` + commit) unchanged.

The exact question text, option lists, between-round prose, and XML schema are
specified verbatim in design.md lines 63–185. Use `\u2014` (Unicode em-dash) for
the early-exit phrase — not an ASCII hyphen.

**Verify:**
- File contains exactly 3 lines matching `/^## Round \d/im`.
- The string `I'm done \u2014 proceed with these answers` appears at least 3 times.
- `WebSearch` does not appear between the `## Round 1` heading and the `## Round 2`
  heading.
- `WebSearch` appears in both the Round 2 and Round 3 sections.
- No round section contains more than 4 occurrences of `AskUserQuestion`.

**Done:** `src/templates/skills/metta-init/SKILL.md` passes all five manual checks
above. Tests in Task 2.1 will enforce these programmatically.

---

### Task 1.2 — Grant WebSearch+WebFetch and add grounding sections to metta-discovery.md [x]

**Files:** `src/templates/agents/metta-discovery.md`

**Action:**
1. In the YAML front-matter, change the `tools` array from
   `[Read, Write, Bash, Grep, Glob]`
   to
   `[Read, Write, Bash, Grep, Glob, WebSearch, WebFetch]`.
2. After the existing `## Rules` block, insert a new `## Grounding Rules` section
   with the 4 bullet rules from design.md lines 210–223 (untrusted input framing,
   inline citation format, authoritative-source preference, WebSearch restricted to
   gap-filling empty fields — not during `## Project` writing).
3. After `## Grounding Rules`, insert a new `## Cumulative Answer Handling` section
   with the 4 numbered rules from design.md lines 229–243 (non-empty fields verbatim,
   empty fields filled from detection then web, gap-fill cap ≤ 2 AskUserQuestion,
   total question cap unchanged at 10).
4. All existing content (brownfield scan-first, greenfield open-ended, config.yaml
   nested schema, git commit on completion) is retained verbatim.

**Verify:**
- Front-matter `tools` line contains `WebSearch` and `WebFetch`.
- File contains a `## Grounding Rules` heading.
- File contains a `## Cumulative Answer Handling` heading.
- Existing `## Rules` block is present and unchanged.

**Done:** `src/templates/agents/metta-discovery.md` has both new sections and the
updated tools array. No other lines are modified.

---

## Batch 2 — Add structural test file

### Task 2.1 — Create tests/skill-structure-metta-init.test.ts

**Files:** `tests/skill-structure-metta-init.test.ts` (new file)

**Action:**
Create the file at the path above (NOT under `src/templates/…/__tests__/` — that
path is outside vitest's `tests/**/*.test.ts` discovery glob; see design.md ADR and
research.md risk section). Copy the test source verbatim from design.md lines
259–318. The file must:

- Import `{ describe, it, expect }` from `vitest` and `readFile`/`join` from Node builtins.
- Define `SKILL_PATH` pointing to `src/templates/skills/metta-init/SKILL.md` via
  `import.meta.dirname` + relative segments.
- Define `EXIT_PHRASE` using the `\u2014` Unicode literal (em-dash), not an ASCII hyphen.
- Use `full.split(/(?=^## Round \d)/im)` to isolate per-round text (requires the
  `## Round N` heading format from Task 1.1 — ADR-1).
- Contain exactly 5 `it` blocks: REQ-35, REQ-36, REQ-37, REQ-38, REQ-39.
- Export nothing. Require zero changes to `vitest.config.ts`.

**Verify:**
Run `npx vitest run tests/skill-structure-metta-init.test.ts` — all 5 tests pass.

**Done:** Test file exists at the correct path and all 5 assertions pass against the
SKILL.md produced by Task 1.1.

---

## Batch 3 — Verification gates

### Task 3.1 — Build, typecheck, lint, and full test suite

**Files:** none (read-only gate)

**Action:**
Run the full project quality gate sequence:

```
npm run build
npm run typecheck
npm run lint
npx vitest run
```

Resolve any failures before marking done. Common failure modes:
- Em-dash character mismatch between SKILL.md and test EXIT_PHRASE.
- Round headings formatted as bold list items instead of `## Round N` (breaks the
  split regex in the test).
- TypeScript errors in the new test file (missing `.js` extensions are not required
  for test imports; verify against the existing `tests/skill-discovery-loop.test.ts`
  pattern).

**Verify:**
- `npm run build` exits 0.
- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npx vitest run` exits 0 with all tests passing (including the 5 new assertions).

**Done:** All four commands exit 0 with no warnings treated as errors.
