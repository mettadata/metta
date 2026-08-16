Gate: scenarios — PASS

# Scenario verification — rework-backlog-around-issue-store-as-single-source-truth

Every Given/When/Then scenario in `spec/changes/rework-backlog-around-issue-store-as-single-source-truth/spec.md` (13 requirements, 33 scenarios) was mapped to a covering test or on-disk migration evidence. 10 targeted `npx vitest run <file> -t '<name>'` spot-checks were executed; all passed (marked ✓run below). All other cited tests were located by exact test name in the named files.

## Requirement 1: Issue frontmatter schema is Zod-validated and strict

| Scenario | Evidence | Status |
|---|---|---|
| Partial frontmatter accepted with documented defaults | `tests/issue-frontmatter.test.ts:177` — "applies partial-frontmatter defaults: backlog only → type defaults to issue"; also `:93` "parses a valid block and applies defaults", `src/issues/issues-store.test.ts:159` "accepts partial frontmatter with defaults applied" | PASS ✓run |
| Invalid priority rejected with clear error | `tests/issue-frontmatter.test.ts:163` — "renders enum errors naming the field, received value, and allowed values" (uses `priority: urgent`, asserts field, received value, allowed high/medium/low) | PASS ✓run |
| Unknown frontmatter key rejected | `tests/issue-frontmatter.test.ts:158` — "rejects unknown keys via strict Zod" | PASS |

## Requirement 2: Frontmatter-less issue files parse exactly as before

| Scenario | Evidence | Status |
|---|---|---|
| Legacy issue lists and resolves unchanged | `src/issues/issues-store.test.ts:70` — "parses legacy files byte-unchanged with type issue / backlog false defaults"; `:94` — "legacy archive + remove flow is unchanged (verbatim copy, no stamp)" | PASS |
| Legacy issue excluded from backlog and milestone views | `tests/backlog-view.test.ts:38` — "excludes frontmatter-less legacy records (backlog defaults false)"; `tests/milestone-rollup.test.ts:113` — "ignores milestone-less records with no bucket and no warning" | PASS |

## Requirement 3: Backlogging an issue mutates the existing issue file in place

| Scenario | Evidence | Status |
|---|---|---|
| Existing issue gains backlog frontmatter with no new file | `tests/cli-issue-backlog.test.ts:295` — "existing issue slug is backlogged via frontmatter" (asserts frontmatter written, no `spec/backlog/` file); body byte-preservation at `tests/issue-frontmatter.test.ts:190,218` and `src/issues/issues-store.test.ts:301` | PASS ✓run |
| Re-backlogging is an idempotent no-op | `tests/cli-issue-backlog.test.ts:318` — "re-adding an already backlogged slug reports already_backlogged with exit 0"; `src/issues/issues-store.test.ts:314` — "is idempotent: identical patch returns changed false and leaves the file untouched" | PASS |
| Later body edits never drift from the backlog | `tests/cli-issue-backlog.test.ts:411` — "lists only backlog entries sorted by priority; never reads spec/backlog/" (list is computed from `spec/issues/` frontmatter; a leftover `spec/backlog/` file contributes nothing); BacklogStore mint path removal is architectural — no standalone mint remains | PASS |

## Requirement 4: New ideas are minted as typed entries in the issue store

| Scenario | Evidence | Status |
|---|---|---|
| New idea minted with idea type and backlog flag | `tests/cli-issue-backlog.test.ts:260` — "--new mints a type: idea entry in spec/issues/ with backlog frontmatter"; `:283` — "--new --description populates the body; omitted description defaults to title"; `src/issues/issues-store.test.ts:199` — "mints a type idea / backlog true entry above a standard issue body" | PASS |
| Mistyped slug without --new fails instead of minting | `tests/cli-issue-backlog.test.ts:330` — "unresolved slug without --new exits 4 naming the slug and suggesting --new" | PASS ✓run |
| Idea entries distinguishable in issue listings | `tests/cli-issue-backlog.test.ts:70` — "issues list marks type: idea rows and JSON carries the record fields" | PASS |

## Requirement 5: Backlog list is a sorted view over issue frontmatter

| Scenario | Evidence | Status |
|---|---|---|
| Mixed priorities and orders sort deterministically (C, B, A, D) | `tests/backlog-view.test.ts:88` — "orders the spec scenario deterministically: C, B, A, D"; supporting `:98,:108,:117` | PASS ✓run |
| Only flagged issues appear; spec/backlog/ never read | `tests/cli-issue-backlog.test.ts:411` — "lists only backlog entries sorted by priority; never reads spec/backlog/"; `tests/backlog-view.test.ts:26` — "selects exactly the records with backlog === true, any type" | PASS |
| Missing optional fields render with defaults | `tests/backlog-view.test.ts:45` — "renders defaults: backlog-only frontmatter yields a valid entry without priority or order" | PASS |

## Requirement 6: Backlog promote hands off to fix-issues

| Scenario | Evidence | Status |
|---|---|---|
| Promote emits a fix-issues handoff | `tests/cli-issue-backlog.test.ts:491` — "emits the fix-issues handoff and performs zero writes" | PASS |
| Promoting an unknown slug fails cleanly | `tests/cli-issue-backlog.test.ts:512` — "unknown slug exits 4 with not_found" | PASS |

## Requirement 7: Backlog done resolves through the issue store archive

| Scenario | Evidence | Status |
|---|---|---|
| Done moves the issue to resolved and off the backlog | `tests/cli-issue-backlog.test.ts:523` — "happy path — archives to spec/issues/resolved/, --json reports archived slug"; `:571` — "commits archive with conventional message staging spec/issues and spec/issues/resolved" | PASS |
| Shipped-in stamp survives the new archive path | `tests/cli-issue-backlog.test.ts:536` — "--change stamps Shipped-in metadata and preserves frontmatter in the archived file"; `src/issues/issues-store.test.ts:383` — "appends the Shipped-in stamp after the body when changeName is given" | PASS |

## Requirement 8: Milestone store with Zod-validated frontmatter and CLI

| Scenario | Evidence | Status |
|---|---|---|
| Milestone created with defaults | `tests/milestones-store.test.ts:25` — "round-trips create/show/exists with all fields"; `:44` — "creates with defaults: status open, empty description, no target key"; `tests/cli-milestone.test.ts:50,:68` | PASS |
| Creating a duplicate milestone is refused | `tests/milestones-store.test.ts:71` — "refuses duplicate create and leaves the existing file unmodified"; `tests/cli-milestone.test.ts:78` — "duplicate create exits 4 with milestone_exists" | PASS |
| Invalid milestone status is rejected | `tests/milestones-store.test.ts:84` — "rejects invalid status naming the allowed values open/closed"; malformed target: `:93,:98` | PASS |
| (guard registration clause) milestone create Tier 2; list/show read-only permitted | `tests/cli-metta-guard-bash-integration.test.ts:527-604` — "allows read-only `metta milestone list`/`show` without any credential — exit 0"; "blocks uncredentialed `metta milestone create v0.6` — exit 2"; "mint hook scope for metta-backlog grants backlog:add/done/promote/migrate and milestone:create" | PASS ✓run |

## Requirement 9: Milestone and priority assignment via issue frontmatter

| Scenario | Evidence | Status |
|---|---|---|
| Log an issue with milestone and priority in one step | `tests/cli-issue-backlog.test.ts:51` — "--milestone with an existing milestone writes frontmatter without a warning"; `:29` — "--priority writes a priority frontmatter field"; `src/issues/issues-store.test.ts:172` — "writes priority and milestone as a frontmatter block" | PASS |
| Invalid priority at log time rejected | `tests/cli-issue-backlog.test.ts:38` — "invalid --priority exits 4 naming allowed values and creates no file" | PASS |
| Dangling milestone reference warns but succeeds | `tests/cli-issue-backlog.test.ts:62` — "dangling --milestone warns on stderr but still creates the issue"; `tests/cli-milestone.test.ts:144` — "surfaces dangling milestone references as warnings with exit 0"; `tests/milestone-rollup.test.ts:97` — "warns (never fails) on a dangling milestone reference, naming issue and slug" | PASS |

## Requirement 10: Milestone show reports resolved-vs-open progress

| Scenario | Evidence | Status |
|---|---|---|
| Rollup counts resolved against open (1/2 of 3, 33%) | `tests/milestone-rollup.test.ts:27` — "buckets open and resolved records into the referenced milestone"; `:54` — "rounds percent to a whole number (1 of 3 → 33)"; `tests/cli-milestone.test.ts:177,:204` (show JSON/text with states and progress) | PASS |
| Empty milestone renders without failing | `tests/cli-milestone.test.ts:218` — "zero-issue milestone exits 0 with empty issues and 0/0 at 0%"; `tests/milestone-rollup.test.ts:78` — "rolls up an empty milestone as 0/0/0 at 0% without failing"; not-found clause: `tests/cli-milestone.test.ts:231` | PASS ✓run |

## Requirement 11: Status and progress surfaces include milestone rollups

| Scenario | Evidence | Status |
|---|---|---|
| Progress shows per-milestone counts | `tests/cli-status.test.ts:664` — "status single-change envelope gains top-level milestones with counts (never per change)"; `:701` — "status multi-change envelope carries milestones at top level only"; `:737` — "progress JSON gains milestones and text renders the block after Completed" | PASS ✓run |
| No milestones means no milestone section | `tests/cli-status.test.ts:623` — "status zero-changes JSON envelope is structurally identical"; `:633` — "status single-change JSON and text carry no milestone section"; `:649` — "progress JSON and text carry no milestone section"; `tests/cli-milestone.test.ts:243` — loadMilestoneRollups "returns null when spec/milestones/ has no milestone files" | PASS |

## Requirement 12: Idempotent migration of legacy backlog data into the issue store

| Scenario | Evidence | Status |
|---|---|---|
| Active and done items convert with content preserved | `tests/backlog-migrate.test.ts:74` — "converts active items to spec/issues with idea/backlog/priority frontmatter and verbatim body"; `:87` — "converts done items to spec/issues/resolved with type: idea frontmatter only"; `:153` — "archives originals byte-identically, preserving the done/ subpath"; CLI end-to-end: `tests/cli-issue-backlog.test.ts:608` | PASS |
| Second run is a no-op | `tests/backlog-migrate.test.ts:256` — "is a no-op on a second run after full migration"; `tests/cli-issue-backlog.test.ts:646` — "second run is a derived no-op: nothing_to_do true, no commit" | PASS ✓run |
| Slug collision reported, not overwritten | `tests/backlog-migrate.test.ts:179` — "reports a collision against spec/issues, never overwriting, and retains the legacy file"; `:202,:221,:241`; `tests/cli-issue-backlog.test.ts:659` | PASS |
| (self-migration clause: works on the metta repo, 8 archived items) | On-disk evidence in this worktree: `spec/backlog/` no longer exists; exactly 8 files in `spec/issues/resolved/` carry `type: idea` frontmatter (e.g. `spec/issues/resolved/add-metta-fix-issues-skill-that-works-like-metta-fix-gap.md` with `---\ntype: idea\n---` and preserved `**Added**/**Priority**` body); originals archived at `spec/archive/backlog-legacy/`; `tests/archive-dirs.test.ts:17,:51-:76` prove `backlog-legacy` is never claimable as an archived change | PASS (executed migration) |
| (guard registration clause: backlog migrate is Tier 2) | `tests/cli-metta-guard-bash-integration.test.ts:548-555` — blocks uncredentialed `metta backlog migrate`; `:573-604` — minted metta-backlog scope includes `backlog:migrate`; feature-branch guard: `tests/cli-issue-backlog.test.ts:249` | PASS ✓run |

## Requirement 13: Frontmatter writes round-trip the body and untouched fields

| Scenario | Evidence | Status |
|---|---|---|
| Targeted frontmatter update leaves everything else intact | `src/issues/issues-store.test.ts:325` — "targeted patch leaves untouched fields and body intact"; `tests/issue-frontmatter.test.ts:206` — "mutates only the patched key in an existing block, preserving value text, quoting, and order"; `:212` — "appends a new key after existing keys"; `:218` — "byte-preserves a tricky body across a patch" | PASS |
| Archive preserves frontmatter end to end | `src/issues/issues-store.test.ts:374` — "carries frontmatter into resolved/ verbatim without a changeName"; scenario in `tests/cli-issue-backlog.test.ts:536` asserts preserved frontmatter in the archived file | PASS ✓run |

## Spot-check runs (all passed)

1. `npx vitest run tests/issue-frontmatter.test.ts -t 'applies partial-frontmatter defaults'` — 1 passed
2. `npx vitest run tests/issue-frontmatter.test.ts -t 'renders enum errors naming the field'` — 1 passed
3. `npx vitest run tests/backlog-view.test.ts -t 'orders the spec scenario deterministically'` — 1 passed
4. `npx vitest run tests/backlog-migrate.test.ts -t 'is a no-op on a second run after full migration'` — 1 passed
5. `npx vitest run tests/cli-issue-backlog.test.ts -t 'existing issue slug is backlogged via frontmatter'` — 1 passed
6. `npx vitest run tests/cli-issue-backlog.test.ts -t 'unresolved slug without --new exits 4 naming the slug and suggesting --new'` — 1 passed
7. `npx vitest run tests/cli-milestone.test.ts -t 'zero-issue milestone exits 0 with empty issues and 0/0 at 0%'` — 1 passed
8. `npx vitest run tests/cli-status.test.ts -t 'progress JSON gains milestones and text renders the block after Completed'` — 1 passed
9. `npx vitest run tests/cli-metta-guard-bash-integration.test.ts -t 'milestone and backlog migrate classification'` — 7 passed
10. `npx vitest run src/issues/issues-store.test.ts -t 'carries frontmatter into resolved/ verbatim without a changeName'` — 1 passed

## Gaps

None. Every scenario has at least one covering passing test, or (for the self-migration clause of Requirement 12) verified on-disk migration evidence in this repo.
