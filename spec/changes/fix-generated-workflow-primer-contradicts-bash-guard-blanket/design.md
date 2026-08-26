# Design: fix-generated-workflow-primer-contradicts-bash-guard-blanket

## Approach

This is a wording-and-documentation change with a test-only drift guard. The enforcement
authority (`metta-guard-bash.mjs`) is correct and untouched behaviorally; the generated primer
in `src/delivery/workflow-primer.ts` is the defective component and the only place logic-adjacent
edits land. The fix follows research.md's selected approach: **scoped wording rewrite with an
enumerated read-only list, hardened by a primer-to-hook seam test**, with two elements folded in
from the generic-wording research track: the fail-closed "attempt it" guidance and the
bare-`metta` discovery pointer.

Five moves, in dependency order:

1. **Rewrite the primer constants** (`MANDATE`, Forbidden bullet) and add two new constants
   (read-only subsection bullets, short-variant pointer line) in `workflow-primer.ts`. The
   mandate stays a single shared constant so the byte-identity invariant across
   `workflowPrimerShort()` / `workflowPrimerLong()` remains structural (spec: "Mandate is
   byte-identical across both variants").
2. **Comment-only sync reminders in the guard hook**, applied byte-identically to BOTH copies:
   `.claude/hooks/metta-guard-bash.mjs` and the source of truth
   `src/templates/hooks/metta-guard-bash.mjs` (verified identical today via `diff`; the
   mint-seam test suite already exercises both copies via its `PAIRS` fixture, and the new seam
   test extracts from both and asserts equality — see Components §5).
3. **Seam test** in `tests/delivery.test.ts` (ADR-4 constant-pin precedent from
   `tests/metta-guard-mint-seam.test.ts:210`): regex-extract the hook's `ALLOWED_SUBCOMMANDS` /
   `ALLOWED_TWO_WORD` / `ALLOWED_BARE` entries and assert each appears (in its rendered form) in
   `workflowPrimerLong()`. Drift becomes a loud CI failure with zero runtime coupling — the
   shared-manifest approach's guarantee at ~30 lines of test code (research-shared-manifest.md §5.4
   rejected the runtime manifest; this is its replacement).
4. **Sync the two prose copies**: `docs/workflows/README.md` "Core rule" section, and metta's
   own CLAUDE.md `metta:workflow` region — the latter hand-applied to match
   `buildWorkflowSection()` output exactly, because direct `metta refresh` is Tier-2 blocked for
   the executor (verification procedure in Components §7).
5. **Update existing test pins** (`tests/delivery.test.ts:61` pins the old mandate opening) and
   add the new wording assertions, including a pin of the mandate byte-identity invariant.

### Key decisions (ADR-style)

- **ADR-A: Hand-synced enumeration + CI seam test, not a shared runtime manifest.**
  Rationale: the bug is docs drift; the hook's self-containedness is a deliberate security
  property, and the only safe manifest load strategy (dynamic import + exit 2) introduces a new
  whole-session all-Bash-blocked failure state (research-shared-manifest.md §3). The codebase's
  established pattern for cross-standalone-file consistency is the duplicated-but-pinned seam
  test (`GRACE_MS` pin, `tests/metta-guard-mint-seam.test.ts:210-216`). No vendor lock-in either
  way; the only external semantic relied on (Claude Code PreToolUse exit-code behavior) is
  pre-existing and unchanged.
- **ADR-B: Mandate byte-identity enforced structurally (one constant) AND pinned by test.**
  The invariant exists today but is untested (research.md key fact 2). The test duplicates the
  full mandate literal (ADR-4 pin style) and asserts both rendered variants contain it — so a
  future refactor that forks the constant fails CI.
- **ADR-C: "Read-only queries (permitted directly)" title kept; accuracy hedged in body prose.**
  `iteration` / `model-escalation` / `tokens` append instrumentation records and `install`
  writes scaffolding — allowed by the guard but not strictly read-only. The spec fixes the
  subsection title, so the hedge lives in the bullet body (Components §1, subsection wording),
  per research.md key fact 4.
- **ADR-D: Read-only subsection placed between `### Forbidden` and `### Research discipline`**
  in the long variant. Forbidden enumerates the blocked surface, the new subsection immediately
  answers "so what IS allowed" — the reading order that directly counters the zeus failure mode.
- **ADR-E: Bare-`metta` pointer included** (folded from research-generic-wording.md §1): bare
  `metta` is guard-allowed (`classify()` — no subcommand → allow) and prints the full command
  listing — the one zero-drift, self-updating discovery channel. One sentence in the subsection.
- **ADR-F: CLAUDE.md region hand-applied, verified by diff against computed output.** Direct
  `metta refresh` is Tier-2 blocked for the executor and this change must not invoke the CLI
  directly. `buildWorkflowSection()` output is fully deterministic (static strings only), so the
  region can be hand-edited and verified byte-exact with a scratch `tsx` script (Components §7).
  The next real `/metta-refresh` then confirms idempotence.

## Components

### 1. `src/delivery/workflow-primer.ts` — the only logic-adjacent change

**Exported API unchanged**: `workflowPrimerShort(): string[]` and
`workflowPrimerLong(): string[]`; consumers (`refresh.ts:127`, `claude-code-adapter.ts:76`,
`discovery-helpers.ts:143`) need no edits.

**File header (lines 1–9)**: update prose to (a) describe the scoped mandate, (b) state the
byte-identity invariant is now test-pinned, (c) note the enumerated lists are hand-synced with
`metta-guard-bash.mjs` and guarded by the seam test in `tests/delivery.test.ts`.

**Changed constant — `MANDATE`** (exact proposed wording, one string, shared by both variants):

> **State-mutating metta commands MUST go through the matching metta skill — never as direct
> CLI calls from an AI orchestrator session.** Enforcement authority is the `metta-guard-bash`
> PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a
> read-only query surface directly. (Humans running the CLI in a terminal are unaffected — this
> rule scopes to AI-driven sessions.)

The long variant continues to append (unchanged, via the existing concatenation at line 47):
`' The skills wrap artifact authoring, review, and verification with the correct subagent
personas; calling the CLI directly bypasses those guarantees and has shipped broken artifacts
(see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`).'`
The appended sentence is outside the mandate; byte-identity applies to the `MANDATE` constant's
rendered text, which both variants contain verbatim.

**New constant — `READ_ONLY_POINTER`** (short variant, one line):

> Read-only queries (`metta status`, `metta progress`, `metta issues list`, …) are permitted
> directly; the guard fails closed, so attempting a query is always safe.

Inserted in `workflowPrimerShort()` immediately after `MANDATE` (blank line separated), before
`'Primary entry points:'`.

**New constant — `READ_ONLY_SURFACE_BULLETS`** (long variant), with an adjacent sync comment
(exact comment text in §2 below). Exact proposed content, rendered:

> ### Read-only queries (permitted directly)
>
> The `metta-guard-bash` hook allows these directly — no skill needed. This list mirrors the
> hook's allow-lists at generation time; the hook, not this text, is authoritative:
> - Single-word: `status`, `instructions`, `progress`, `doctor`, `next`, `iteration`,
>   `model-escalation`, `tokens`, `install` (`iteration`/`model-escalation`/`tokens` append
>   instrumentation records and `install` writes scaffolding — guard-allowed, though not
>   strictly read-only)
> - Two-word: `issues list`, `gate list`, `changes list`, `backlog list|show`,
>   `gaps list|show`, `milestone list|show`, `release status`
> - Bare (flags only): `roadmap`, `release`, `backlog` (e.g. `metta roadmap --json`)
>
> Run bare `metta` for the full current command listing. When in doubt about a command not
> listed here, attempt it — the guard fails closed and blocks anything unrecognized, so an
> attempt is always safe and never mutates state.

This satisfies all three spec scenarios of the read-only requirement (full enumeration matching
the hook exactly at time of change), the fail-closed requirement (generation-time qualifier +
attempt-it instruction), and ADR-C/ADR-E (hedge in prose, bare-`metta` pointer).

Placement in `workflowPrimerLong()`: after the `### Forbidden` block's bullets, before
`### Research discipline` (ADR-D).

**Changed line — Forbidden bullet** (long variant line 60; exact proposed wording, mirroring
`BLOCKED_SUBCOMMANDS` + `BLOCKED_TWO_WORD` in the hook, with an adjacent sync comment):

> - Invoking any state-mutating metta command directly from an AI orchestrator session:
>   `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`,
>   `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`,
>   `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`,
>   `release cut`. Use the matching skill.

Note this deliberately includes the surface growth the old primer missed: `verify`,
`backlog migrate`, all `milestone` mutating forms, all `roadmap` mutating forms, `release cut`
(research.md key fact 1; verified against the hook lines 67–87).

**Preserved verbatim (spec preservation constraints)**:
- `'Doc-only fixes and edits to this workflow section itself are the exceptions.'` (line 56)
- The stub-artifact prohibition bullet (line 61): the bullet forbidding placeholder stub
  strings in artifact files, requiring real content authored by the matching `metta-*`
  subagent — kept verbatim (the literal stub phrases are not reproduced here because the
  completeness gate scans artifacts for them).
- `ENTRY_POINTS_BULLETS`, `TRUST_MODEL_BULLETS`, the quick-mode routing paragraph, the entire
  `### Research discipline` section, and the short variant's closing
  `'Run `metta refresh` for the full command reference.'` line — all untouched.

### 2. Guard hook — comment-only edits, BOTH copies

Files: `.claude/hooks/metta-guard-bash.mjs` AND `src/templates/hooks/metta-guard-bash.mjs`.
The two are byte-identical today and MUST remain so — apply the identical comment lines to both
(edit the template, mirror to the deployed copy, confirm with `diff`). The existing test
machinery pins the pairing: `tests/metta-guard-mint-seam.test.ts` spawns both copies via its
`PAIRS` fixture and its ADR-4 pin reads both files' text; the new seam test additionally
extracts the allow-lists from both copies and asserts set equality (§5).

Exact comment (one line each, inserted directly above the five list declarations —
`ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, `ALLOWED_BARE`, `BLOCKED_SUBCOMMANDS`,
`BLOCKED_TWO_WORD`):

```js
// SYNC: enumerated in src/delivery/workflow-primer.ts (read-only subsection / Forbidden
// bullet) — edit both together; the seam test in tests/delivery.test.ts fails on drift.
```

Zero behavioral diff: no code line changes, only comments. Verified by re-running the four
guard suites unchanged (`tests/metta-guard-bash.test.ts`,
`tests/cli-metta-guard-bash-integration.test.ts`, `tests/metta-guard-mint-seam.test.ts`,
`tests/metta-guard-agent-dispatch.test.ts`) — this is the spec's "Hook diff is comment-only"
scenario check.

### 3. `docs/workflows/README.md` — "Core rule: skills, not CLI" section (lines 45–51)

Heading kept. Exact proposed replacement for the two body paragraphs (the third paragraph,
line 51 with the "CLAUDE.md wins" note, is preserved verbatim):

> **State-mutating metta commands MUST go through the matching metta skill — never as direct
> CLI calls from an AI orchestrator session.** Enforcement authority is the `metta-guard-bash`
> PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a
> read-only query surface directly (`status`, `progress`, `issues list`, `milestone list|show`,
> and the rest of the allow surface — see the Read-only queries subsection in `CLAUDE.md`).
> Humans running `metta <cmd>` in a terminal are unaffected; the rule scopes to orchestrator
> contexts where subagent personas and artifact-quality guarantees are load-bearing.
>
> Running a state-mutating command (`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`,
> `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`,
> `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`,
> `roadmap add/reorder/next/remove`, `release cut`) directly from an orchestrator bypasses the
> subagent wrappers. This has shipped broken artifacts in the past — see
> `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`. Placeholder
> stub content is explicitly forbidden; artifacts must carry real content authored by the
> matching `metta-*` subagent. (The executor copies the existing stub-prohibition sentence
> from the current README verbatim — its literal stub phrases are not reproduced in this
> design because the completeness gate scans artifacts for them.)

This carries the scoped mandate, acknowledges the read-only surface (pointing at CLAUDE.md's
subsection rather than duplicating the full three-list enumeration a fourth time — CLAUDE.md is
already declared the source of truth by line 51), preserves the stub-artifact prohibition, and
removes the blanket "any other `metta <cmd>`" wording.

### 4. Metta's own `CLAUDE.md` — `metta:workflow` region

Hand-apply the exact `buildWorkflowSection()` output between
`<!-- metta:workflow-start -->` / `<!-- metta:workflow-end -->` (ADR-F). Concretely the region
diff is: mandate paragraph replaced, Forbidden first bullet replaced, read-only subsection
inserted between Forbidden and Research discipline. Everything else in the region (entry
points, trust model, quick-mode paragraph, exceptions line, skill lists) is unchanged.
Verification procedure in §7.

### 5. Seam test — `tests/delivery.test.ts`, new describe block "Workflow primer / guard allow-list seam"

Design (ADR-4 pin pattern, ~30–40 lines):

- Resolve both hook copies from `join(import.meta.dirname, '..')`:
  `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs`
  (same dual-copy discipline as `PAIRS` in the mint-seam suite).
- Extraction helper, per file:
  1. Slice the declaration block by matching from `const ALLOWED_SUBCOMMANDS = new Set([` (and
     the `ALLOWED_TWO_WORD = new Map([`, `ALLOWED_BARE = new Set([` counterparts) to the first
     `]);` at declaration end.
  2. **Strip `//` line comments from the block first** — comment prose may contain quotes or
     backticks; stripping makes the quoted-string extraction immune to comment churn.
  3. `ALLOWED_SUBCOMMANDS` / `ALLOWED_BARE`: collect `/'([^']+)'/g` matches → `string[]`.
  4. `ALLOWED_TWO_WORD`: collect `/\['([a-z-]+)',\s*new Set\(\[([^\]]+)\]\)/g` matches →
     `Array<[group, subs[]]>` (inner subs via the same quoted-string regex).
- Assertions:
  1. **Sanity floor** (prevents a silently-broken regex from passing vacuously):
     `ALLOWED_SUBCOMMANDS` extraction length >= 9, `ALLOWED_TWO_WORD` >= 7 groups,
     `ALLOWED_BARE` >= 3.
  2. **Copy equality**: extraction from the template copy deep-equals extraction from the
     deployed copy (allow-list divergence between the two files fails here).
  3. **Primer mirror**: against `workflowPrimerLong().join('\n')` —
     each single-word entry appears as `` `word` ``; each two-word group appears as
     `` `group sub1|sub2` `` (subs joined `|` in hook insertion order — this pins the primer's
     rendering format deliberately; both live in this repo and CI failure is the desired drift
     signal); each bare entry appears within the "Bare (flags only)" bullet line.
  4. **Blocked mirror** (Forbidden bullet): each `BLOCKED_SUBCOMMANDS` entry appears as
     `` `word` `` in the long output; for each `BLOCKED_TWO_WORD` group, the bullet contains
     `` `group sub1/sub2/...` `` (subs joined `/` in hook order — e.g.
     `` `backlog add/done/promote/migrate` ``).

Direction note: the seam test asserts hook-entries ⊆ primer (every allowed/blocked entry is
documented). The reverse direction (primer lists nothing extra) is covered by the wording tests
below pinning the exact bullet strings, which are built only from the enumerations above.

### 6. Other test updates

`tests/delivery.test.ts`:
- Line 61 (`formatContext` test): update the pinned substring to the new mandate opening —
  `expect(formatted).toContain('State-mutating metta commands MUST go through the matching metta skill')`.
- New describe "Workflow primer scoped mandate":
  1. **Byte-identity pin (ADR-B)**: the test carries the full new mandate string as a local
     literal; assert `workflowPrimerShort().join('\n')` and `workflowPrimerLong().join('\n')`
     both `toContain` it. (Duplicated-literal pin, exactly the `GRACE_MS` precedent.)
  2. Neither variant contains `'never call the CLI directly'`; neither contains
     ``'any other `metta <cmd>`'`` (blanket-ban removal, both variants).
  3. Long variant contains `'### Read-only queries (permitted directly)'` and
     `'metta-guard-bash'`.
  4. Long variant contains the generation-time qualifier (`'at generation time'`), the
     authority attribution (`'the hook, not this text, is authoritative'`), and the fail-closed
     guidance (`'attempt it'` / `'fails closed'`).
  5. Short variant contains the read-only pointer line (pin the full `READ_ONLY_POINTER`
     string) and does NOT contain the `###` read-only subsection heading (short stays short,
     matching the existing research-discipline short/long split test).
  6. Preservation pins: long variant still contains the doc-only-exceptions line and the
     stub-artifact prohibition bullet.
- Existing research-discipline and Tier-2 trust-model describes: unaffected (no changed text in
  those sections).

`tests/refresh.test.ts` (`buildWorkflowSection` describe): one added assertion —
`expect(result).toContain('### Read-only queries (permitted directly)')` — pinning that the
refresh-emitted region carries the subsection.

### 7. CLAUDE.md verification procedure (execute-phase, no metta CLI invocation)

After hand-editing the region, verify byte-exactness with a scratch script (scratchpad dir, not
committed): `npx tsx` a five-line script that imports `buildWorkflowSection` from
`src/cli/commands/refresh.ts`, prints it, and diff that output against the text between the
workflow markers in `CLAUDE.md`. Zero diff required. The next real `/metta-refresh` run (post-
ship) is the idempotence confirmation — regeneration must produce no change.

## Data Model

None. No `.metta/` state, no Zod schemas, no YAML, and no persisted formats change. The only
"data" in play is compile-time string constants in `workflow-primer.ts` and comments in the
hook. The generated-region contract (`<!-- metta:workflow-start/end -->` markers replaced
wholesale by `replaceMarkerContent()` in `refresh.ts:187–205`) is unchanged and is the
propagation mechanism, not a modified component.

## API Design

No public API surface changes:

- `workflowPrimerShort(): string[]` — signature, purity, and consumers unchanged; output text
  gains one line (pointer) and a rewritten mandate.
- `workflowPrimerLong(): string[]` — signature unchanged; output gains the read-only subsection
  (~9 lines), a rewritten mandate, and a rewritten Forbidden bullet.
- `buildWorkflowSection()`, `replaceMarkerContent()`, `formatContext()`, install/init scaffold
  paths — untouched; they pick up the new text automatically.
- CLI behavior, hook exit codes, allow/block membership, tiering, credentials — all unchanged
  (spec: comment-only hook diff).

Internal module shape after the change (all module-private consts, no new exports):
`MANDATE` (rewritten), `ENTRY_POINTS_BULLETS` (unchanged), `TRUST_MODEL_BULLETS` (unchanged),
`READ_ONLY_POINTER` (new), `READ_ONLY_SURFACE_BULLETS` (new), Forbidden bullet inline in
`workflowPrimerLong()` (rewritten, sync comment adjacent). Composition stays flat string-array
assembly — no abstraction added for a five-constant module.

## Dependencies

**Internal (all pre-existing, none modified structurally):**
- `src/cli/commands/refresh.ts` (`buildWorkflowSection` → long variant), `src/delivery/claude-code-adapter.ts` and `src/cli/commands/discovery-helpers.ts` (short variant) — consume-only.
- `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/metta-guard-bash.mjs` — comment-only edits; the build's `copy-templates` and install's readdir copy ship the template unchanged in mechanism.
- `tests/metta-guard-mint-seam.test.ts` — precedent only (ADR-4 pin pattern, dual-copy fixture); not modified.

**External:** none added. Vitest (existing) for tests; `node:fs` `readFileSync` in the seam
test (already used by sibling suites). No new packages, no network, no vendor lock-in; the one
external behavioral dependency (Claude Code PreToolUse exit-code semantics underpinning
"fail-closed") is pre-existing and documented in research-shared-manifest.md footnote 1.

**Sequencing:** primer + tests first (red on old pins → green), then hook comments (both
copies), then docs README, then CLAUDE.md region, then full-suite run.

## Risks & Mitigations

1. **Drift recurrence between primer enumeration and hook allow-lists** (the approach's known
   tradeoff). Mitigated three ways, in order of strength: the seam test turns any allow/block
   list edit without a matching primer edit into a CI failure; the fail-closed guidance
   converts residual drift (e.g. a consumer running an older primer) from false prohibition
   into a harmless blocked attempt; cross-referencing sync comments catch the human editing
   either file.
2. **Seam-test regex fragility** (hook refactor changes declaration shape; comment prose adds
   quotes). Mitigated by comment-stripping before extraction and the sanity-floor assertions —
   a broken regex fails the test loudly (extraction count below floor) instead of passing
   vacuously.
3. **Hook copies diverging** (comment applied to one file only). Mitigated: seam test extracts
   from both copies and asserts equality; final `diff` check during execute; the mint-seam
   suite already runs both copies.
4. **CLAUDE.md hand-application mismatch** (region not byte-equal to `buildWorkflowSection()`
   output → next refresh produces a surprise diff). Mitigated by the tsx diff verification
   (§7); the post-ship `/metta-refresh` idempotence check is the backstop.
5. **Consumer propagation lag**: consumers keep the blanket-ban wording until their next
   `metta refresh`/`install`. Accepted in intent.md (no push mechanism); the fix travels the
   same path the bug did.
6. **Deployment-level skew**: a consumer upgrades metta and refreshes but runs a stale
   installed hook (or vice versa) — primer may describe a slightly different surface than the
   locally enforced one. Structural residual (research-shared-manifest.md §1.3); degraded
   outcome is a blocked attempt plus the generation-time qualifier pointing at the hook as
   authority. Accepted.
7. **Format-coupling in the seam test** (pins `a|b` and `a/b/c` join rendering). Deliberate:
   both sides live in this repo; a rendering change fails one test and is fixed alongside it.
8. **Out-of-scope residuals, flagged for follow-up (not fixed here):**
   `docs/internals/guard-hooks.md` carries a fourth hand-synced copy of the lists (currently
   accurate; candidate backlog item per research.md). The short variant's closing line
   `'Run `metta refresh` for the full command reference.'` names a Tier-2-blocked command as a
   session instruction — pre-existing wording, harmless under fail-closed, left untouched to
   stay within spec scope. The hook's unknown-command block message could print the allowed
   surface (a drift-proof discoverability channel) — noted in research-generic-wording.md §7 as
   a backlog candidate.
