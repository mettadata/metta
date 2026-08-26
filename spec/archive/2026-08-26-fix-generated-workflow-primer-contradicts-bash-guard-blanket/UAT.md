# UAT: fix-generated-workflow-primer-contradicts-bash-guard-blanket

- **Change**: fix-generated-workflow-primer-contradicts-bash-guard-blanket
- **Generated**: 2026-08-26
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Primer ban scoped to mutating commands only

*Independent test:* The regenerated primer (both `workflowPrimerShort()` and `workflowPrimerLong()` outputs) contains no blanket "never call the CLI directly" / "any other `metta <cmd>`" wording; its mandate is scoped to mutating commands, names `metta-guard-bash` as the enforcement authority, and is identical across both variants.

#### Step 1.1
- **Setup**: the rewritten `MANDATE` constant in `src/delivery/workflow-primer.ts`
- **Do**: either `workflowPrimerShort()` or `workflowPrimerLong()` is rendered
- **Observe**: the mandate states that state-mutating lifecycle commands require the matching skill, identifies `metta-guard-bash` as the enforcement authority, and states that the guard permits a read-only query surface directly.
- [ ] Pass

#### Step 1.2
- **Setup**: the two primer variants
- **Do**: their mandate text is compared
- **Observe**: the mandate is byte-identical in both, preserving the consistency invariant documented in the file header.
- [ ] Pass

#### Step 1.3
- **Setup**: the long primer's Forbidden section
- **Do**: an orchestrator reads it (Run: `backlog add/done/promote/migrate`, `changes abandon`)
- **Observe**: it enumerates the mutating command families (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) instead of banning "any other `metta <cmd>`".
- [ ] Pass

#### Step 1.4
- **Setup**: an orchestrator session primed with the corrected wording
- **Do**: the operator asks a project-status question (e.g., a milestone rollup)
- **Observe**: the primer directs the session toward a permitted read-only command rather than prohibiting all CLI use.
- [ ] Pass

### US-2: Permitted read-only surface documented in the primer

*Independent test:* The long primer variant contains a read-only-queries subsection enumerating the guard's single-word, two-word, and bare allowed forms, and the short variant contains a one-line pointer stating read-only queries are permitted and the guard fails closed.

#### Step 2.1
- **Setup**: the rendered `workflowPrimerLong()` output
- **Do**: an orchestrator reads the "Read-only queries (permitted directly)" subsection (Run: `issues list`, `gate list`)
- **Observe**: it lists the guard's `ALLOWED_SUBCOMMANDS` (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`), `ALLOWED_TWO_WORD` forms (`issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`), and `ALLOWED_BARE` forms (`roadmap`, `release`, `backlog` with flags) as they exist at generation time.
- [ ] Pass

#### Step 2.2
- **Setup**: the rendered `workflowPrimerShort()` output
- **Do**: an orchestrator reads it
- **Observe**: it includes a one-line statement that read-only queries are permitted directly and the guard fails closed.
- [ ] Pass

#### Step 2.3
- **Setup**: the enumerated lists in the long primer
- **Do**: compared against `metta-guard-bash.mjs` at the time of this change
- **Observe**: every entry matches the hook's current allow-lists exactly (documenting the surface, not renegotiating it).
- [ ] Pass

### US-3: Fail-closed guidance as a drift safety valve

*Independent test:* The long primer's read-only subsection states that the list mirrors the guard's allow-lists at generation time and that, when in doubt, attempting the command is safe because the guard fails closed and blocks anything unrecognized.

#### Step 3.1
- **Setup**: the long primer's read-only subsection
- **Do**: an orchestrator encounters a command not on the enumerated list
- **Observe**: the primer's guidance instructs it to attempt the command and rely on the guard's fail-closed blocking, rather than to assume prohibition.
- [ ] Pass

#### Step 3.2
- **Setup**: the primer text
- **Do**: it describes the enumerated list
- **Observe**: it explicitly qualifies the list as mirroring the guard's allow-lists at generation time, signaling the hook — not the primer — is authoritative.
- [ ] Pass

### US-4: All three wording copies agree

*Independent test:* After the change, metta's CLAUDE.md `metta:workflow` region (regenerated via refresh) and the "Core rule: skills, not CLI" section of `docs/workflows/README.md` both scope the ban to mutating commands and acknowledge the permitted read-only surface, with no remaining blanket-ban wording.

#### Step 4.1
- **Setup**: metta's own CLAUDE.md
- **Do**: its workflow region is regenerated from the corrected primer
- **Observe**: the scoped mandate, enumerated Forbidden families, and read-only subsection appear, while the "Doc-only fixes and edits to this workflow section itself are the exceptions" line and section structure are preserved.
- [ ] Pass

#### Step 4.2
- **Setup**: `docs/workflows/README.md`
- **Do**: the "Core rule: skills, not CLI" section is read
- **Observe**: its wording matches the scoped rule and permitted read-only surface, and its existing note that CLAUDE.md wins on drift is preserved.
- [ ] Pass

#### Step 4.3
- **Setup**: the three copies (generated primer, metta's CLAUDE.md region, docs README)
- **Do**: compared
- **Observe**: none asserts a blanket ban on direct `metta` CLI calls.
- [ ] Pass

### US-5: Correct wording propagates and survives refresh

*Independent test:* Running refresh in a consumer project whose CLAUDE.md contains the old blanket-ban wording (or commit-919720e-style local corrections) replaces the region with the corrected upstream primer.

#### Step 5.1
- **Setup**: a consumer project whose `metta:workflow` region carries the old blanket-ban primer
- **Do**: `metta refresh` runs with the fixed version installed (Run: `metta refresh`)
- **Observe**: the region contains the scoped mandate, the enumerated Forbidden families, and the read-only subsection.
- [ ] Pass

#### Step 5.2
- **Setup**: a consumer project with local hand-edits inside the generated region (the zeus commit-919720e pattern)
- **Do**: refresh regenerates the region
- **Observe**: the replacement wording is correct upstream content, so losing the local edits no longer reintroduces misinformation.
- [ ] Pass

#### Step 5.3
- **Setup**: a downstream session reading the regenerated primer
- **Do**: the operator asks for a milestone rollup (Run: `metta milestone show`)
- **Observe**: the session runs the permitted CLI query (e.g., `metta milestone show`) and reports the CLI's authoritative number instead of a hand-computed one.
- [ ] Pass

### US-6: Cross-referenced sync reminders for maintainers

*Independent test:* Both files contain a comment referencing the other by path near the hand-synced lists, and the hook change is comment-only with zero behavioral difference.

#### Step 6.1
- **Setup**: `src/delivery/workflow-primer.ts`
- **Do**: a maintainer reads the enumerated command lists
- **Observe**: an adjacent comment points at `metta-guard-bash.mjs` as the source that must stay in sync.
- [ ] Pass

#### Step 6.2
- **Setup**: `.claude/hooks/metta-guard-bash.mjs`
- **Do**: a maintainer reads the allow-list blocks
- **Observe**: an adjacent comment points back at `workflow-primer.ts`.
- [ ] Pass

#### Step 6.3
- **Setup**: the hook file after the change
- **Do**: its decision logic is exercised
- **Observe**: behavior is identical to before — the only diff is comments.
- [ ] Pass

## Additional scenarios

#### Step 7.1: Mandate is scoped, names the guard, and acknowledges the read-only surface
- **Setup**: the rewritten `MANDATE` constant in `src/delivery/workflow-primer.ts`
- **Do**: either `workflowPrimerShort()` or `workflowPrimerLong()` is rendered
- **Observe**: the mandate states that state-mutating lifecycle commands require the matching skill, identifies `metta-guard-bash` as the enforcement authority, and states that the guard permits a read-only query surface directly
- [ ] Pass

#### Step 7.2: Mandate is byte-identical across both variants
- **Setup**: the rendered outputs of `workflowPrimerShort()` and `workflowPrimerLong()`
- **Do**: their mandate text is compared
- **Observe**: the mandate is byte-identical in both variants
- [ ] Pass

#### Step 7.3: Forbidden section enumerates mutating families instead of a blanket ban
- **Setup**: the long primer's Forbidden section
- **Do**: an orchestrator reads it (Run: `backlog add/done/promote/migrate`, `changes abandon`)
- **Observe**: it enumerates the mutating command families (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) and contains no "any other `metta <cmd>`" blanket wording
- [ ] Pass

#### Step 7.4: Primed session is directed to permitted queries for status questions
- **Setup**: an orchestrator session primed with the corrected wording
- **Do**: the operator asks a project-status question (e.g., a milestone rollup)
- **Observe**: the primer's guidance directs the session toward a permitted read-only command rather than prohibiting all CLI use
- [ ] Pass

#### Step 7.5: Long primer enumerates the full allow surface
- **Setup**: the rendered `workflowPrimerLong()` output
- **Do**: an orchestrator reads the "Read-only queries (permitted directly)" subsection (Run: `issues list`, `gate list`)
- **Observe**: it lists the single-word allowed subcommands (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`), the two-word allowed forms (`issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`), and the bare allowed forms (`roadmap`, `release`, `backlog` with flags)
- [ ] Pass

#### Step 7.6: Enumerated lists match the hook's current allow-lists exactly
- **Setup**: the enumerated lists in the long primer's read-only subsection
- **Do**: compared against the `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, and `ALLOWED_BARE` blocks in `.claude/hooks/metta-guard-bash.mjs` at the time of this change
- **Observe**: every entry matches the hook's current allow-lists exactly, with no additions or removals
- [ ] Pass

#### Step 7.7: Short primer carries a one-line read-only pointer
- **Setup**: the rendered `workflowPrimerShort()` output
- **Do**: an orchestrator reads it
- **Observe**: it includes a one-line statement that read-only queries are permitted directly and the guard fails closed
- [ ] Pass

#### Step 7.8: Unlisted command triggers attempt-it guidance, not assumed prohibition
- **Setup**: the long primer's read-only subsection
- **Do**: an orchestrator encounters a `metta` command not on the enumerated list
- **Observe**: the primer's guidance instructs it to attempt the command and rely on the guard's fail-closed blocking, rather than to assume prohibition
- [ ] Pass

#### Step 7.9: List is qualified as a generation-time mirror of the guard
- **Setup**: the primer text describing the enumerated read-only list
- **Do**: it is read
- **Observe**: it explicitly qualifies the list as mirroring the guard's allow-lists at generation time, identifying the hook as the authoritative source
- [ ] Pass

#### Step 7.10: Metta's own CLAUDE.md region regenerates with corrected wording and preserved structure
- **Setup**: metta's own CLAUDE.md
- **Do**: its `metta:workflow` region is regenerated from the corrected primer via refresh
- **Observe**: the scoped mandate, enumerated Forbidden families, and read-only subsection appear, while the "Doc-only fixes and edits to this workflow section itself are the exceptions" line and the section structure are preserved
- [ ] Pass

#### Step 7.11: Docs README core-rule section matches the scoped rule
- **Setup**: `docs/workflows/README.md`
- **Do**: the "Core rule: skills, not CLI" section is read
- **Observe**: its wording matches the scoped rule and permitted read-only surface, and its existing note that CLAUDE.md wins on drift is preserved
- [ ] Pass

#### Step 7.12: No copy asserts a blanket ban
- **Setup**: the three copies (generated primer, metta's CLAUDE.md workflow region, docs README)
- **Do**: they are compared
- **Observe**: none asserts a blanket ban on direct `metta` CLI calls
- [ ] Pass

#### Step 7.13: Refresh replaces old blanket-ban wording in a consumer project
- **Setup**: a consumer project whose `metta:workflow` region carries the old blanket-ban primer
- **Do**: `metta refresh` runs with the fixed version installed (Run: `metta refresh`)
- **Observe**: the region contains the scoped mandate, the enumerated Forbidden families, and the read-only subsection
- [ ] Pass

#### Step 7.14: Refresh over local hand-edits yields correct upstream wording
- **Setup**: a consumer project with local hand-edits inside the generated region (the zeus commit-919720e pattern)
- **Do**: refresh regenerates the region
- **Observe**: the replacement wording is the correct upstream content, so losing the local edits no longer reintroduces misinformation
- [ ] Pass

#### Step 7.15: Primer lists point at the hook
- **Setup**: `src/delivery/workflow-primer.ts`
- **Do**: a maintainer reads the enumerated command lists
- **Observe**: an adjacent comment points at `.claude/hooks/metta-guard-bash.mjs` as the source that must stay in sync
- [ ] Pass

#### Step 7.16: Hook allow-lists point back at the primer
- **Setup**: `.claude/hooks/metta-guard-bash.mjs`
- **Do**: a maintainer reads the allow-list blocks
- **Observe**: an adjacent comment points back at `src/delivery/workflow-primer.ts`
- [ ] Pass

#### Step 7.17: Hook diff is comment-only with zero behavior change
- **Setup**: the hook file after the change
- **Do**: its decision logic is exercised across allowed, blocked, and unknown invocations
- **Observe**: behavior is identical to before the change — the only diff is comments
- [ ] Pass
