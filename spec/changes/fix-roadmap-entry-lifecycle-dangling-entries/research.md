# Research Synthesis: fix-roadmap-entry-lifecycle-dangling-entries

Three parallel tracks, one per fix area (see `research-remove-verb.md`, `research-next-skip.md`, `research-auto-retire.md`). All code-verified against the worktree.

## US-2 — `roadmap remove <position|slug>`

Single primitive `RoadmapStore.remove(target: string | number)` returning `{ entry, position }`. CLI disambiguation: `/^\d+$/` input is ALWAYS a position (all-digit slugs like `2024` are legal, so a fallback rule would be ambiguous). Miss throws `RoadmapValidationError('not_found')` — extend the existing type union; `mapRoadmapError` forwards it with zero changes. Splice + existing private `save()` gives canonical renumbering free. CLI mirrors add/reorder: branch guard before any read, `autoCommitFile` (`chore: remove roadmap entry <slug>`), JSON `{ removed, position, committed, commit_sha }`. Skip `assertSafeSlug` (no path construction from the target). Do NOT subsume `removeTop` here — the next-verb area retires it (below). ~12 tests (store + CLI).

## US-1/US-4 — `next` skip-and-warn + `--prune`

CLI-owned walk over `roadmapStore.list()` with one `issuesStore.show` per entry until the first healthy entry. Load-bearing verified fact: `show` reads only `spec/issues/<slug>.md`, never `resolved/` — so resolved issues are dangling by construction. Activating a non-head entry needs a new batched primitive `RoadmapStore.removeSlugs(slugs[])` (single load/validate/save): default passes `[activated]` only (non-destructive skip — dangling entries stay); `--prune` passes `[...skipped, activated]` — one write, one commit. All-dangling path makes no store call at all (prune inert structurally); `next: null` + non-empty `skipped`, exit 0. Replacement signal for ADR-4's exit 4: additive JSON `skipped: string[]` (always) and `pruned: string[]`; one stderr warning per skipped slug naming slug + both remedies (stderr keeps JSON stdout parseable — design to ratify). `removeTop` is deleted (sole caller was `next`). ADR-4 supersession: normative record is the merged spec text; this change's design.md carries a forward-referencing ADR citing `spec/archive/2026-07-26-roadmap-feature/design.md:17` (archive not edited). Commit-message prefix `chore: pop roadmap entry <slug>` preserved for log-based automation. Inverts the existing ADR-4 test (`tests/cli-roadmap.test.ts:299-315`).

**Read-only-next call:** the skip design does NOT make `next` read-only — activation still pops and commits. Issue `metta-roadmap-next-mutates-on-invocation-with-no-read-only` stays OUT of scope (it would stack a second breaking contract change); structure the handler as pure-plan + separate mutate phase so a future preview flag is trivial.

## US-3 — Auto-retire on issue resolution

New no-throw `RoadmapStore.retire(slug): Promise<RoadmapEntry[]>` — removes ALL matches (duplicate-tolerant), returns `[]` with no write on no-match. Hook lands in both commands after archive succeeds, before the commit: `spec/roadmap.md` conditionally appended to the existing commit path list (`commitPaths` in backlog.ts; `git add` args in fix-issue.ts). Conditional staging is mandatory — unconditional staging in fix-issue would sweep a pre-dirty roadmap file. Do NOT use autoCommitFile (separate commit; refuses on dirty archive files). Matching: exact equality on `RoadmapEntry.slug`. **Fail-open**: a retire failure warns on stderr, the archive commit proceeds, exit 0 — the spec's atomicity means "retirement rides the archive commit when it happens", not all-or-nothing; fail-closed would need an un-archive inverse. JSON: additive `retired_roadmap_entry: string | null` on both commands. DI: `ctx.roadmapStore` already on CliContext. Posture note for design: `fix-issue --remove-issue` has no branch guard, so auto-retire inherits that — must be stated explicitly. Tests live in `tests/cli-issue-backlog.test.ts` (existing same-commit `git show --name-status` assertion pattern) + `tests/roadmap-store.test.ts`.

## Cross-cutting

- Store surface after the change: `add`, `reorder`, `remove(target)`, `removeSlugs(slugs[])`, `retire(slug)`; `removeTop` deleted. `remove` and `removeSlugs`/`retire` share the splice+save core — implement once.
- File-level overlap: roadmap-store.ts and its tests are touched by all three areas → single-owner task; roadmap.ts (remove + next) same file → one task; backlog.ts/fix-issue.ts independent of those.
- Breaking change (intended, spec'd): exit-4-on-dangling automation must switch to the `skipped` field/warnings.

## Recommendation

Implement all three areas with the researched contracts. No open approach questions for design beyond ratifying: stderr-for-warnings in JSON mode, `retire` fail-open posture, `removeTop` deletion, and the position-vs-slug disambiguation rule.
