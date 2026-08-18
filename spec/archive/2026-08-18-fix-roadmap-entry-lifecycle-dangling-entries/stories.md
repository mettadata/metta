# fix-roadmap-entry-lifecycle-dangling-entries — User Stories

## US-1: Activate the next roadmap entry despite dangling heads

**As a** metta operator running roadmap-driven development
**I want to** run `metta roadmap next` and have it skip over dangling entries (entries whose referenced issue has been archived) instead of hard-failing
**So that** the primary activation flow keeps working after every shipped milestone, since dangling entries are now the normal end state of shipped work — not an accident that should block me
**Priority:** P1
**Independent Test Criteria:** With a roadmap whose head entries reference archived issues and a healthy entry below them, `metta roadmap next` activates the first healthy entry, warns per skipped slug with a remedy, leaves the dangling entries in place, and exits successfully.

**Acceptance Criteria:**
- **Given** a roadmap whose top entry references an archived (resolved) issue and whose second entry references a live issue **When** the operator runs `metta roadmap next` **Then** the command warns about the dangling top entry — naming its slug and the remedies (`metta roadmap remove <slug>` or restoring `spec/issues/<slug>.md`) — activates the second entry, and removes only the activated entry from the roadmap
- **Given** multiple consecutive dangling entries at the head of the roadmap **When** the operator runs `metta roadmap next` **Then** each dangling entry produces its own warning, all dangling entries remain in the roadmap file, and the first healthy entry is activated
- **Given** dangling entries above a healthy entry **When** the operator runs `metta roadmap next --prune` **Then** the skipped dangling entries are removed alongside the activated entry in the same write and commit of `spec/roadmap.md`
- **Given** a roadmap where every entry is dangling, or an empty roadmap **When** the operator runs `metta roadmap next` **Then** the command completes as a non-error no-op with clear guidance on how to proceed (no exit-4 failure, no roadmap mutation)

## US-2: Remove a roadmap entry with a single command

**As a** metta operator maintaining `spec/roadmap.md`
**I want to** run `metta roadmap remove <position|slug>` to retire any roadmap entry — dangling or abandoned
**So that** I have a supported one-command exit for entries instead of hand-editing a CLI-owned file with a canonical writer, which risks corrupting the roadmap format
**Priority:** P1
**Independent Test Criteria:** `metta roadmap remove` deletes the targeted entry by 1-based position or by slug, renumbers and commits `spec/roadmap.md` through the canonical writer, and fails with a typed `not_found` error (exit 4) when the target does not exist.

**Acceptance Criteria:**
- **Given** a roadmap containing an entry with slug `foo` at position 2 **When** the operator runs `metta roadmap remove 2` or `metta roadmap remove foo` **Then** the entry is removed, remaining entries are renumbered through the canonical save path, and the change to `spec/roadmap.md` is auto-committed
- **Given** a roadmap that contains no entry matching the given position or slug **When** the operator runs `metta roadmap remove <target>` **Then** the command fails with a typed `not_found` error in the standard exit-4 error envelope and the roadmap file is unchanged
- **Given** the repository is on the main branch (or otherwise guarded, consistent with other mutating roadmap subcommands) **When** the operator runs `metta roadmap remove <target>` **Then** the main-branch guard applies exactly as it does for `roadmap add` and `roadmap reorder`

## US-3: Roadmap entries retire themselves when their issue is resolved

**As a** metta operator resolving backlog items and issues
**I want to** have `backlog done` and `fix-issue --remove-issue` automatically remove any roadmap entry referencing the resolved slug, committing the roadmap update atomically with the issue archive
**So that** shipping work never manufactures dangling roadmap entries and I don't have to remember a separate cleanup step after every resolution
**Priority:** P2
**Independent Test Criteria:** Resolving a roadmapped issue via `backlog done` or `fix-issue --remove-issue` archives the issue and removes its roadmap entry in the same commit; resolving a non-roadmapped issue leaves the roadmap and existing behavior untouched.

**Acceptance Criteria:**
- **Given** an issue slug that appears as a roadmap entry **When** the operator resolves it via `metta backlog done <slug>` **Then** the issue is archived to `spec/issues/resolved/` and the referencing roadmap entry is removed, with `spec/roadmap.md` included in the same commit as the archive
- **Given** an issue slug that appears as a roadmap entry **When** it is resolved via `fix-issue --remove-issue` **Then** the roadmap entry is removed and `spec/roadmap.md` lands in the same commit as the issue archival
- **Given** an issue slug with no referencing roadmap entry **When** it is resolved via either path **Then** behavior is identical to today — no roadmap write, no extra commit content
- **Given** a roadmapped issue is resolved and retired **When** the command emits its JSON output **Then** any reporting of the retired roadmap entry is additive (existing fields and consumers are unaffected)

## US-4: Clear replacement signal for automation that relied on the fail-stop

**As a** metta operator (or automation author) who relied on `roadmap next` exiting 4 on a dangling head per ADR-4
**I want to** receive explicit per-entry warnings naming each skipped dangling slug, with `--prune` as the opt-in destructive alternative
**So that** I can detect and handle dangling entries under the new skip-and-warn contract instead of the removed exit-4 signal, without silent behavior drift
**Priority:** P2
**Independent Test Criteria:** The warning output of `roadmap next` identifies every skipped dangling slug and its remedy, and the updated roadmap-feature spec formally supersedes ADR-4's fail-stop requirement.

**Acceptance Criteria:**
- **Given** a roadmap with dangling entries **When** `metta roadmap next` runs **Then** the output contains one warning per skipped entry naming the slug and the available remedies, so scripts and operators can detect dangling state from the output
- **Given** the roadmap-feature spec previously mandated exit-4 `not_found` on a dangling top entry (ADR-4) **When** this change ships **Then** the spec delta records the skip-with-warning behavior as formally superseding ADR-4, so the contract change is traceable rather than an undocumented drift
