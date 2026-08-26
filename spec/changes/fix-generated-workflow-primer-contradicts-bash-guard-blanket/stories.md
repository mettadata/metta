# fix-generated-workflow-primer-contradicts-bash-guard-blanket — User Stories

## US-1: Primer ban scoped to mutating commands only

**As an** AI orchestrator session in a metta consumer project
**I want to** read a workflow primer whose CLI ban covers only state-mutating lifecycle commands, not all `metta` invocation
**So that** I stop treating the guard's permitted read-only queries as forbidden and can answer operator questions with authoritative CLI output instead of slow, error-prone hand-computation over `spec/**` files
**Priority:** P1
**Independent Test Criteria:** The regenerated primer (both `workflowPrimerShort()` and `workflowPrimerLong()` outputs) contains no blanket "never call the CLI directly" / "any other `metta <cmd>`" wording; its mandate is scoped to mutating commands, names `metta-guard-bash` as the enforcement authority, and is identical across both variants.

**Acceptance Criteria:**
- **Given** the rewritten `MANDATE` constant in `src/delivery/workflow-primer.ts` **When** either `workflowPrimerShort()` or `workflowPrimerLong()` is rendered **Then** the mandate states that state-mutating lifecycle commands require the matching skill, identifies `metta-guard-bash` as the enforcement authority, and states that the guard permits a read-only query surface directly.
- **Given** the two primer variants **When** their mandate text is compared **Then** the mandate is byte-identical in both, preserving the consistency invariant documented in the file header.
- **Given** the long primer's Forbidden section **When** an orchestrator reads it **Then** it enumerates the mutating command families (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) instead of banning "any other `metta <cmd>`".
- **Given** an orchestrator session primed with the corrected wording **When** the operator asks a project-status question (e.g., a milestone rollup) **Then** the primer directs the session toward a permitted read-only command rather than prohibiting all CLI use.

---

## US-2: Permitted read-only surface documented in the primer

**As an** AI orchestrator session in a metta consumer project
**I want to** see an explicit "Read-only queries (permitted directly)" list in the primer
**So that** I discover commands like `metta status`, `metta progress`, `metta issues list`, and `metta milestone show` exist and are allowed, instead of never learning about them and grepping `spec/**` to reconstruct answers the CLI already computes correctly
**Priority:** P1
**Independent Test Criteria:** The long primer variant contains a read-only-queries subsection enumerating the guard's single-word, two-word, and bare allowed forms, and the short variant contains a one-line pointer stating read-only queries are permitted and the guard fails closed.

**Acceptance Criteria:**
- **Given** the rendered `workflowPrimerLong()` output **When** an orchestrator reads the "Read-only queries (permitted directly)" subsection **Then** it lists the guard's `ALLOWED_SUBCOMMANDS` (`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`), `ALLOWED_TWO_WORD` forms (`issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`), and `ALLOWED_BARE` forms (`roadmap`, `release`, `backlog` with flags) as they exist at generation time.
- **Given** the rendered `workflowPrimerShort()` output **When** an orchestrator reads it **Then** it includes a one-line statement that read-only queries are permitted directly and the guard fails closed.
- **Given** the enumerated lists in the long primer **When** compared against `metta-guard-bash.mjs` at the time of this change **Then** every entry matches the hook's current allow-lists exactly (documenting the surface, not renegotiating it).

---

## US-3: Fail-closed guidance as a drift safety valve

**As an** AI orchestrator session working from a primer that may lag behind the guard hook
**I want to** be told that the guard fails closed and that attempting an uncertain command is always safe
**So that** future drift between the primer's enumerated lists and the hook's actual allow-lists degrades to "attempt it and let the guard decide" rather than back to false prohibition
**Priority:** P1
**Independent Test Criteria:** The long primer's read-only subsection states that the list mirrors the guard's allow-lists at generation time and that, when in doubt, attempting the command is safe because the guard fails closed and blocks anything unrecognized.

**Acceptance Criteria:**
- **Given** the long primer's read-only subsection **When** an orchestrator encounters a command not on the enumerated list **Then** the primer's guidance instructs it to attempt the command and rely on the guard's fail-closed blocking, rather than to assume prohibition.
- **Given** the primer text **When** it describes the enumerated list **Then** it explicitly qualifies the list as mirroring the guard's allow-lists at generation time, signaling the hook — not the primer — is authoritative.

---

## US-4: All three wording copies agree

**As a** metta contributor working in the metta repo itself
**I want to** see metta's own CLAUDE.md `Metta Workflow` section and `docs/workflows/README.md` carry the same corrected, scoped wording as the generated primer
**So that** I am not misled by the same blanket ban in-house, and no document contradicts the guard's actual behavior anywhere in the project
**Priority:** P2
**Independent Test Criteria:** After the change, metta's CLAUDE.md `metta:workflow` region (regenerated via refresh) and the "Core rule: skills, not CLI" section of `docs/workflows/README.md` both scope the ban to mutating commands and acknowledge the permitted read-only surface, with no remaining blanket-ban wording.

**Acceptance Criteria:**
- **Given** metta's own CLAUDE.md **When** its workflow region is regenerated from the corrected primer **Then** the scoped mandate, enumerated Forbidden families, and read-only subsection appear, while the "Doc-only fixes and edits to this workflow section itself are the exceptions" line and section structure are preserved.
- **Given** `docs/workflows/README.md` **When** the "Core rule: skills, not CLI" section is read **Then** its wording matches the scoped rule and permitted read-only surface, and its existing note that CLAUDE.md wins on drift is preserved.
- **Given** the three copies (generated primer, metta's CLAUDE.md region, docs README) **When** compared **Then** none asserts a blanket ban on direct `metta` CLI calls.

---

## US-5: Correct wording propagates and survives refresh

**As an** operator of a metta consumer project (e.g., zeus)
**I want to** have the next `metta refresh` (or `metta init`/`install` scaffold) emit the corrected primer into my project's `metta:workflow` region
**So that** my sessions stop reporting permitted commands as forbidden, hand-patched local corrections inside the generated region become unnecessary, and refresh no longer silently reverts fixes back to wrong wording
**Priority:** P1
**Independent Test Criteria:** Running refresh in a consumer project whose CLAUDE.md contains the old blanket-ban wording (or commit-919720e-style local corrections) replaces the region with the corrected upstream primer.

**Acceptance Criteria:**
- **Given** a consumer project whose `metta:workflow` region carries the old blanket-ban primer **When** `metta refresh` runs with the fixed version installed **Then** the region contains the scoped mandate, the enumerated Forbidden families, and the read-only subsection.
- **Given** a consumer project with local hand-edits inside the generated region (the zeus commit-919720e pattern) **When** refresh regenerates the region **Then** the replacement wording is correct upstream content, so losing the local edits no longer reintroduces misinformation.
- **Given** a downstream session reading the regenerated primer **When** the operator asks for a milestone rollup **Then** the session runs the permitted CLI query (e.g., `metta milestone show`) and reports the CLI's authoritative number instead of a hand-computed one.

---

## US-6: Cross-referenced sync reminders for maintainers

**As a** metta maintainer editing the guard hook or the primer
**I want to** find sync-reminder comments in both `workflow-primer.ts` and the allow-list blocks of `metta-guard-bash.mjs` pointing at each other
**So that** whoever changes the allow surface or the documented list knows the sibling file must move with it, reducing the chance of a fresh primer/guard contradiction
**Priority:** P2
**Independent Test Criteria:** Both files contain a comment referencing the other by path near the hand-synced lists, and the hook change is comment-only with zero behavioral difference.

**Acceptance Criteria:**
- **Given** `src/delivery/workflow-primer.ts` **When** a maintainer reads the enumerated command lists **Then** an adjacent comment points at `metta-guard-bash.mjs` as the source that must stay in sync.
- **Given** `.claude/hooks/metta-guard-bash.mjs` **When** a maintainer reads the allow-list blocks **Then** an adjacent comment points back at `workflow-primer.ts`.
- **Given** the hook file after the change **When** its decision logic is exercised **Then** behavior is identical to before — the only diff is comments.
