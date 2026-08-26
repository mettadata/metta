# orchestration-guard

## ADDED: Requirement: Workflow Primer Mandate Is Scoped to Mutating Commands

The generated workflow primer (both the `workflowPrimerShort()` and `workflowPrimerLong()` outputs
emitted into the CLAUDE.md `metta:workflow` region) MUST scope its CLI prohibition to
state-mutating lifecycle commands only. The mandate MUST NOT assert a blanket ban on direct
`metta` CLI invocation ("never call the CLI directly" / "any other `metta <cmd>`" wording), MUST
name the `metta-guard-bash` PreToolUse hook as the enforcement authority, and MUST state that the
guard permits a read-only query surface directly. The mandate text MUST be byte-identical across
the short and long primer variants, preserving the consistency invariant documented in the
`workflow-primer.ts` file header. The long variant's Forbidden section MUST enumerate the mutating
command families that require skills — the guard's blocked surface (`propose`, `quick`, `auto`,
`complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`,
`verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`,
`roadmap add/reorder/next/remove`, `release cut`) — instead of banning "any other `metta <cmd>`".
Trace: intent Problem (blanket ban contradicts the guard's deliberate read-only allow surface);
intent Proposal items 1–2; US-1.

### Scenario: Mandate is scoped, names the guard, and acknowledges the read-only surface
- GIVEN the rewritten `MANDATE` constant in `src/delivery/workflow-primer.ts`
- WHEN either `workflowPrimerShort()` or `workflowPrimerLong()` is rendered
- THEN the mandate states that state-mutating lifecycle commands require the matching skill, identifies `metta-guard-bash` as the enforcement authority, and states that the guard permits a read-only query surface directly

### Scenario: Mandate is byte-identical across both variants
- GIVEN the rendered outputs of `workflowPrimerShort()` and `workflowPrimerLong()`
- WHEN their mandate text is compared
- THEN the mandate is byte-identical in both variants

### Scenario: Forbidden section enumerates mutating families instead of a blanket ban
- GIVEN the long primer's Forbidden section
- WHEN an orchestrator reads it
- THEN it enumerates the mutating command families (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) and contains no "any other `metta <cmd>`" blanket wording

### Scenario: Primed session is directed to permitted queries for status questions
- GIVEN an orchestrator session primed with the corrected wording
- WHEN the operator asks a project-status question (e.g., a milestone rollup)
- THEN the primer's guidance directs the session toward a permitted read-only command rather than prohibiting all CLI use


## ADDED: Requirement: Workflow Primer Documents the Permitted Read-Only Surface

The long primer variant MUST contain a "Read-only queries (permitted directly)" subsection
enumerating the guard's allow surface as it exists at generation time: the single-word allowed
subcommands (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`,
`model-escalation`, `tokens`, `install`), the two-word allowed forms (`issues list`, `gate list`,
`changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`),
and the bare allowed forms (`roadmap`, `release`, `backlog` invoked bare or with flags only).
Every enumerated entry MUST match the corresponding entry in the `ALLOWED_SUBCOMMANDS`,
`ALLOWED_TWO_WORD`, and `ALLOWED_BARE` lists in `.claude/hooks/metta-guard-bash.mjs` at the time
of this change — the primer documents the existing surface and MUST NOT add, remove, or
renegotiate any allow-list membership. The short primer variant MUST include a one-line statement
that read-only queries are permitted directly and that the guard fails closed.
Trace: intent Problem (consumer sessions never discover permitted commands; zeus 2026-08-26
session); intent Proposal item 3; US-2.

### Scenario: Long primer enumerates the full allow surface
- GIVEN the rendered `workflowPrimerLong()` output
- WHEN an orchestrator reads the "Read-only queries (permitted directly)" subsection
- THEN it lists the single-word allowed subcommands (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`), the two-word allowed forms (`issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`), and the bare allowed forms (`roadmap`, `release`, `backlog` with flags)

### Scenario: Enumerated lists match the hook's current allow-lists exactly
- GIVEN the enumerated lists in the long primer's read-only subsection
- WHEN compared against the `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, and `ALLOWED_BARE` blocks in `.claude/hooks/metta-guard-bash.mjs` at the time of this change
- THEN every entry matches the hook's current allow-lists exactly, with no additions or removals

### Scenario: Short primer carries a one-line read-only pointer
- GIVEN the rendered `workflowPrimerShort()` output
- WHEN an orchestrator reads it
- THEN it includes a one-line statement that read-only queries are permitted directly and the guard fails closed


## ADDED: Requirement: Workflow Primer Carries Fail-Closed Guidance as a Drift Safety Valve

The long primer's read-only subsection MUST qualify its enumerated list as mirroring the guard's
allow-lists at generation time — signaling that the hook, not the primer, is the authoritative
source — and MUST instruct that, when in doubt about a command not on the list, attempting the
command is safe because the guard fails closed and blocks anything unrecognized. Primer/guard
drift MUST therefore degrade to "attempt it and let the guard decide" rather than to false
prohibition.
Trace: intent Proposal item 3 (solution 3's fail-closed guidance folded in); intent Risk
(enumerated list can drift); US-3.

### Scenario: Unlisted command triggers attempt-it guidance, not assumed prohibition
- GIVEN the long primer's read-only subsection
- WHEN an orchestrator encounters a `metta` command not on the enumerated list
- THEN the primer's guidance instructs it to attempt the command and rely on the guard's fail-closed blocking, rather than to assume prohibition

### Scenario: List is qualified as a generation-time mirror of the guard
- GIVEN the primer text describing the enumerated read-only list
- WHEN it is read
- THEN it explicitly qualifies the list as mirroring the guard's allow-lists at generation time, identifying the hook as the authoritative source


## ADDED: Requirement: All Workflow-Rule Copies Agree Across Primer, CLAUDE.md, and Docs

The three copies of the workflow rule — the generated primer, metta's own CLAUDE.md
`Metta Workflow` region (regenerated by `metta refresh`), and the "Core rule: skills, not CLI"
section of `docs/workflows/README.md` — MUST all carry the scoped mandate and acknowledge the
permitted read-only surface, and none MUST assert a blanket ban on direct `metta` CLI calls.
Regeneration of metta's own CLAUDE.md region MUST preserve the "Doc-only fixes and edits to this
workflow section itself are the exceptions" line and the existing section structure. The docs
README rewording MUST preserve its existing note that CLAUDE.md wins on drift. The corrected
wording MUST propagate to consumer projects through the existing generation paths — the next
`metta refresh` (long variant) or `metta init`/`install` scaffold (short variant) — replacing any
prior region content, including old blanket-ban wording or local hand-edits inside the generated
region.
Trace: intent Proposal item 4; intent Impact (consumer propagation, zeus commit 919720e); US-4;
US-5.

### Scenario: Metta's own CLAUDE.md region regenerates with corrected wording and preserved structure
- GIVEN metta's own CLAUDE.md
- WHEN its `metta:workflow` region is regenerated from the corrected primer via refresh
- THEN the scoped mandate, enumerated Forbidden families, and read-only subsection appear, while the "Doc-only fixes and edits to this workflow section itself are the exceptions" line and the section structure are preserved

### Scenario: Docs README core-rule section matches the scoped rule
- GIVEN `docs/workflows/README.md`
- WHEN the "Core rule: skills, not CLI" section is read
- THEN its wording matches the scoped rule and permitted read-only surface, and its existing note that CLAUDE.md wins on drift is preserved

### Scenario: No copy asserts a blanket ban
- GIVEN the three copies (generated primer, metta's CLAUDE.md workflow region, docs README)
- WHEN they are compared
- THEN none asserts a blanket ban on direct `metta` CLI calls

### Scenario: Refresh replaces old blanket-ban wording in a consumer project
- GIVEN a consumer project whose `metta:workflow` region carries the old blanket-ban primer
- WHEN `metta refresh` runs with the fixed version installed
- THEN the region contains the scoped mandate, the enumerated Forbidden families, and the read-only subsection

### Scenario: Refresh over local hand-edits yields correct upstream wording
- GIVEN a consumer project with local hand-edits inside the generated region (the zeus commit-919720e pattern)
- WHEN refresh regenerates the region
- THEN the replacement wording is the correct upstream content, so losing the local edits no longer reintroduces misinformation


## ADDED: Requirement: Cross-Referenced Sync Reminders Between Primer and Guard Allow-Lists

The hand-synced enumerated lists MUST carry cross-referencing maintenance comments:
`src/delivery/workflow-primer.ts` MUST contain a comment adjacent to its enumerated command lists
pointing at `.claude/hooks/metta-guard-bash.mjs` as the source that must stay in sync, and the
allow-list blocks in `.claude/hooks/metta-guard-bash.mjs` MUST contain a comment pointing back at
`workflow-primer.ts`. The change to the hook file MUST be comment-only: the guard's decision
logic, allow-list membership, block-list membership, tiering, and credential handling MUST behave
identically before and after the change.
Trace: intent Proposal item 5; intent Impact (`metta-guard-bash.mjs` comment-only, zero
behavioral impact); US-6.

### Scenario: Primer lists point at the hook
- GIVEN `src/delivery/workflow-primer.ts`
- WHEN a maintainer reads the enumerated command lists
- THEN an adjacent comment points at `.claude/hooks/metta-guard-bash.mjs` as the source that must stay in sync

### Scenario: Hook allow-lists point back at the primer
- GIVEN `.claude/hooks/metta-guard-bash.mjs`
- WHEN a maintainer reads the allow-list blocks
- THEN an adjacent comment points back at `src/delivery/workflow-primer.ts`

### Scenario: Hook diff is comment-only with zero behavior change
- GIVEN the hook file after the change
- WHEN its decision logic is exercised across allowed, blocked, and unknown invocations
- THEN behavior is identical to before the change — the only diff is comments
