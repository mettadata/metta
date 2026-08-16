# UAT: rework-backlog-around-issue-store-as-single-source-truth

- **Change**: rework-backlog-around-issue-store-as-single-source-truth
- **Generated**: 2026-08-16
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Backlog an existing issue without duplicating it

*Independent test:* Running backlog add with an existing issue slug sets `backlog: true` in that issue's frontmatter without creating any new file under spec/backlog/ or spec/issues/, and the issue body is byte-identical afterward.

#### Step 1.1
- **Setup**: an issue exists at `spec/issues/<slug>.md` with no frontmatter `backlog` field
- **Do**: the user runs the backlog-add flow with that slug
- **Observe**: the same file gains `backlog: true` in its frontmatter and no second file is minted anywhere
- [ ] Pass

#### Step 1.2
- **Setup**: an issue already has `backlog: true`
- **Do**: the user backlogs it again
- **Observe**: the operation succeeds idempotently with no content change and a message noting it was already backlogged
- [ ] Pass

#### Step 1.3
- **Setup**: a backlogged issue later receives body edits (e.g. RCA findings)
- **Do**: the backlog is listed
- **Observe**: the listing reflects the single up-to-date issue file — there is no parallel copy to go stale
- [ ] Pass

### US-2: Capture a new idea as a typed issue entry

*Independent test:* Adding a non-issue idea via the backlog flow creates a file in spec/issues/ with frontmatter `type: idea` and `backlog: true`, and creates nothing under spec/backlog/.

#### Step 2.1
- **Setup**: no issue exists for a piece of future work
- **Do**: the user adds it through the backlog flow with a title and description
- **Observe**: a new entry is created in the issue store with `type: idea` and `backlog: true` frontmatter
- [ ] Pass

#### Step 2.2
- **Setup**: the new idea entry exists
- **Do**: the issue store is listed
- **Observe**: the idea appears alongside `type: issue` entries and is distinguishable by its type
- [ ] Pass

### US-3: Create milestones and assign issues to them

*Independent test:* Creating a milestone produces `spec/milestones/<slug>.md` with Zod-validated name/target/status frontmatter, and assigning an issue writes `milestone: <slug>` into that issue's frontmatter.

#### Step 3.1
- **Setup**: no milestone named v0.6 exists
- **Do**: the user creates milestone `v0-6` with a name and target
- **Observe**: `spec/milestones/v0-6.md` is written with `status: open` frontmatter and the description as body
- [ ] Pass

#### Step 3.2
- **Setup**: milestone `v0-6` exists and issue `<slug>` exists
- **Do**: the user assigns the issue to the milestone
- **Observe**: the issue's frontmatter gains `milestone: v0-6` and no content is copied between files
- [ ] Pass

#### Step 3.3
- **Setup**: an issue references a milestone slug that has no file
- **Do**: milestones or issues are listed
- **Observe**: a warning is emitted about the dangling reference and the command still succeeds
- [ ] Pass

### US-4: View milestone progress as resolved-vs-open rollup

*Independent test:* With N issues assigned to a milestone of which K live in spec/issues/resolved/, the milestone view and status/progress surfaces report K resolved of N total for that milestone.

#### Step 4.1
- **Setup**: a milestone with three assigned issues, one of which is in `spec/issues/resolved/`
- **Do**: the user views that milestone
- **Observe**: the output lists all three issues and reports 1 resolved / 2 open
- [ ] Pass

#### Step 4.2
- **Setup**: milestones with assigned issues exist
- **Do**: the user runs the status or progress skill
- **Observe**: per-milestone open/resolved rollups appear in the output
- [ ] Pass

#### Step 4.3
- **Setup**: a milestone with zero assigned issues
- **Do**: it is viewed
- **Observe**: the command succeeds and reports an empty issue list rather than failing
- [ ] Pass

### US-5: Backlog list as a sorted view over issue frontmatter

*Independent test:* Backlog list output contains exactly the issues with `backlog: true`, ordered by priority (high > medium > low), then numeric `order`, then captured date, and reads nothing from spec/backlog/.

#### Step 5.1
- **Setup**: issues with `backlog: true` carrying mixed priorities and order values
- **Do**: the user lists the backlog
- **Observe**: items appear sorted by priority first, order second, captured date third
- [ ] Pass

#### Step 5.2
- **Setup**: an issue with `backlog: true` and another without the field
- **Do**: the backlog is listed
- **Observe**: only the flagged issue appears
- [ ] Pass

#### Step 5.3
- **Setup**: a backlogged issue missing optional fields like priority or order
- **Do**: the backlog is listed
- **Observe**: the item still renders using sensible defaults instead of erroring
- [ ] Pass

### US-6: Promote a backlog item straight into fix-issues

*Independent test:* Promoting a backlogged issue routes into the fix-issues flow for that slug, and marking one done moves the file to spec/issues/resolved/ using the standard issue-resolution path.

#### Step 6.1
- **Setup**: a backlogged issue exists
- **Do**: the user promotes it
- **Observe**: the flow hands off to /metta-fix-issues with that issue slug and no duplicate change-tracking file is created
- [ ] Pass

#### Step 6.2
- **Setup**: a backlogged issue is finished outside a change
- **Do**: the user marks it done via the backlog flow
- **Observe**: the issue file is moved to `spec/issues/resolved/` and it disappears from the backlog list
- [ ] Pass

### US-7: Log an issue with milestone and priority in one step

*Independent test:* Logging an issue with --milestone and --priority produces an issue file whose frontmatter contains the given milestone slug and priority, validated by the Zod schema.

#### Step 7.1
- **Setup**: milestone `v0-6` exists
- **Do**: the user logs an issue with `--milestone v0-6 --priority high`
- **Observe**: the new issue file's frontmatter contains `milestone: v0-6` and `priority: high`
- [ ] Pass

#### Step 7.2
- **Setup**: the user passes an invalid priority value
- **Do**: the issue is logged
- **Observe**: validation rejects it with a clear error naming the allowed values (high|medium|low)
- [ ] Pass

### US-8: Migrate legacy backlog data idempotently

*Independent test:* After running the migration twice on a repo with active and done backlog items, every active item exists once as a `type: idea` issue with `backlog: true`, every done item exists once under spec/issues/resolved/, original content is preserved, spec/backlog/ is archived, and the second run makes zero changes.

#### Step 8.1
- **Setup**: a repo with items in `spec/backlog/` and `spec/backlog/done/`
- **Do**: the migration runs
- **Observe**: active items become `type: idea` issues with `backlog: true`, done items land in `spec/issues/resolved/`, and each file's descriptive content is preserved
- [ ] Pass

#### Step 8.2
- **Setup**: the migration has already run
- **Do**: it runs again
- **Observe**: no duplicate entries are created and the run reports nothing to do
- [ ] Pass

#### Step 8.3
- **Setup**: the migration completes
- **Do**: the user inspects the repo
- **Observe**: the old `spec/backlog/` directory is archived rather than silently deleted
- [ ] Pass

### US-9: Plain issues keep working unchanged

*Independent test:* An existing frontmatter-less issue file parses, lists, and resolves exactly as before the change, defaulting to `type: issue` and appearing in no backlog or milestone view.

#### Step 9.1
- **Setup**: a pre-existing issue file with only bold-label metadata and no YAML frontmatter
- **Do**: issues are listed or the issue is resolved
- **Observe**: the file is parsed successfully and treated as `type: issue` with no backlog or milestone membership
- [ ] Pass

#### Step 9.2
- **Setup**: frontmatter with only a subset of the new optional fields
- **Do**: the file is validated
- **Observe**: the Zod schema accepts it and fills documented defaults for the rest
- [ ] Pass

## Additional scenarios

#### Step 10.1: Partial frontmatter is accepted with documented defaults
- **Setup**: an issue file whose frontmatter contains only `backlog: true`
- **Do**: the issue store parses the file
- **Observe**: validation succeeds and the parsed record reports `type: issue` (default), `backlog: true`, and no priority, milestone, or order values
- [ ] Pass

#### Step 10.2: Invalid priority value is rejected with a clear error
- **Setup**: an issue file whose frontmatter contains `priority: urgent`
- **Do**: the issue store parses the file
- **Observe**: parsing fails with a validation error that names the `priority` field, cites the received value `urgent`, and lists the allowed values `high`, `medium`, `low`
- [ ] Pass

#### Step 10.3: Unknown frontmatter key is rejected
- **Setup**: an issue file whose frontmatter contains an unrecognized key `assignee: alice` alongside valid fields
- **Do**: the issue store parses the file
- **Observe**: parsing fails with a validation error identifying `assignee` as an unknown field rather than silently ignoring or persisting it
- [ ] Pass

#### Step 10.4: Legacy issue lists and resolves unchanged
- **Setup**: a pre-existing issue file at `spec/issues/<slug>.md` containing only a title, bold-label metadata, and a body — no `---` frontmatter block
- **Do**: issues are listed and the issue is subsequently resolved through the standard archive path
- **Observe**: the file parses successfully with its title and severity intact, the resolve completes exactly as before this change, and no frontmatter is added to the file as a side effect
- [ ] Pass

#### Step 10.5: Legacy issue is excluded from backlog and milestone views
- **Setup**: a frontmatter-less issue file exists alongside issues with `backlog: true` frontmatter
- **Do**: the backlog is listed and milestone rollups are computed
- **Observe**: the frontmatter-less issue appears in neither the backlog listing nor any milestone's issue set, and no warning or error is emitted for it
- [ ] Pass

#### Step 10.6: Existing issue gains backlog frontmatter with no new file
- **Setup**: an issue exists at `spec/issues/gate-runner-swallows-timeout.md` with no `backlog` frontmatter field, and a snapshot of its body bytes is taken
- **Do**: the user runs `metta backlog add gate-runner-swallows-timeout --priority high` (Run: `metta backlog add gate-runner-swallows-timeout --priority high`)
- **Observe**: the same file's frontmatter now contains `backlog: true` and `priority: high`, the body below the frontmatter is byte-identical to the snapshot, and no file was created under `spec/backlog/` or as a second entry in `spec/issues/`
- [ ] Pass

#### Step 10.7: Re-backlogging is an idempotent no-op
- **Setup**: an issue whose frontmatter already contains `backlog: true`
- **Do**: the user runs `metta backlog add <slug>` for it again with no new option values
- **Observe**: the command exits 0, the file content is unchanged, and the output states the issue was already backlogged
- [ ] Pass

#### Step 10.8: Later body edits never drift from the backlog
- **Setup**: a backlogged issue whose body is later extended with RCA findings
- **Do**: the backlog is listed
- **Observe**: the listing is computed from the single up-to-date issue file — there is no parallel copy under `spec/backlog/` capable of going stale
- [ ] Pass

#### Step 10.9: New idea minted with idea type and backlog flag
- **Setup**: no issue exists for "dashboard status widget"
- **Do**: the user runs `metta backlog add "dashboard status widget" --new --description "Build a status widget" --priority low` (Run: `metta backlog add "dashboard status widget" --new --description "Build a status widget" --priority low`)
- **Observe**: a new file is created at `spec/issues/dashboard-status-widget.md` with frontmatter `type: idea`, `backlog: true`, `priority: low`, the description as body, and nothing is created under `spec/backlog/`
- [ ] Pass

#### Step 10.10: Mistyped slug without --new fails instead of minting
- **Setup**: no issue exists with slug `gate-runner-swalows-timeout` (typo)
- **Do**: the user runs `metta backlog add gate-runner-swalows-timeout` without `--new` (Run: `metta backlog add gate-runner-swalows-timeout`)
- **Observe**: the command exits with code 4, names the unresolved slug, suggests passing `--new` to capture a new idea, and creates no file
- [ ] Pass

#### Step 10.11: Idea entries are distinguishable in issue listings
- **Setup**: an idea entry and a plain issue both exist in `spec/issues/`
- **Do**: the issue store is listed
- **Observe**: both entries appear and the idea is identifiable as `type: idea` in the listing output
- [ ] Pass

#### Step 10.12: Mixed priorities and orders sort deterministically
- **Setup**: backlogged issues A (`priority: low`, `order: 1`), B (`priority: high`, `order: 2`), C (`priority: high`, `order: 1`), and D (`backlog: true` with no priority or order)
- **Do**: the user runs `metta backlog list` (Run: `metta backlog list`)
- **Observe**: the output order is C, B, A, D — priority buckets first, `order` ascending within a bucket, priority-less entries last
- [ ] Pass

#### Step 10.13: Only flagged issues appear and spec/backlog/ is never read
- **Setup**: one issue with `backlog: true`, one issue with no `backlog` field, and a leftover legacy file under `spec/backlog/`
- **Do**: the user runs `metta backlog list` (Run: `metta backlog list`)
- **Observe**: exactly the flagged issue appears; the unflagged issue is absent and the `spec/backlog/` file contributes nothing to the output
- [ ] Pass

#### Step 10.14: Missing optional fields render with defaults
- **Setup**: a backlogged issue whose frontmatter is only `backlog: true`
- **Do**: the backlog is listed
- **Observe**: the entry renders successfully with a "no priority" presentation instead of erroring
- [ ] Pass

#### Step 10.15: Promote emits a fix-issues handoff
- **Setup**: a backlogged issue exists at `spec/issues/gate-runner-swallows-timeout.md`
- **Do**: the user runs `metta backlog promote gate-runner-swallows-timeout` (Run: `metta backlog promote gate-runner-swallows-timeout`)
- **Observe**: the output (text and `--json`) instructs the caller to run `/metta-fix-issues gate-runner-swallows-timeout`, no reference to `/metta-propose` appears, and no file is created or modified
- [ ] Pass

#### Step 10.16: Promoting an unknown slug fails cleanly
- **Setup**: no issue exists with slug `nonexistent-item`
- **Do**: the user runs `metta backlog promote nonexistent-item` (Run: `metta backlog promote nonexistent-item`)
- **Observe**: the command exits with code 4 and reports the slug as not found
- [ ] Pass

#### Step 10.17: Done moves the issue to resolved and off the backlog
- **Setup**: a backlogged issue exists at `spec/issues/<slug>.md` with frontmatter `backlog: true` and `type: idea`
- **Do**: the user runs `metta backlog done <slug>` (Run: `metta backlog list`)
- **Observe**: `spec/issues/resolved/<slug>.md` exists with the frontmatter (`type: idea`, `backlog: true`) intact, `spec/issues/<slug>.md` is gone, nothing was written under `spec/backlog/done/`, and the slug no longer appears in `metta backlog list`
- [ ] Pass

#### Step 10.18: Shipped-in stamp survives the new archive path
- **Setup**: a backlogged issue exists
- **Do**: the user runs `metta backlog done <slug> --change some-shipped-change`
- **Observe**: the archived copy at `spec/issues/resolved/<slug>.md` contains the `**Shipped-in**: some-shipped-change` stamp in addition to its preserved frontmatter
- [ ] Pass

#### Step 10.19: Milestone created with defaults
- **Setup**: no milestone `v0-6` exists
- **Do**: the user runs `metta milestone create v0-6 --name "v0.6" --target 2026-09-30 --description "Backlog/milestone unification release"` (Run: `metta milestone create v0-6 --name "v0.6" --target 2026-09-30 --description "Backlog/milestone unification release"`, `metta milestone list`)
- **Observe**: `spec/milestones/v0-6.md` is written with frontmatter `name: v0.6`, `target: 2026-09-30`, `status: open`, the description as body, and `metta milestone list` includes `v0-6`
- [ ] Pass

#### Step 10.20: Creating a duplicate milestone is refused
- **Setup**: `spec/milestones/v0-6.md` already exists
- **Do**: the user runs `metta milestone create v0-6 --name "v0.6 again"` (Run: `metta milestone create v0-6 --name "v0.6 again"`)
- **Observe**: the command exits non-zero with an error stating the milestone already exists, and the existing file is unmodified
- [ ] Pass

#### Step 10.21: Invalid milestone status is rejected
- **Setup**: a milestone file whose frontmatter contains `status: shipped`
- **Do**: the milestone store reads the file
- **Observe**: validation fails with an error naming the `status` field and the allowed values `open`, `closed`
- [ ] Pass

#### Step 10.22: Log an issue with milestone and priority in one step
- **Setup**: milestone `v0-6` exists
- **Do**: the user logs an issue with `--milestone v0-6 --priority high`
- **Observe**: the new issue file's frontmatter contains `milestone: v0-6` and `priority: high`, and the file passes issue frontmatter schema validation
- [ ] Pass

#### Step 10.23: Invalid priority at log time is rejected
- **Setup**: the user passes `--priority urgent` when logging an issue
- **Do**: the command validates its options
- **Observe**: it exits non-zero with an error naming the allowed values `high`, `medium`, `low`, and no issue file is created
- [ ] Pass

#### Step 10.24: Dangling milestone reference warns but succeeds
- **Setup**: an issue's frontmatter contains `milestone: v9-9` and no `spec/milestones/v9-9.md` exists
- **Do**: milestones or issues are listed
- **Observe**: a warning identifying the dangling `v9-9` reference is emitted and the command exits 0 with complete output
- [ ] Pass

#### Step 10.25: Rollup counts resolved against open
- **Setup**: milestone `v0-6` has three assigned issues, one of which lives in `spec/issues/resolved/`
- **Do**: the user runs `metta milestone show v0-6` (Run: `metta milestone show v0-6`)
- **Observe**: the output lists all three issues, reports 1 resolved / 2 open of 3 total, and shows 33% complete
- [ ] Pass

#### Step 10.26: Empty milestone renders without failing
- **Setup**: milestone `v0-7` exists with no issues assigned to it
- **Do**: the user runs `metta milestone show v0-7` (Run: `metta milestone show v0-7`)
- **Observe**: the command exits 0 and reports an empty issue list with 0 resolved / 0 open
- [ ] Pass

#### Step 10.27: Progress shows per-milestone counts
- **Setup**: milestones `v0-6` (2 open, 1 resolved) and `v0-7` (1 open, 0 resolved) exist with assigned issues
- **Do**: the user runs the status or progress surface
- **Observe**: the output contains a milestone rollup listing `v0-6` with 2 open / 1 resolved and `v0-7` with 1 open / 0 resolved
- [ ] Pass

#### Step 10.28: No milestones means no milestone section
- **Setup**: `spec/milestones/` does not exist or contains no milestone files
- **Do**: the user runs `metta status` (Run: `metta status`)
- **Observe**: the output contains no milestone rollup section and the remaining sections match pre-change behavior
- [ ] Pass

#### Step 10.29: Active and done items convert with content preserved
- **Setup**: a repo with two items in `spec/backlog/` (one carrying `**Priority**: high`) and one item in `spec/backlog/done/`
- **Do**: the user runs `metta backlog migrate` (Run: `metta backlog migrate`)
- **Observe**: each active item exists as `spec/issues/<slug>.md` with frontmatter `type: idea`, `backlog: true` (and `priority: high` where the legacy priority was set), the done item exists as `spec/issues/resolved/<slug>.md` with `type: idea`, every file's descriptive body is preserved, and the old `spec/backlog/` directory is archived out of the active spec tree
- [ ] Pass

#### Step 10.30: Second run is a no-op
- **Setup**: the migration has already completed on a repo
- **Do**: `metta backlog migrate` runs again (Run: `metta backlog migrate`)
- **Observe**: no files are created, modified, or moved, the command reports nothing to do, and it exits 0
- [ ] Pass

#### Step 10.31: Slug collision is reported, not overwritten
- **Setup**: `spec/backlog/dark-mode.md` and a pre-existing `spec/issues/dark-mode.md` both exist
- **Do**: the migration runs
- **Observe**: `spec/issues/dark-mode.md` is left byte-identical, the collision is reported naming the slug, and the legacy backlog file is not silently discarded
- [ ] Pass

#### Step 10.32: Targeted frontmatter update leaves everything else intact
- **Setup**: an issue file with frontmatter `type: idea`, `priority: medium`, `milestone: v0-6` and a body containing structured RCA sections, with a byte snapshot taken of the body
- **Do**: `metta backlog add <slug> --order 3` updates the file
- **Observe**: the frontmatter now additionally contains `backlog: true` and `order: 3`, the values and relative order of `type`, `priority`, and `milestone` are unchanged, and the body is byte-identical to the snapshot
- [ ] Pass

#### Step 10.33: Archive preserves frontmatter end to end
- **Setup**: an open issue with frontmatter `backlog: true`, `milestone: v0-6`
- **Do**: the issue is resolved through the standard issue archive path
- **Observe**: `spec/issues/resolved/<slug>.md` contains the identical frontmatter block, keeping the issue countable in `v0-6`'s resolved rollup
- [ ] Pass
