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
