# Tasks for fix-generated-workflow-primer-contradicts-bash-guard-blanket

## Batch 1 (no dependencies)

- [ ] **Task 1.1: Rewrite workflow primer and update/extend its test suite**
  - **Files**: `src/delivery/workflow-primer.ts`, `tests/delivery.test.ts`
  - **Action**: Implement design §1 in `workflow-primer.ts` — exported API unchanged (`workflowPrimerShort(): string[]`, `workflowPrimerLong(): string[]`):
    1. Update the file header (lines 1–9): scoped mandate description, byte-identity invariant now test-pinned, enumerated lists hand-synced with `metta-guard-bash.mjs` and guarded by the seam test in `tests/delivery.test.ts`.
    2. Rewrite the single shared `MANDATE` constant to the exact wording in design §1 (scoped to state-mutating commands, names `metta-guard-bash` PreToolUse hook as enforcement authority, states the guard blocks mutating/unrecognized commands fail-closed but permits a read-only query surface directly, keeps the humans-in-terminal carve-out). Keep the long variant's existing appended broken-artifacts sentence (line 47 concatenation) outside the constant.
    3. Add new constant `READ_ONLY_POINTER` (exact one-line wording, design §1) and insert it in `workflowPrimerShort()` immediately after `MANDATE`, blank-line separated, before `'Primary entry points:'`.
    4. Add new constant `READ_ONLY_SURFACE_BULLETS` rendering the `### Read-only queries (permitted directly)` subsection exactly per design §1: generation-time qualifier + "the hook, not this text, is authoritative"; single-word list (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`) with the not-strictly-read-only hedge; two-word list (`issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`); bare list (`roadmap`, `release`, `backlog`, e.g. `metta roadmap --json`); bare-`metta` discovery sentence; attempt-it fail-closed guidance. Place in `workflowPrimerLong()` after the `### Forbidden` bullets, before `### Research discipline` (ADR-D).
    5. Rewrite the Forbidden bullet (long variant, line 60) to enumerate the full blocked surface exactly per design §1: `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut` — no "any other `metta <cmd>`" blanket wording.
    6. Add the SYNC comment (exact two-line text from design §2, direction reversed to point at the hook) adjacent to the enumerated lists in `workflow-primer.ts`.
    7. Preserve verbatim: the doc-only-exceptions line, the stub-prohibition sentence (the second Forbidden bullet — do NOT alter or restate it), `ENTRY_POINTS_BULLETS`, `TRUST_MODEL_BULLETS`, the quick-mode paragraph, the full `### Research discipline` section, and the short variant's closing refresh-reference line.

    In `tests/delivery.test.ts` (design §§5–6):
    1. Update the line-61 `formatContext` pin to `toContain('State-mutating metta commands MUST go through the matching metta skill')`.
    2. New describe "Workflow primer scoped mandate": full-mandate duplicated-literal byte-identity pin asserted `toContain` on both variants joined with `'\n'` (ADR-B); neither variant contains `'never call the CLI directly'` nor the old blanket "any other `metta <cmd>`" phrase; long variant contains `'### Read-only queries (permitted directly)'`, `'metta-guard-bash'`, `'at generation time'`, `'the hook, not this text, is authoritative'`, `'attempt it'` and `'fails closed'`; short variant pins the full `READ_ONLY_POINTER` string and does NOT contain the `###` read-only heading; preservation pins for the doc-only-exceptions line and the stub-prohibition bullet.
    3. New describe "Workflow primer / guard allow-list seam" (design §5, ADR-4 pin pattern): `readFileSync` both `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` resolved from `join(import.meta.dirname, '..')`; extraction helper slices each declaration block (`ALLOWED_SUBCOMMANDS = new Set([`, `ALLOWED_TWO_WORD = new Map([`, `ALLOWED_BARE = new Set([`, plus `BLOCKED_SUBCOMMANDS` / `BLOCKED_TWO_WORD`) to its closing `]);`, strips `//` line comments FIRST, then collects quoted strings (`/'([^']+)'/g`; two-word groups via `/\['([a-z-]+)',\s*new Set\(\[([^\]]+)\]\)/g`). Assert: sanity floors (>= 9 single-word, >= 7 two-word groups, >= 3 bare); template/deployed extraction deep-equality; every allowed entry appears in `workflowPrimerLong().join('\n')` in rendered form (backticked single words, two-word groups joined `|`, bare entries within the "Bare (flags only)" line); every blocked entry appears in the Forbidden bullet (two-word groups joined `/` in hook order).
  - **Verify**: `npx vitest run tests/delivery.test.ts` passes (seam test extracts from current hook files — no hook edits needed for it to pass); `npx tsc --noEmit` clean.
  - **Done**: Both primer variants carry the new scoped mandate byte-identically; long variant has the read-only subsection between Forbidden and Research discipline and the enumerated Forbidden bullet; short variant has the pointer line and no subsection; all new and updated assertions in `tests/delivery.test.ts` pass; no exported-API or consumer changes.

- [ ] **Task 1.2: Comment-only SYNC annotations in both guard hook copies**
  - **Files**: `src/templates/hooks/metta-guard-bash.mjs`, `.claude/hooks/metta-guard-bash.mjs`
  - **Action**: Per design §2, insert the exact two-line SYNC comment (`// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden` / `// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.`) directly above each of the five list declarations: `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, `ALLOWED_BARE`, `BLOCKED_SUBCOMMANDS`, `BLOCKED_TWO_WORD`. Edit the template copy first, then mirror the identical lines to the deployed copy. ZERO non-comment changes — no code line may change: decision logic, list membership, tiering, and credential handling must be byte-identical apart from the inserted comments.
  - **Verify**: `diff src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` produces no output; `npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts tests/metta-guard-mint-seam.test.ts tests/metta-guard-agent-dispatch.test.ts` all pass unchanged (the spec's "Hook diff is comment-only" scenario).
  - **Done**: Both copies remain byte-identical, carry the SYNC comment above all five list declarations, and all four guard suites pass with zero test modifications.

- [ ] **Task 1.3: Rewrite docs/workflows/README.md "Core rule: skills, not CLI"**
  - **Files**: `docs/workflows/README.md`
  - **Action**: Per design §3 (lines 45–51): keep the heading; replace the two body paragraphs with the exact proposed text — scoped mandate naming `metta-guard-bash` as enforcement authority with the fail-closed/read-only acknowledgment pointing at CLAUDE.md's Read-only queries subsection; second paragraph enumerating the full mutating surface (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) with the broken-artifacts issue reference. Copy the existing stub-prohibition sentence from the current README verbatim (do not retype or paraphrase it). Preserve the third paragraph (the "CLAUDE.md wins" note, line 51) verbatim. Remove all blanket "any other `metta <cmd>`" wording.
  - **Verify**: `grep -c 'any other' docs/workflows/README.md` returns 0 matches in the Core rule section; `grep -q 'metta-guard-bash' docs/workflows/README.md` succeeds; visual diff confirms the CLAUDE.md-wins note and stub-prohibition sentence are unchanged.
  - **Done**: Core rule section carries the scoped mandate and read-only acknowledgment, enumerates the mutating families, preserves the stub-prohibition sentence and the CLAUDE.md-wins note, and contains no blanket-ban wording.

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: Pin read-only subsection in buildWorkflowSection output**
  - **Depends on**: Task 1.1
  - **Files**: `tests/refresh.test.ts`
  - **Action**: In the existing `buildWorkflowSection` describe block, add one assertion: `expect(result).toContain('### Read-only queries (permitted directly)')` — pinning that the refresh-emitted region carries the subsection (design §6).
  - **Verify**: `npx vitest run tests/refresh.test.ts` passes.
  - **Done**: The new assertion is present and green; no other assertions in the file changed.

- [ ] **Task 2.2: Hand-apply regenerated metta:workflow region to metta's own CLAUDE.md**
  - **Depends on**: Task 1.1
  - **Files**: `CLAUDE.md` (repo root of the change worktree)
  - **Action**: Per design §4 and ADR-F (direct `metta refresh` is Tier-2 blocked for executors — do NOT invoke the CLI): hand-edit the text between `<!-- metta:workflow-start -->` and `<!-- metta:workflow-end -->` to be byte-exact with the new `buildWorkflowSection()` output. Concrete region diff: mandate paragraph replaced, Forbidden first bullet replaced with the enumerated families, read-only subsection inserted between Forbidden and Research discipline. Everything else in the region (entry points, trust model, quick-mode paragraph, doc-only-exceptions line, skill lists, stub-prohibition bullet) unchanged. To guarantee byte-exactness, write a small script in the session scratchpad (not committed) that imports `buildWorkflowSection` from `src/cli/commands/refresh.ts`, prints its output, and generate/paste the region from that output rather than typing it by hand.
  - **Verify**: Run the scratchpad script via `npx tsx` and `diff` its output against the extracted region text between the markers — zero diff required (design §7). `grep -q 'Doc-only fixes and edits to this workflow section itself are the exceptions' CLAUDE.md` succeeds; `grep -c 'any other' CLAUDE.md` shows no blanket-ban wording remaining in the workflow region.
  - **Done**: The `metta:workflow` region is byte-identical to `buildWorkflowSection()` output, carries the scoped mandate, enumerated Forbidden families, and read-only subsection, and preserves the doc-only-exceptions line and section structure; no edits outside the marker region; no scratch files committed.

## Batch 3 (depends on Batch 2)

- [ ] **Task 3.1: Full verification sweep**
  - **Depends on**: Task 1.1, Task 1.2, Task 1.3, Task 2.1, Task 2.2
  - **Files**: none (verification only; fix regressions in the files above if any check fails)
  - **Action**: Run the complete gate set across the assembled change: full test suite, typecheck, hook-copy identity, and CLAUDE.md region byte-exactness (re-run the §7 tsx diff from Task 2.2).
  - **Verify**: `npm test` fully green; `npx tsc --noEmit` clean; `diff src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` empty; the tsx region diff against `CLAUDE.md` is empty.
  - **Done**: All four checks pass with zero failures; any fix made during this task stays within the files already touched by Tasks 1.1–2.2.
