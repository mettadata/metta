# Summary: fix-repo-wide-duplicate-requirement-scan

Resolves issue `repo-wide-duplicate-requirement-scan-run-during-fix` (legacy pre-idempotency spec-merger duplication in 3 capability specs).

## What changed

1. **`spec/specs/fix-issues-command/spec.md`** — 441 → 147 lines. The 4-requirement block was tripled (copies at lines 3–149, 150–296, 297–441); kept the first copy. All three copies re-diffed byte-identical (modulo trailing blank lines) immediately before deletion. Now exactly 4 `## Requirement:` headings, zero duplicate names.
2. **`spec/specs/install-init/spec.md`** — 246 → 206 lines. Deleted lines 68–107, the contiguous second copies of `init-command-drives-discovery` and `init-skill-invokes-init-command`, after diff-verifying identity. Now exactly 9 headings, zero duplicates; block spacing (two blank lines) preserved.
3. **`spec/specs/user-stories/spec.md`** — 374 → 187 lines. The 7-requirement block was doubled (lines 3–189, 190–374); kept the first copy after diff verification. Now exactly 7 headings, zero duplicates.
4. **Three `spec.lock` files** — regenerated through the project's own code path (`parseSpec` + `SpecLockManager.update()`, executed via the built `dist/` modules after diff-confirming the relevant `src/` files are identical between checkouts). Results: fix-issues-command v12→v13, 12→4 entries; install-init v11→v12, 11→9 entries; user-stories v14→v15, 14→7 entries. **Zero per-requirement hash mismatches** against the first entries of the old locks — machine confirmation that no content changed.
5. **`CLAUDE.md`** — regenerated via `metta refresh` (auto-committed by the CLI). Counts: fix-issues-command 78→26 (exactly 1/3, consistent with tripling), user-stories 84→42 (exactly 1/2), install-init →39 (previous row was stale, predating requirements added since the last refresh).

## What did NOT change

No TypeScript source, tests, or templates. The merger idempotency guard at `src/finalize/spec-merger.ts:177` already prevents recurrence; a proactive duplicate-requirement gate remains out of scope (backlog candidate).

## Commits

- `fix(specs): dedupe fix-issues-command spec`
- `fix(specs): dedupe install-init spec`
- `fix(specs): dedupe user-stories spec`
- `fix(specs): regenerate spec.locks for deduped capabilities`
- `chore(refresh): regenerate CLAUDE.md` (by metta refresh)

## Verification results (2026-08-11)

Note: verifier lenses executed inline by the skill-host (subagent spawn limit 200/200 exhausted); all evidence is mechanical.

### Spec scenarios

- [x] fix-issues-command spec is deduplicated — `grep -c '^## Requirement:'` = 4 (`fix-issue-cli-command`, `issues-store-archival`, `skill-template`, `cli-registration`); diff vs main shows pure deletion of 294 lines
- [x] install-init spec is deduplicated — 9 headings, `uniq -d` over names empty, untouched requirements bit-identical
- [x] user-stories spec is deduplicated — 7 headings, `uniq -d` empty, pure deletion of 187 lines
- [x] locks match repaired specs — regenerated via `SpecLockManager.update()`: 4/9/7 entries, versions 13/12/15, zero per-requirement hash mismatches; only the three target locks changed on the branch
- [x] refreshed counts — CLAUDE.md rows: fix-issues-command 78→26, install-init 46→39, user-stories 84→42; no other rows changed
- [x] gates still pass — see below

### Gate results

- `npm test` — 118 files, **2085/2085 passed** (310s)
- `npx tsc --noEmit` — clean
- `npm run lint` — exit 0 (tsc --noEmit)
- Repo-wide duplicate scan across all `spec/specs/*/spec.md` — zero duplicated requirement names remain

Verdict: **PASS** (3/3 verification lenses — tests, static checks, spec-content evidence).
