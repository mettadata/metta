# Summary: fix-roadmap-entry-lifecycle-dangling-entries

## What was implemented

Full roadmap entry lifecycle for the post-PR#85 world where dangling entries are the normal end state of every shipped roadmap entry (issue `roadmap-has-no-entry-lifecycle-after-its-referenced-issue`, major):

1. **Store surface** (`d0a944fb7`): `RoadmapStore.remove(target: string | number)` (typed `not_found`, 1-based position or slug), batched `removeSlugs(slugs[])` (single load/validate/save), no-throw duplicate-tolerant `retire(slug)` — all over a shared private `spliceAndSave` core with canonical renumbering; `removeTop` deleted (sole caller was `next`).
2. **`roadmap remove <position|slug>`** (`5d184af26`): main-branch guard before any read, `/^\d+$/` input is always a position (all-digit slugs are legal, so no fallback rule), `autoCommitFile` with `chore: remove roadmap entry <slug>`, JSON `{removed, position, committed, commit_sha}`, typed `not_found` through the existing error envelope, zero `spec/issues/` access.
3. **`next` skip-and-warn rewrite** (same commit): pure-plan phase (walk entries, classify healthy/dangling via `issuesStore.show` — which never reads `resolved/`, so resolved issues are dangling by construction) + mutate phase (`removeSlugs([activated])` by default — dangling entries stay in place; `--prune` folds skipped slugs into the same single write/commit with a `(pruned N dangling)` commit-message suffix). All-dangling or empty roadmap: no store call, `next: null` + `skipped` list, exit 0. Additive JSON `skipped`/`pruned` fields plus one stderr warning per skipped slug naming both remedies — the machine-detectable replacement for ADR-4's exit-4. The ADR-4 fail-stop is formally superseded (design.md ADR-3, citing `spec/archive/2026-07-26-roadmap-feature/design.md:17`; archive untouched).
4. **Auto-retire on issue resolution** (`acb8012d0`): `backlog done` and `fix-issue --remove-issue` call `retire(slug)` after a successful archive and conditionally stage `spec/roadmap.md` into the SAME commit (never `autoCommitFile`, never unconditional staging); fail-open with a stderr remedy warning; additive `retired_roadmap_entry: string | null` JSON field. `fix-issue`'s no-branch-guard posture inherited by design.

**Not absorbed**: issue `metta-roadmap-next-mutates-on-invocation-with-no-read-only` — the skip design does not make `next` read-only (activation still pops/commits); kept out of scope per design ADR-8, with the pure-plan/mutate split banked so a future preview flag is trivial.

## Tests and gates

Store 29 (S1-S14 suites), cli-roadmap 30 (C1-C16 incl. the inverted ADR-4 fail-stop test), cli-issue-backlog 65 (R1-R6 incl. same-commit `git show --name-status` assertions and fail-open injection). Full suite 2496/2496 across 130 files; tsc/lint/build clean; `removeTop` swept to zero references; `spec/archive/` diff empty; scope confined to declared files.

## Breaking change (intended, spec'd)

Automation depending on `roadmap next` exit-4 on dangling heads must switch to the `skipped` JSON field / stderr warnings. Commit-message prefix `chore: pop roadmap entry <slug>` preserved for log-based checks.

## Verification

### Spec Scenarios

All 6 requirements (3 MODIFIED, 3 ADDED) and all 19 scenarios verified with passing-test evidence (349/349 across the four touched suites; per-scenario citations in the verification report):

- [x] `next` skip-and-warn: dangling head skipped with per-slug remedies, ghost survives (454/481); `--prune` same-write/same-commit with slug-listing commit body (508); all-dangling and empty no-ops, prune-inert byte-identically (541/332); old exit-4 fail-stop gone (inverted C12 at 427)
- [x] Error contract: five failure types uniform (685); dangling no longer routes through the error envelope
- [x] Branch/auto-commit discipline: all four verbs guarded, guard-before-validation (637/650/661), `--on-branch` escape (668)
- [x] `roadmap remove`: position + slug + dangling, renumber, auto-commit, typed not_found, `spec/issues/` untouched (250/266/291; store S1-S14)
- [x] Auto-retire: same-commit atomicity via `git show` (R1/R4), non-roadmapped byte-identical + pre-dirty stays out of commit (R2/R5), fail-open injection (R6), `retired_roadmap_entry` additivity (R3)
- [x] Machine-detectable skip signal: `skipped`/`pruned` JSON ordering and distinction, empty-signal contract intact, one stderr line per slug (481/508/584/607)
- [x] ENOENT-only dangling: malformed-existing-file NOT dangling and NOT pruned (385/404)
- [x] Guard/mint/skill coverage of `roadmap remove` (guard tests 959/971/982; mint scope granted)

Non-blocking note: `tests/metta-session-mint.test.ts` EXPECTED_SCOPES omits metta-roadmap, so mint-side granting of `roadmap:remove` is untested (guard-side verification is tested).

### Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 129 files, 2504/2504, no flakes |
| typecheck / lint | PASS |
| build | PASS |
| hook template/deployed/dist sync (guard-bash, session-mint) | PASS — byte-identical |
| removeTop sweep | PASS — zero references |
| archive immutability | PASS — spec/archive/ untouched |

Review: 3 reviewers, 1 iteration — quality PASS, correctness/security PASS_WITH_WARNINGS; all warnings fixed in 991f5ed02 (ENOENT-only classification, guard/mint/skill coverage, pre-dirty acceptance recorded, prune audit trail, help text).
