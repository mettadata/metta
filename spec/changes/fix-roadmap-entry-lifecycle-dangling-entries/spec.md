# roadmap-feature

## MODIFIED: Requirement: roadmap next activates the top entry with a propose handoff and pops it

`metta roadmap next` MUST walk the roadmap from the first entry, resolve each entry's backlog item via `IssuesStore.show`, and activate the first entry whose issue resolves, emitting the `metta propose "<title>"` activation handoff built by the `buildPromoteHandoff` helper in `src/cli/promote-handoff.ts`, of which `roadmap next` is the sole consumer. This activation path is deliberately decoupled from `backlog promote`, which performs zero writes and independently emits a `/metta-fix-issues <slug>` handoff.

Dangling entries — entries whose `IssuesStore.show` resolution fails because `spec/issues/<slug>.md` does not exist — MUST be skipped, not fatal. This formally supersedes ADR-4's fail-stop mandate: the command MUST NOT fail with `type: 'not_found'` and exit code 4 when it encounters a dangling entry, and the previous fail-stop behavior MUST NOT remain in any code path. For each dangling entry skipped, the command MUST emit a warning naming that entry's slug and the available remedies (`metta roadmap remove <slug>`, or restoring `spec/issues/<slug>.md`) — one warning per skipped entry.

The skip MUST be non-destructive by default: skipped dangling entries MUST remain in `spec/roadmap.md` at their positions, and only the activated entry MUST be removed from the roadmap on success. When the opt-in `--prune` flag is passed, the command MUST additionally remove the skipped dangling entries in the same write and the same auto-commit of `spec/roadmap.md` as the activated entry's removal — never as a separate write or commit. Successful activation MUST auto-commit the updated `spec/roadmap.md` via `autoCommitFile`, and in JSON mode the success output MUST identify the activated slug and include the `metta propose "<title>"` handoff message.

When the roadmap is empty, or when every entry is dangling, the command MUST be a non-error no-op: exit code 0, no write, no commit, and clear guidance in the output — the empty case MUST emit `{"next": null}` in JSON mode and an informative message in text mode; the all-dangling case MUST emit the per-entry warnings plus guidance on how to proceed (remove or restore the dangling entries) and MUST NOT mutate the roadmap even when `--prune` is passed, since no activation write occurs.

(Traces: US-1, US-4; supersedes ADR-4.)

### Scenario: Dangling head is skipped and the first healthy entry activates
- GIVEN the top roadmap entry `ghost` has no issue file `spec/issues/ghost.md` and the second entry `foo` references an existing backlog item titled "Foo feature"
- WHEN I run `metta roadmap next` on the main branch
- THEN the command warns about `ghost`, naming the slug and the remedies (`metta roadmap remove ghost` or restoring `spec/issues/ghost.md`), emits the `metta propose "Foo feature"` handoff, removes only the `foo` entry, leaves `ghost` in place at the top of `spec/roadmap.md`, auto-commits, and exits 0

### Scenario: Multiple consecutive dangling entries each warn and all remain
- GIVEN the roadmap's first two entries `ghost-a` and `ghost-b` are both dangling and the third entry `foo` is healthy
- WHEN I run `metta roadmap next` on the main branch
- THEN the output contains one warning for `ghost-a` and one for `ghost-b`, each naming its slug, `foo` is activated and removed, and both `ghost-a` and `ghost-b` remain in `spec/roadmap.md`

### Scenario: --prune removes skipped dangling entries in the same write and commit
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- WHEN I run `metta roadmap next --prune` on the main branch
- THEN `foo` is activated and `ghost-a`, `ghost-b`, and `foo` are all removed from `spec/roadmap.md` in a single write, the file is auto-committed exactly once for the operation, and the command exits 0

### Scenario: All-dangling roadmap is a non-error no-op with guidance
- GIVEN every entry on the roadmap is dangling
- WHEN I run `metta roadmap next --json`
- THEN the command exits 0 with no error envelope, emits the per-entry warnings and clear guidance to remove or restore the dangling entries, and `spec/roadmap.md` is byte-for-byte unchanged with no commit

### Scenario: Empty roadmap is a friendly no-op
- GIVEN the roadmap has no entries
- WHEN I run `metta roadmap next --json`, and again without `--json`
- THEN JSON mode emits `{"next": null}`, text mode prints an informative empty-roadmap message, both exit 0, and no write or commit occurs


## MODIFIED: Requirement: Roadmap failures use the standard error contract

All roadmap command failures MUST use the existing JSON error envelope `{error: {code, type, message}}` in JSON mode and a human-readable message on stderr in text mode, with exit code 4 for not-found, validation, and branch-guard failures — matching the backlog command group's behavior. The `type` field MUST be one of the established discriminators: `'not_found'` for unknown backlog slugs on `roadmap add` and for a `roadmap remove` target (position or slug) that matches no roadmap entry, `'branch_guard'` for main-branch rejections, and the roadmap-specific `'invalid_reorder'` and `'duplicate_entry'` for reorder and add validation failures. A dangling entry encountered by `roadmap next` is no longer a failure and MUST NOT produce the error envelope (see the modified `roadmap next` requirement). Failures that do not map to one of those four discriminators MUST fall back to the defensive `'roadmap_error'` type rather than escaping the envelope. A failing invocation MUST NOT leave a partially written `spec/roadmap.md`.

(Traces: US-1, US-2, US-4.)

### Scenario: Envelope shape is consistent across failure types
- GIVEN a project with a populated roadmap
- WHEN I trigger a not-found `add`, a duplicate `add`, an invalid `reorder`, a not-found `remove`, and an off-main mutation, each with `--json`
- THEN every failure output parses as JSON with a single top-level `error` object containing numeric `code: 4`, one of the `type` values `'not_found'`, `'duplicate_entry'`, `'invalid_reorder'`, or `'branch_guard'`, and a non-empty `message`, and every process exits with code 4

### Scenario: Text mode reports the same failures on stderr
- GIVEN no issue file `spec/issues/nope.md` exists
- WHEN I run `metta roadmap add nope` without `--json`
- THEN a human-readable not-found message is written to stderr and the process exits with code 4

### Scenario: Dangling entries no longer surface through the error contract on next
- GIVEN the top roadmap entry is dangling and a healthy entry sits below it
- WHEN I run `metta roadmap next --json`
- THEN the output contains no `error` envelope and the exit code is 0 — the dangling condition is reported via warnings and the skip signal instead


## MODIFIED: Requirement: Mutating roadmap operations enforce main-branch and auto-commit discipline

The mutating operations `roadmap add`, `roadmap reorder`, `roadmap remove`, and `roadmap next` MUST each call `assertOnMainBranch` from `src/cli/helpers.ts` against the configured main branch (`config.git.pr_base`, default `main`) before any validation of arguments against roadmap state and before any write, supporting the `--on-branch <name>` escape hatch exactly as `backlog add`/`backlog done` do. A rejected branch check MUST produce the JSON error envelope with `type: 'branch_guard'` and exit code 4, leaving `spec/roadmap.md` unchanged. Successful mutations MUST auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper and report the commit outcome; when git is unavailable or there is nothing to commit, the mutation MUST still succeed and report the not-committed reason, matching `autoCommitFile` semantics. The read-only default view MUST remain exempt from the branch check.

(Traces: US-2.)

### Scenario: Non-main branch blocks each mutation
- GIVEN I am on branch `feature-x` and do not pass `--on-branch`
- WHEN I run `metta roadmap add foo --json`, `metta roadmap reorder ... --json`, `metta roadmap remove foo --json`, and `metta roadmap next --json`
- THEN each command fails with the error envelope with `type: 'branch_guard'` and exit code 4, and `spec/roadmap.md` is unchanged; for `reorder` and `remove`, the guard rejection occurs before target validation

### Scenario: Escape hatch permits a deliberate off-main mutation
- GIVEN I am on branch `feature-x` and backlog item `foo` exists off-roadmap
- WHEN I run `metta roadmap add foo --on-branch feature-x`
- THEN the branch guard passes, the entry is appended, and `spec/roadmap.md` is auto-committed on the current branch


## ADDED: Requirement: roadmap remove deletes a targeted entry by position or slug

`metta roadmap remove <position|slug>` MUST delete a single roadmap entry addressed either by its 1-based position or by its slug, backed by a new `RoadmapStore.remove(target)` primitive — closing the lifecycle gap where retiring an entry required hand-editing the CLI-owned `spec/roadmap.md`. When the target matches no entry — a position outside `1..length` or a slug not on the roadmap — the command MUST fail with the JSON error envelope with `type: 'not_found'` and exit code 4 (via a typed discriminator on `RoadmapValidationError` mapped through `mapRoadmapError`), leaving `spec/roadmap.md` byte-for-byte unchanged. On success the store MUST splice the entry and persist through the existing canonical save path (`save` → `RoadmapSchema.parse` → `formatRoadmap`) so remaining entries are renumbered canonically, and the command MUST auto-commit `spec/roadmap.md` via `autoCommitFile`, reporting the removed slug and the commit outcome (`committed`, `commit_sha`) in JSON mode. `roadmap remove` MUST work identically for dangling and healthy entries and MUST NOT read or modify any file under `spec/issues/`.

(Traces: US-2; intent proposal §1.)

### Scenario: Remove by position renumbers through the canonical writer
- GIVEN the roadmap contains entries `a`, `foo`, `c` at positions 1–3
- WHEN I run `metta roadmap remove 2` on the main branch
- THEN the `foo` entry is removed, `spec/roadmap.md` lists `a` at position 1 and `c` at position 2 via the canonical format path, the file is auto-committed, and the command exits 0

### Scenario: Remove by slug deletes the matching entry
- GIVEN the roadmap contains a dangling entry with slug `ghost` (no `spec/issues/ghost.md`)
- WHEN I run `metta roadmap remove ghost` on the main branch
- THEN the `ghost` entry is removed and the file auto-committed even though the referenced issue file does not exist, and nothing under `spec/issues/` is touched

### Scenario: Missing target fails not_found with no write
- GIVEN the roadmap has 3 entries and none has slug `nope`
- WHEN I run `metta roadmap remove nope --json`, and then `metta roadmap remove 9 --json`
- THEN each invocation emits the error envelope with `type: 'not_found'` and exits with code 4, and `spec/roadmap.md` is byte-for-byte unchanged after both


## ADDED: Requirement: Issue resolution auto-retires referencing roadmap entries

After `metta backlog done <slug>` or `metta fix-issue --remove-issue <slug>` successfully archives an issue to `spec/issues/resolved/<slug>.md`, any roadmap entry referencing that slug MUST be removed from `spec/roadmap.md`, and the roadmap write MUST be included in the same commit as the issue archival (by extending the existing commit path lists — `commitPaths` for `backlog done`, the `git add` list for `fix-issue --remove-issue`), so the archive and the roadmap retirement land atomically and resolving a roadmapped item can never manufacture a dangling entry. When no roadmap entry references the resolved slug, both commands MUST behave exactly as before: no roadmap read side effects on the output, no roadmap write, and no additional commit content. The retirement MUST occur only after the archival itself succeeds — a failed resolution MUST NOT touch the roadmap. Any reporting of the retired roadmap entry in the commands' JSON output MUST be additive only: existing fields MUST be unchanged in name, shape, and meaning so current consumers are unaffected.

Cross-capability note: this narrows the issue-logging requirement "Backlog done resolves through the issue store archive" (which states the auto-commit stages exactly the two archive paths) and extends the fix-issues-command `--remove-issue` commit behavior — in the roadmapped case the commit additionally contains `spec/roadmap.md`; in the non-roadmapped case those specs' scenarios hold verbatim. The exact-two-paths discipline otherwise stands: unrelated dirty files are still never swept in.

(Traces: US-3; intent proposal §3.)

### Scenario: backlog done retires the roadmap entry atomically
- GIVEN an issue `foo` exists at `spec/issues/foo.md` and appears as a roadmap entry
- WHEN I run `metta backlog done foo`
- THEN `spec/issues/resolved/foo.md` exists, `spec/issues/foo.md` is gone, the `foo` roadmap entry is removed, and a single commit contains the archive pair and `spec/roadmap.md`

### Scenario: fix-issue --remove-issue retires the roadmap entry atomically
- GIVEN an issue `bar` exists and appears as a roadmap entry
- WHEN `metta fix-issue --remove-issue bar` runs
- THEN the issue is archived, the `bar` roadmap entry is removed, and `spec/roadmap.md` lands in the same commit as the issue archival

### Scenario: Non-roadmapped resolution is byte-for-byte unchanged behavior
- GIVEN an issue `baz` exists with no referencing roadmap entry
- WHEN I resolve it via `metta backlog done baz`, and (for a second such issue) via `fix-issue --remove-issue`
- THEN `spec/roadmap.md` is not written, the commit contains only the paths those commands commit today, and the command output matches today's contract

### Scenario: JSON reporting of the retirement is additive
- GIVEN a roadmapped issue is resolved via `metta backlog done <slug> --json`
- WHEN the command emits its JSON success output
- THEN every field present in today's output is still present with unchanged name, shape, and meaning, and any retired-roadmap-entry reporting appears only as new additional fields


## ADDED: Requirement: Skipped dangling entries are machine-detectable from roadmap next output

Because this change removes the exit-4 `not_found` fail-stop that automation could previously use to detect a dangling roadmap head (ADR-4), `metta roadmap next` MUST provide an explicit replacement signal in both output modes. In text mode, the per-entry warnings MUST name each skipped dangling slug on the command's output so scripts can detect dangling state by matching on the slug. In JSON mode, the success output MUST include a field enumerating the skipped dangling slugs in roadmap order (empty when nothing was skipped) and, when `--prune` is used, MUST distinguish which of the skipped entries were pruned. These JSON additions MUST be additive to the existing `roadmap next` success output — existing fields keep their name, shape, and meaning.

(Traces: US-4; intent Impact — replacement signal for automation relying on exit 4.)

### Scenario: JSON output enumerates skipped slugs in order
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- WHEN I run `metta roadmap next --json` on the main branch
- THEN the JSON success output identifies `foo` as activated and contains a field listing exactly `ghost-a` and `ghost-b` in roadmap order as skipped, and the existing activated-slug and handoff fields are unchanged in shape

### Scenario: Nothing skipped yields an empty skip signal
- GIVEN the top roadmap entry is healthy
- WHEN I run `metta roadmap next --json` on the main branch
- THEN the skipped-slugs field is present and empty, and the rest of the success output matches the pre-change contract

### Scenario: Text warnings name every skipped slug for script consumption
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above a healthy entry
- WHEN I run `metta roadmap next` without `--json`
- THEN the command's output contains the literal slugs `ghost-a` and `ghost-b`, one warning line per skipped entry, each including a remedy
