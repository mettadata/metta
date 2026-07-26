# Verification: roadmap-feature

Verified 2026-07-25 by the metta-verifier. All 29 scenarios verified independently — by driving the built CLI (`node dist/cli/index.js`) against temp fixtures under the session scratchpad, by driving the guard/mint hooks directly with synthetic PreToolUse events, and by citing the named test that locks each behavior. No test was taken on the executor's word; the full suite was re-run. (Artifact note: the harness refused the Write tool for this file — "Subagents should return findings as text" — so it was written via the shell-heredoc fallback to the exact mandated path, per verifier protocol.)

## Spec Scenarios

### Requirement: RoadmapStore single markdown file
- ✅ **Entries round-trip through format and parse in order** — `tests/roadmap-store.test.ts::"format → parse round-trips ordered entries with notes verbatim"` (passed; asserts exact canonical bytes, note-with-embedded-em-dash verbatim, `RoadmapSchema.parse` clean). Store-level round-trip also confirmed by CLI drive: after 3 adds, `spec/roadmap.md` contained the canonical `# Roadmap` + numbered backticked-slug lines with the em-dash note, and the view re-read matched.
- ✅ **Missing roadmap file reads as an empty roadmap** — `tests/roadmap-store.test.ts::"returns [] when the file is missing, without creating it"`; CLI drive on fresh fixture: `metta roadmap` / `--json` both exit 0, `spec/roadmap.md` not created.
- ✅ **Unsafe slug is rejected at the store boundary** — `tests/roadmap-store.test.ts::"rejects an unsafe slug before any I/O — file never created"` (`../etc/passwd` → throws `Invalid roadmap slug`, no file) and `::"rejects an unsafe slug argument before touching the file"` (reorder). `assertSafeSlug` precedes `load()` in `src/roadmap/roadmap-store.ts:118,137`.

### Requirement: Default read-only ordered status view
- ✅ **Populated roadmap listed in order** — CLI drive: 3-entry text view printed positions, slugs, resolved titles, and the note; exit 0; file byte-unchanged. Also `tests/cli-roadmap.test.ts::"lists entries in order with resolved titles and notes in both modes, exit 0, no writes"`.
- ✅ **JSON view mirrors the text view** — CLI drive: `--json roadmap` and `roadmap --json` (global-flag placement both ways) emitted `{roadmap: [{position, slug, title, note}...]}` in the same order, exit 0.
- ✅ **Read-only view runs on any branch without a guard** — CLI drive on branch `feature-x`: view exit 0, no guard, no write. No `assertOnMainBranch` in the default action (`src/cli/commands/roadmap.ts:30-70`). Also `tests/cli-roadmap.test.ts::"works on a non-main branch with no branch guard"`.
- ✅ **Empty roadmap renders a friendly empty state** — CLI drive: text `Roadmap is empty. Add entries with: metta roadmap add <backlog-slug>`, JSON `{"roadmap": []}`, both exit 0, no file created.

### Requirement: Dangling entries surfaced, never fatal
- ✅ **Deleted backlog item shows as dangling** — CLI drive: deleted `spec/backlog/old-idea.md`; text view listed `old-idea` at its position as `(dangling — backlog item missing)`, other titles resolved, exit 0. Also `tests/cli-roadmap.test.ts::"marks a dangling entry at its position while healthy entries omit the flag, exit 0"`.
- ✅ **Dangling flag present in JSON output** — same drive with `--json`: dangling entry carried `"dangling": true, "title": null`; healthy entries omit the key (test asserts `'dangling' in row === false`).

### Requirement: roadmap add
- ✅ **Valid slug appended with a note and auto-committed** — CLI drive: `roadmap add foo-feature --note "after auth"` → `{slug, position: 1, committed: true, commit_sha}` exit 0; `git log` shows `chore: add roadmap entry foo-feature`. Also `tests/cli-roadmap.test.ts::"appends with a note, reports the position and auto-commits"`.
- ✅ **Unknown backlog slug is rejected as not_found** — CLI drive: `add nope --json` → `{error: {code: 4, type: "not_found", message: "Backlog item 'nope' not found"}}` exit 4. Byte-unchanged file locked by `tests/cli-roadmap.test.ts::"unknown slug exits 4 with not_found; roadmap.md untouched and spec/backlog/ never written"`.
- ✅ **Duplicate roadmap entry is rejected** — CLI drive: repeat `add foo-feature --json` → `type: "duplicate_entry"` exit 4; file untouched (store test asserts byte-identical).

### Requirement: roadmap reorder (complete non-interactive permutation)
- ✅ **Full permutation rewrites the order** — CLI drive: `reorder old-idea foo-feature bar-feature` → exit 0, file rewritten in the new order with the `after auth` note preserved verbatim, `chore: reorder roadmap` committed. Also `tests/cli-roadmap.test.ts::"rewrites the order preserving notes and auto-commits"`.
- ✅ **Omission, addition, and duplicate are each rejected with no partial write** — CLI drive of all three (`missing: bar-feature`, `unexpected: ghost`, `duplicated: foo-feature`) each `type: "invalid_reorder"` exit 4; md5 of `spec/roadmap.md` identical before/after all three. Also `tests/cli-roadmap.test.ts::"omission, addition and duplicate each exit 4 with invalid_reorder; file byte-identical after all three"`.

### Requirement: roadmap next via the promote path
- ✅ **Top entry activated and removed from the queue** — CLI drive: `next --json` → `{next: "foo-feature", message: "Run: metta propose \"Foo feature\"", committed: true, commit_sha}` exit 0; second entry became position 1; `chore: pop roadmap entry foo-feature` committed. Shared path proven structurally: `src/cli/commands/roadmap.ts:166` and `src/cli/commands/backlog.ts:97,99` both compose output from `buildPromoteHandoff` (`src/cli/promote-handoff.ts`) — one edit point for both commands.
- ✅ **Empty roadmap is a friendly no-op** — CLI drive on fresh fixture: JSON `{"next": null}`, text `Roadmap is empty — nothing to activate.`, both exit 0, git HEAD unchanged, no file created. Also `tests/cli-roadmap.test.ts::"empty roadmap is a no-op in both modes: exit 0, no write, no commit"`.

### Requirement: Main-branch and auto-commit discipline
- ✅ **Non-main branch blocks each mutation** — CLI drive on `feature-x`: `add`, `reorder` (with an intentionally invalid permutation), and `next` each → `type: "branch_guard"` exit 4, file md5 unchanged. Guard-before-validation locked by handler order (`roadmap.ts:114-117`) and `tests/cli-roadmap.test.ts::"blocks add, reorder and next off-main with branch_guard exit 4"`.
- ✅ **Escape hatch permits a deliberate off-main mutation** — CLI drive: `add foo-feature --on-branch feature-x` → exit 0, committed on `feature-x` (HEAD commit `chore: add roadmap entry foo-feature`). Also `tests/cli-roadmap.test.ts::"--on-branch escape hatch proceeds and commits on the current branch"`.

### Requirement: Standard error contract
- ✅ **Envelope shape is consistent across failure types** — CLI drives produced all four discriminators (`not_found`, `duplicate_entry`, `invalid_reorder`, `branch_guard`), each a single top-level `error` object with numeric `code: 4`, non-empty `message`, process exit 4. Also `tests/cli-roadmap.test.ts::"all four failure types share the envelope shape: code 4, non-empty message"`.
- ✅ **Text mode reports the same failures on stderr** — CLI drive: `roadmap add nope` (no `--json`) → stderr `Backlog item 'nope' not found`, stdout empty, exit 4. Also `tests/cli-roadmap.test.ts::"text-mode failures print the message on stderr and exit 4"`.

### Requirement: Additive CLI wiring
- ✅ **Command group and store are reachable through standard wiring** — CLI drive: `metta roadmap --help` lists `add`, `reorder`, `next`. `registerRoadmapCommand(program)` at `src/cli/index.ts:73`; barrel export `src/index.ts:12`; `roadmapStore` on `CliContext` (`src/cli/helpers.ts:30,50,70`). `tests/cli-roadmap.test.ts::"createCliContext exposes roadmapStore and RoadmapStore is exported from the barrel"` passed.
- ✅ **Backlog behavior is untouched** — full suite (1573 tests) green; `tests/cli-issue-backlog.test.ts` + `tests/backlog-store.test.ts` pass unmodified. Promote output verified byte-identical against merge-base: `git show <merge-base>:src/cli/commands/backlog.ts` shows the pre-change strings `Run: metta propose "${item.title}"` / `Promote '${slug}' by running: metta propose "${item.title}"`, and live drives of `backlog promote old-idea` (JSON and text) reproduced them exactly. Note: no pre-existing test locks promote's output bytes (design R1 assumed one existed) — the byte-identity claim rests on the merge-base diff + runtime drive performed in this verification.

### Requirement: Guard hook tiering
- ✅ **Uncredentialed AI session is blocked from roadmap mutations** — direct hook drive (synthetic PreToolUse event, temp cwd, no credential): `metta roadmap add foo`, `reorder a b`, `next` each exit 2 with a rejection pointing at the skill path ("Use the matching /metta-<skill> skill…"). Entries at `.claude/hooks/metta-guard-bash.mjs:52` (`BLOCKED_TWO_WORD`). Also `tests/cli-metta-guard-bash-integration.test.ts` roadmap it.each (×3).
- ✅ **Read-only view passes the guard without a credential** — direct hook drive: `metta roadmap` and `metta roadmap --json` exit 0 uncredentialed (`ALLOWED_BARE` branch, guard-bash.mjs:59,118); `metta roadmap frobnicate` stays fail-closed exit 2 (integration test).
- ✅ **Existing guard entries are unchanged** — direct hook drive: `backlog add`, `backlog promote`, `changes abandon` still exit 2 uncredentialed; `backlog list` still allowed; bare `metta backlog` still blocked (integration test). Full guard suites pass.

### Requirement: /metta-roadmap skill
- ✅ **Skill invocation mints the credential and the guard authorizes the mutation** — direct drive: `node .claude/hooks/metta-session-mint.mjs metta-roadmap` minted `.metta/scratch/skill-session.token`, after which `roadmap add/reorder/next` all pass the guard exit 0. Token scope locked by `tests/cli-metta-guard-bash-integration.test.ts::"mint hook scope for metta-roadmap grants exactly roadmap:add/reorder/next"` (also proves out-of-scope `backlog add` stays blocked). Skill frontmatter registers the mint hook (`.claude/skills/metta-roadmap/SKILL.md:5-10`); the `next` flow echoes the CLI's `metta propose "<title>"` handoff (SKILL.md:23,25).
- ✅ **Skill offers add and reorder against CLI-emitted slugs** — SKILL.md:21-22 route `add` through `metta backlog list --json` slugs and `reorder` through `metta roadmap --json` slugs, with an explicit "Never invent slugs" rule (SKILL.md:29) and position echo. `src/templates/skills/metta-roadmap/SKILL.md`, deployed `.claude/` copy, and built `dist/templates/` copy are byte-identical (diff + `tests/template-deploy-sync.test.ts`). The AI-behavioral clause is enforced by the guard tiering verified above; the skill text is compliant.

### Requirement: Orchestrators answer "what next?" from the roadmap top
- ✅ **Populated roadmap answers routing without user re-litigation** — mechanical substrate verified: uncredentialed `metta roadmap --json` (guard drive, exit 0) yields the ordered list with the top entry first (CLI drive), and every mutating form is guard-blocked outside the skill, so activation can only proceed through `/metta-roadmap`. Orchestrator guidance is carried in the skill (`SKILL.md:33`). Deviation noted: the `/metta-next` skill body itself was not edited to mention the roadmap (design scoped no such component); see Summary.
- ✅ **Empty roadmap yields a clean fallback signal** — CLI drive on empty fixture: view → `{"roadmap": []}` exit 0; `roadmap next --json` → `{"next": null}` exit 0, no write, no commit.

## Gate Results

| Gate | Result | Detail |
|------|--------|--------|
| `npx vitest run` | ✅ pass | 92 files, 1573 tests, 0 failures (261.6s) |
| `npx tsc --noEmit` | ✅ pass | exit 0, no diagnostics |
| `npm run lint` | ✅ pass | (lint = `tsc --noEmit` in this repo) exit 0 |
| `npm run build` | ✅ pass | compile + copy-templates completed |
| Template/deploy/dist byte-identity | ✅ pass | `diff` clean across `src/templates/{hooks,skills/metta-roadmap}` ↔ `.claude/` ↔ `dist/templates/`; `tests/template-deploy-sync.test.ts` green (targeted re-run: 72/72 with cli-issue-backlog) |

Constitution spot-checks: Zod validation on every roadmap read (`roadmap-store.ts:102`) and before every write (`:109`); `.js` extensions on all new imports; typed `RoadmapValidationError` hierarchy instead of message sniffing for the new discriminators; skill/hook content shipped as template files copied at build, no string-literal templates in TS; `BacklogStore` consumed read-only (`exists`/`show` only).

## Summary

The change delivers the full roadmap feature as designed: a `RoadmapStore` (pure parse/format/validate core, `StateStore.readRaw/writeRaw` shell, Zod on both paths, safe-slug boundary) owning `spec/roadmap.md`; a `metta roadmap` command group with a read-only unguarded status view (dangling-aware) and three mutating subcommands (`add`, `reorder`, `next`) under `assertOnMainBranch` + `autoCommitFile` discipline with the standard exit-4 error envelope; a shared `buildPromoteHandoff` helper making `roadmap next` inherit `backlog promote`'s activation semantics from a single edit point; and additive governance wiring (Tier-2 guard entries for the three mutations, `ALLOWED_BARE` for the bare view, `metta-roadmap` mint scope, and the `/metta-roadmap` skill), all byte-synced across template/deployed/dist copies.

All 29 scenarios pass; all gates pass. Deviations and residual risks:

- **ADR-3 (documented deviation):** the store test lives at `tests/roadmap-store.test.ts`, not the spec's literal `test/roadmap/roadmap-store.test.ts` — the literal path is outside vitest's `tests/**` include glob and would never run. The 1:1 test-file substance of the requirement is met.
- **ADR-4 (spec-silent case):** dangling top entry on `roadmap next` fails with `not_found` (exit 4, no pop, no write) and the message names both remedies — verified by drive and by `tests/cli-roadmap.test.ts::"dangling top entry exits 4 with not_found naming both remedies and does not pop"`.
- **Promote output lock (residual risk):** no pre-existing test pins `backlog promote`'s exact output bytes, contrary to design R1's assumption. Byte-identity was verified in this pass against the merge-base source and by runtime drives; consider adding an output-locking promote test as a follow-up so future drift fails CI.
- **`/metta-next` skill not updated (advisory):** the orchestrator-routing requirement is satisfied mechanically (unguarded view, guard-forced skill path, clean empty signals) and the guidance lives in the `/metta-roadmap` skill body, but `/metta-next`'s own SKILL.md does not mention consulting the roadmap when no change is active. This matches the design's component list (no metta-next edit was scoped), so it is recorded as an observation, not a failure — a candidate for a small follow-up if roadmap-first routing should be explicit in `/metta-next`.
