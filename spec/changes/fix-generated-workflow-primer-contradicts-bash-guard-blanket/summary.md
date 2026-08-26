# Summary: fix-generated-workflow-primer-contradicts-bash-guard-blanket

## What changed

The generated workflow primer claimed a blanket ban on direct `metta` CLI calls while the
`metta-guard-bash` PreToolUse hook actually permits a read-only query surface. This change
scopes the primer's mandate to state-mutating commands, documents the permitted read-only
surface, and syncs all wording copies — hardened by a seam test so the hand-synced lists
cannot silently drift again.

## Implementation (by task)

- **Task 1.1** (`c2e28796a`) — `src/delivery/workflow-primer.ts`: rewrote the shared
  `MANDATE` constant (scoped to state-mutating commands, names `metta-guard-bash` as the
  enforcement authority, fail-closed framing, humans-in-terminal carve-out preserved); added
  `READ_ONLY_POINTER` (short variant) and `READ_ONLY_SURFACE_BULLETS` — the
  `### Read-only queries (permitted directly)` subsection (long variant) enumerating the
  hook's single-word, two-word, and bare allow surface with a generation-time qualifier,
  bare-`metta` discovery pointer, and attempt-it fail-closed guidance; rewrote the Forbidden
  bullet to enumerate the full blocked surface (including `verify`, `backlog migrate`,
  `milestone`/`roadmap` mutating forms, `release cut`); added SYNC comments.
  `tests/delivery.test.ts`: updated the old mandate pin; new "Workflow primer scoped
  mandate" describe (byte-identity pin, blanket-wording absence, subsection/authority/
  fail-closed pins, preservation pins); new "Workflow primer / guard allow-list seam"
  describe extracting the hook's `ALLOWED_*`/`BLOCKED_*` entries from both hook copies and
  asserting each appears in the rendered primer (ADR-4 pin pattern).
- **Task 1.2** (`58e07d015`) — comment-only SYNC annotations above all five list
  declarations in BOTH `src/templates/hooks/metta-guard-bash.mjs` and
  `.claude/hooks/metta-guard-bash.mjs`; copies remain byte-identical; all four guard suites
  pass unchanged (zero behavioral diff).
- **Task 1.3** (`e5243acf3`) — `docs/workflows/README.md` "Core rule: skills, not CLI":
  scoped mandate + read-only acknowledgment pointing at CLAUDE.md's subsection; mutating
  surface enumerated; stub-prohibition sentence and "CLAUDE.md wins" note preserved
  verbatim; blanket wording removed.
- **Task 2.1** (`833aefa43`) — `tests/refresh.test.ts`: pinned the read-only subsection in
  `buildWorkflowSection()` output.
- **Task 2.2** (`8778db66b`) — metta's own `CLAUDE.md` `metta:workflow` region regenerated
  byte-exact from `buildWorkflowSection()` via a scratchpad tsx splice (direct
  `metta refresh` is guard-blocked for executors); no edits outside the marker region.
- **Task 3.1** — verification sweep: PASS, no fixes needed.

## Verification evidence

- `npm test`: 135 files, 2812 passed / 2 skipped, 0 failed
- `npx tsc --noEmit`: clean
- Hook copies: `diff` empty (template vs deployed byte-identical)
- CLAUDE.md workflow region: byte-exact match against `buildWorkflowSection()` output

## Notes

- Exported primer API unchanged (`workflowPrimerShort()` / `workflowPrimerLong()`); consumer
  projects receive the corrected wording on their next `metta refresh` / install scaffold.
- Known residual (out of scope, per design): `docs/internals/guard-hooks.md` carries a
  fourth hand-synced copy of the allow-lists; deployment-level skew (consumer refresh
  without reinstall) is not addressed by this change.
