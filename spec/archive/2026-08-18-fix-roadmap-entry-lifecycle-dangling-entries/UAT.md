# UAT: fix-roadmap-entry-lifecycle-dangling-entries

- **Change**: fix-roadmap-entry-lifecycle-dangling-entries
- **Generated**: 2026-08-18
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Activate the next roadmap entry despite dangling heads

*Independent test:* With a roadmap whose head entries reference archived issues and a healthy entry below them, `metta roadmap next` activates the first healthy entry, warns per skipped slug with a remedy, leaves the dangling entries in place, and exits successfully.

#### Step 1.1
- **Setup**: a roadmap whose top entry references an archived (resolved) issue and whose second entry references a live issue
- **Do**: the operator runs `metta roadmap next` (Run: `metta roadmap next`)
- **Observe**: the command warns about the dangling top entry — naming its slug and the remedies (`metta roadmap remove <slug>` or restoring `spec/issues/<slug>.md`) — activates the second entry, and removes only the activated entry from the roadmap
- [ ] Pass

#### Step 1.2
- **Setup**: multiple consecutive dangling entries at the head of the roadmap
- **Do**: the operator runs `metta roadmap next` (Run: `metta roadmap next`)
- **Observe**: each dangling entry produces its own warning, all dangling entries remain in the roadmap file, and the first healthy entry is activated
- [ ] Pass

#### Step 1.3
- **Setup**: dangling entries above a healthy entry
- **Do**: the operator runs `metta roadmap next --prune` (Run: `metta roadmap next --prune`)
- **Observe**: the skipped dangling entries are removed alongside the activated entry in the same write and commit of `spec/roadmap.md`
- [ ] Pass

#### Step 1.4
- **Setup**: a roadmap where every entry is dangling, or an empty roadmap
- **Do**: the operator runs `metta roadmap next` (Run: `metta roadmap next`)
- **Observe**: the command completes as a non-error no-op with clear guidance on how to proceed (no exit-4 failure, no roadmap mutation)
- [ ] Pass

### US-2: Remove a roadmap entry with a single command

*Independent test:* `metta roadmap remove` deletes the targeted entry by 1-based position or by slug, renumbers and commits `spec/roadmap.md` through the canonical writer, and fails with a typed `not_found` error (exit 4) when the target does not exist.

#### Step 2.1
- **Setup**: a roadmap containing an entry with slug `foo` at position 2
- **Do**: the operator runs `metta roadmap remove 2` or `metta roadmap remove foo` (Run: `metta roadmap remove 2`, `metta roadmap remove foo`)
- **Observe**: the entry is removed, remaining entries are renumbered through the canonical save path, and the change to `spec/roadmap.md` is auto-committed
- [ ] Pass

#### Step 2.2
- **Setup**: a roadmap that contains no entry matching the given position or slug
- **Do**: the operator runs `metta roadmap remove <target>`
- **Observe**: the command fails with a typed `not_found` error in the standard exit-4 error envelope and the roadmap file is unchanged
- [ ] Pass

#### Step 2.3
- **Setup**: the repository is on the main branch (or otherwise guarded, consistent with other mutating roadmap subcommands)
- **Do**: the operator runs `metta roadmap remove <target>` (Run: `roadmap add`, `roadmap reorder`)
- **Observe**: the main-branch guard applies exactly as it does for `roadmap add` and `roadmap reorder`
- [ ] Pass

### US-3: Roadmap entries retire themselves when their issue is resolved

*Independent test:* Resolving a roadmapped issue via `backlog done` or `fix-issue --remove-issue` archives the issue and removes its roadmap entry in the same commit; resolving a non-roadmapped issue leaves the roadmap and existing behavior untouched.

#### Step 3.1
- **Setup**: an issue slug that appears as a roadmap entry
- **Do**: the operator resolves it via `metta backlog done <slug>`
- **Observe**: the issue is archived to `spec/issues/resolved/` and the referencing roadmap entry is removed, with `spec/roadmap.md` included in the same commit as the archive
- [ ] Pass

#### Step 3.2
- **Setup**: an issue slug that appears as a roadmap entry
- **Do**: it is resolved via `fix-issue --remove-issue` (Run: `fix-issue --remove-issue`)
- **Observe**: the roadmap entry is removed and `spec/roadmap.md` lands in the same commit as the issue archival
- [ ] Pass

#### Step 3.3
- **Setup**: an issue slug with no referencing roadmap entry
- **Do**: it is resolved via either path
- **Observe**: behavior is identical to today — no roadmap write, no extra commit content
- [ ] Pass

#### Step 3.4
- **Setup**: a roadmapped issue is resolved and retired
- **Do**: the command emits its JSON output
- **Observe**: any reporting of the retired roadmap entry is additive (existing fields and consumers are unaffected)
- [ ] Pass

### US-4: Clear replacement signal for automation that relied on the fail-stop

*Independent test:* The warning output of `roadmap next` identifies every skipped dangling slug and its remedy, and the updated roadmap-feature spec formally supersedes ADR-4's fail-stop requirement.

#### Step 4.1
- **Setup**: a roadmap with dangling entries
- **Do**: `metta roadmap next` runs (Run: `metta roadmap next`)
- **Observe**: the output contains one warning per skipped entry naming the slug and the available remedies, so scripts and operators can detect dangling state from the output
- [ ] Pass

#### Step 4.2
- **Setup**: the roadmap-feature spec previously mandated exit-4 `not_found` on a dangling top entry (ADR-4)
- **Do**: this change ships
- **Observe**: the spec delta records the skip-with-warning behavior as formally superseding ADR-4, so the contract change is traceable rather than an undocumented drift
- [ ] Pass

## Additional scenarios

#### Step 5.1: Dangling head is skipped and the first healthy entry activates
- **Setup**: the top roadmap entry `ghost` has no issue file `spec/issues/ghost.md` and the second entry `foo` references an existing backlog item titled "Foo feature"
- **Do**: I run `metta roadmap next` on the main branch (Run: `metta roadmap next`, `metta roadmap remove ghost`)
- **Observe**: the command warns about `ghost`, naming the slug and the remedies (`metta roadmap remove ghost` or restoring `spec/issues/ghost.md`), emits the `metta propose "Foo feature"` handoff, removes only the `foo` entry, leaves `ghost` in place at the top of `spec/roadmap.md`, auto-commits, and exits 0
- [ ] Pass

#### Step 5.2: Multiple consecutive dangling entries each warn and all remain
- **Setup**: the roadmap's first two entries `ghost-a` and `ghost-b` are both dangling and the third entry `foo` is healthy
- **Do**: I run `metta roadmap next` on the main branch (Run: `metta roadmap next`)
- **Observe**: the output contains one warning for `ghost-a` and one for `ghost-b`, each naming its slug, `foo` is activated and removed, and both `ghost-a` and `ghost-b` remain in `spec/roadmap.md`
- [ ] Pass

#### Step 5.3: --prune removes skipped dangling entries in the same write and commit
- **Setup**: dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- **Do**: I run `metta roadmap next --prune` on the main branch (Run: `metta roadmap next --prune`)
- **Observe**: `foo` is activated and `ghost-a`, `ghost-b`, and `foo` are all removed from `spec/roadmap.md` in a single write, the file is auto-committed exactly once for the operation, and the command exits 0
- [ ] Pass

#### Step 5.4: All-dangling roadmap is a non-error no-op with guidance
- **Setup**: every entry on the roadmap is dangling
- **Do**: I run `metta roadmap next --json` (Run: `metta roadmap next --json`)
- **Observe**: the command exits 0 with no error envelope, emits the per-entry warnings and clear guidance to remove or restore the dangling entries, and `spec/roadmap.md` is byte-for-byte unchanged with no commit
- [ ] Pass

#### Step 5.5: Empty roadmap is a friendly no-op
- **Setup**: the roadmap has no entries
- **Do**: I run `metta roadmap next --json`, and again without `--json` (Run: `metta roadmap next --json`)
- **Observe**: JSON mode emits `{"next": null}`, text mode prints an informative empty-roadmap message, both exit 0, and no write or commit occurs
- [ ] Pass

#### Step 5.6: Envelope shape is consistent across failure types
- **Setup**: a project with a populated roadmap
- **Do**: I trigger a not-found `add`, a duplicate `add`, an invalid `reorder`, a not-found `remove`, and an off-main mutation, each with `--json`
- **Observe**: every failure output parses as JSON with a single top-level `error` object containing numeric `code: 4`, one of the `type` values `'not_found'`, `'duplicate_entry'`, `'invalid_reorder'`, or `'branch_guard'`, and a non-empty `message`, and every process exits with code 4
- [ ] Pass

#### Step 5.7: Text mode reports the same failures on stderr
- **Setup**: no issue file `spec/issues/nope.md` exists
- **Do**: I run `metta roadmap add nope` without `--json` (Run: `metta roadmap add nope`)
- **Observe**: a human-readable not-found message is written to stderr and the process exits with code 4
- [ ] Pass

#### Step 5.8: Dangling entries no longer surface through the error contract on next
- **Setup**: the top roadmap entry is dangling and a healthy entry sits below it
- **Do**: I run `metta roadmap next --json` (Run: `metta roadmap next --json`)
- **Observe**: the output contains no `error` envelope and the exit code is 0 — the dangling condition is reported via warnings and the skip signal instead
- [ ] Pass

#### Step 5.9: Non-main branch blocks each mutation
- **Setup**: I am on branch `feature-x` and do not pass `--on-branch`
- **Do**: I run `metta roadmap add foo --json`, `metta roadmap reorder ... --json`, `metta roadmap remove foo --json`, and `metta roadmap next --json` (Run: `metta roadmap add foo --json`, `metta roadmap reorder ... --json`)
- **Observe**: each command fails with the error envelope with `type: 'branch_guard'` and exit code 4, and `spec/roadmap.md` is unchanged; for `reorder` and `remove`, the guard rejection occurs before target validation
- [ ] Pass

#### Step 5.10: Escape hatch permits a deliberate off-main mutation
- **Setup**: I am on branch `feature-x` and backlog item `foo` exists off-roadmap
- **Do**: I run `metta roadmap add foo --on-branch feature-x` (Run: `metta roadmap add foo --on-branch feature-x`)
- **Observe**: the branch guard passes, the entry is appended, and `spec/roadmap.md` is auto-committed on the current branch
- [ ] Pass

#### Step 5.11: Remove by position renumbers through the canonical writer
- **Setup**: the roadmap contains entries `a`, `foo`, `c` at positions 1–3
- **Do**: I run `metta roadmap remove 2` on the main branch (Run: `metta roadmap remove 2`)
- **Observe**: the `foo` entry is removed, `spec/roadmap.md` lists `a` at position 1 and `c` at position 2 via the canonical format path, the file is auto-committed, and the command exits 0
- [ ] Pass

#### Step 5.12: Remove by slug deletes the matching entry
- **Setup**: the roadmap contains a dangling entry with slug `ghost` (no `spec/issues/ghost.md`)
- **Do**: I run `metta roadmap remove ghost` on the main branch (Run: `metta roadmap remove ghost`)
- **Observe**: the `ghost` entry is removed and the file auto-committed even though the referenced issue file does not exist, and nothing under `spec/issues/` is touched
- [ ] Pass

#### Step 5.13: Missing target fails not_found with no write
- **Setup**: the roadmap has 3 entries and none has slug `nope`
- **Do**: I run `metta roadmap remove nope --json`, and then `metta roadmap remove 9 --json` (Run: `metta roadmap remove nope --json`, `metta roadmap remove 9 --json`)
- **Observe**: each invocation emits the error envelope with `type: 'not_found'` and exits with code 4, and `spec/roadmap.md` is byte-for-byte unchanged after both
- [ ] Pass

#### Step 5.14: backlog done retires the roadmap entry atomically
- **Setup**: an issue `foo` exists at `spec/issues/foo.md` and appears as a roadmap entry
- **Do**: I run `metta backlog done foo` (Run: `metta backlog done foo`)
- **Observe**: `spec/issues/resolved/foo.md` exists, `spec/issues/foo.md` is gone, the `foo` roadmap entry is removed, and a single commit contains the archive pair and `spec/roadmap.md`
- [ ] Pass

#### Step 5.15: fix-issue --remove-issue retires the roadmap entry atomically
- **Setup**: an issue `bar` exists and appears as a roadmap entry
- **Do**: `metta fix-issue --remove-issue bar` runs (Run: `metta fix-issue --remove-issue bar`)
- **Observe**: the issue is archived, the `bar` roadmap entry is removed, and `spec/roadmap.md` lands in the same commit as the issue archival
- [ ] Pass

#### Step 5.16: Non-roadmapped resolution is byte-for-byte unchanged behavior
- **Setup**: an issue `baz` exists with no referencing roadmap entry
- **Do**: I resolve it via `metta backlog done baz`, and (for a second such issue) via `fix-issue --remove-issue` (Run: `metta backlog done baz`, `fix-issue --remove-issue`)
- **Observe**: `spec/roadmap.md` is not written, the commit contains only the paths those commands commit today, and the command output matches today's contract
- [ ] Pass

#### Step 5.17: JSON reporting of the retirement is additive
- **Setup**: a roadmapped issue is resolved via `metta backlog done <slug> --json`
- **Do**: the command emits its JSON success output
- **Observe**: every field present in today's output is still present with unchanged name, shape, and meaning, and any retired-roadmap-entry reporting appears only as new additional fields
- [ ] Pass

#### Step 5.18: JSON output enumerates skipped slugs in order
- **Setup**: dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- **Do**: I run `metta roadmap next --json` on the main branch (Run: `metta roadmap next --json`)
- **Observe**: the JSON success output identifies `foo` as activated and contains a field listing exactly `ghost-a` and `ghost-b` in roadmap order as skipped, and the existing activated-slug and handoff fields are unchanged in shape
- [ ] Pass

#### Step 5.19: Nothing skipped yields an empty skip signal
- **Setup**: the top roadmap entry is healthy
- **Do**: I run `metta roadmap next --json` on the main branch (Run: `metta roadmap next --json`)
- **Observe**: the skipped-slugs field is present and empty, and the rest of the success output matches the pre-change contract
- [ ] Pass

#### Step 5.20: Text warnings name every skipped slug for script consumption
- **Setup**: dangling entries `ghost-a` and `ghost-b` sit above a healthy entry
- **Do**: I run `metta roadmap next` without `--json` (Run: `metta roadmap next`)
- **Observe**: the command's output contains the literal slugs `ghost-a` and `ghost-b`, one warning line per skipped entry, each including a remedy
- [ ] Pass
