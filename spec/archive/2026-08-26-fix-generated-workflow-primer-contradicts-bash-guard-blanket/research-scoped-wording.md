# Research: Scoped wording rewrite with enumerated read-only list (hand-synced)

Change: `fix-generated-workflow-primer-contradicts-bash-guard-blanket`
Approach researched: rewrite the primer `MANDATE` + Forbidden bullet to scope the ban to
state-mutating commands, name `metta-guard-bash` as enforcement authority, add a
"Read-only queries (permitted directly)" subsection enumerating the hook's current
allow-lists, propagate the wording to metta's own CLAUDE.md region (via refresh) and
`docs/workflows/README.md`, and add cross-referencing sync comments in both files.

All paths below are relative to the change root
`/home/utx0/Code/metta/.metta/worktrees/fix-generated-workflow-primer-contradicts-bash-guard-blanket/`.

---

## 1. Current state of the primer (`src/delivery/workflow-primer.ts`)

- **`MANDATE` constant — lines 11–13.** Hardcodes the blanket ban:
  `'**AI orchestrators MUST invoke the matching metta skill — never call the CLI directly.** (Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)'`
- **Identical-mandate invariant** is maintained *structurally*, not by test: both variants
  reference the same `MANDATE` constant (`workflowPrimerShort()` at line 32; `workflowPrimerLong()`
  at line 47, where the long variant appends the broken-artifacts sentence via string
  concatenation `MANDATE + ' The skills wrap …'`). The file header comment (lines 1–9) documents
  the invariant in prose. No test currently asserts byte-identity across variants.
- **Forbidden bullet — line 60** in `workflowPrimerLong()`:
  `'- Invoking `metta quick`, `metta propose`, `metta finalize`, `metta complete`, `metta issue`, or any other `metta <cmd>` directly from an AI orchestrator session. Use the matching skill.'`
- **Long-only content**: quick-mode routing paragraph (line 54), the exceptions line
  `'Doc-only fixes and edits to this workflow section itself are the exceptions.'` (line 56 —
  must be preserved per spec), `### Forbidden` (58–61), `### Research discipline` (63–69).
- **Shared bullets**: `ENTRY_POINTS_BULLETS` (15–19), `TRUST_MODEL_BULLETS` (21–26). Neither
  needs changes for this approach; the Tier-2 trust wording tests pin their content.

### Consumers of the two variants (all found via grep; no others exist)

| Consumer | Variant | Effect |
|---|---|---|
| `src/cli/commands/refresh.ts:127` (`buildWorkflowSection()`) | long | Emitted into the `<!-- metta:workflow-start/end -->` region of CLAUDE.md by `metta refresh` |
| `src/delivery/claude-code-adapter.ts:76` (`formatContext()`) | short | Scaffold CLAUDE.md written by install |
| `src/cli/commands/discovery-helpers.ts:143` | short | CLAUDE.md scaffold written during `metta init` discovery |

### Region-replacement mechanism (`metta refresh`)

`src/cli/commands/refresh.ts`:
- `buildWorkflowSection()` (lines 123–160) prepends `## Metta Workflow`, splices in
  `workflowPrimerLong()`, then appends the five skill-category lists.
- `replaceMarkerContent()` (lines 187–205) does plain `indexOf` replacement between
  `startTag`/`endTag` marker pairs, appending the section if markers are absent. The workflow
  markers are `<!-- metta:workflow-start -->` / `<!-- metta:workflow-end -->` (metta's own
  CLAUDE.md carries them at lines 39/101). Anything inside the region — including local
  hand-edits like zeus commit 919720e — is wholesale replaced. No changes needed to this
  mechanism; it is the propagation path that carries the fix.

---

## 2. Exact current guard allow/block surface (`.claude/hooks/metta-guard-bash.mjs`)

The hook HAS grown beyond the issue text; the intent.md and spec.md for this change already
reflect the grown surface, and I verified them against the file. Authoritative as of this
worktree's copy:

**`ALLOWED_SUBCOMMANDS` (lines 38–45)** — single-word, no credential needed:
`status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`,
`tokens`, `install`.
Note the hook's own comments concede `iteration` / `model-escalation` / `tokens` are
*instrumentation appenders* ("read-safe-ish", append-only records) and `install` is an
intentional human/CI pass-through — they are on the allow list but are not strictly read-only.
Wording in the primer subsection should hedge accordingly (see sketch below).

**`ALLOWED_TWO_WORD` (lines 48–64)**:
`issues list`; `gate list`; `changes list`; `backlog list|show`; `gaps list|show`;
`milestone list|show`; `release status`.

**`ALLOWED_BARE` (line 97)** — bare or flags-only third word (`metta roadmap --json` style):
`roadmap`, `release`, `backlog`.

**`BLOCKED_SUBCOMMANDS` (lines 67–73)** — mutating, skill/credential-gated:
`propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`,
`refresh`, `import`, `init`, and `verify` (blocked because it *executes* gates — confirms the
issue's note that `verify` is now blocked).

**`BLOCKED_TWO_WORD` (lines 76–87)**:
`backlog add|done|promote|migrate` (includes `migrate` — beyond the old primer text);
`changes abandon`; `milestone create|close|update`; `roadmap add|reorder|next|remove`;
`release cut`.

**Other classify() behavior relevant to wording (lines 660–680):** any `--` operand terminator
fails closed regardless of allow-list membership; unknown subcommands fail closed
(`'unknown'` → block with "update the allowlist" message). Bare `metta` with no subcommand is
allowed. This fail-closed property is exactly what the drift safety-valve wording leans on.

**Existing sibling documentation:** `docs/internals/guard-hooks.md` already tabulates
`ALLOWED_*` lists (line 65 area) — a fourth hand-synced copy to be aware of, though it appears
current and is out of this change's stated scope.

---

## 3. Docs copy (`docs/workflows/README.md`)

"Core rule: skills, not CLI" — lines 45–51:
- Line 47 repeats the blanket mandate verbatim.
- Line 49 repeats the "any other `metta <cmd>`" ban and the stub-artifact prohibition.
- Line 51 carries the note "if this README drifts from it, `CLAUDE.md` wins" — spec requires
  preserving this note.

---

## 4. Tests that assert primer content (will need updating or extending)

Grep across `tests/` for the mandate/Forbidden wording found exactly two files:

1. **`tests/delivery.test.ts`** — the primer's near-1:1 test file:
   - Line 61: `expect(formatted).toContain('AI orchestrators MUST invoke the matching metta skill')`
     inside the `formatContext` test — **breaks if the mandate's opening clause is rephrased**;
     update to the new scoped opening.
   - Lines 72–103 (`Workflow primer research discipline rule`) — unaffected.
   - Lines 105–120 (`Workflow primer Tier-2 trust model wording`) — unaffected
     (TRUST_MODEL_BULLETS untouched).
   - New assertions to add here per the change spec: mandate byte-identical across variants
     (extract-and-compare, closing the currently untested invariant), no
     `never call the CLI directly` / `any other \`metta <cmd>\`` substring in either variant,
     long variant contains `Read-only queries (permitted directly)` with the enumerated entries,
     long variant names `metta-guard-bash`, short variant contains the one-line read-only +
     fail-closed pointer, Forbidden section enumerates the mutating families.
2. **`tests/refresh.test.ts`** — `buildWorkflowSection` block (lines 106–130) asserts only
   structural headings and skill names; **no breakage expected**, but worth one added
   assertion that the emitted section contains the read-only subsection heading.

Guard tests (`tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts`,
`tests/metta-guard-mint-seam.test.ts`, `tests/metta-guard-agent-dispatch.test.ts`) exercise hook
*behavior* only — a comment-only hook edit cannot break them (spec scenario "Hook diff is
comment-only" is verified by simply re-running this suite). `tests/commands-discovery-helpers.test.ts`,
`tests/cli-install.test.ts`, `tests/cli-skills.test.ts` carry no mandate-string assertions.

---

## 5. Exact files/lines to change

| File | Location | Change |
|---|---|---|
| `src/delivery/workflow-primer.ts` | lines 1–9 | Update header comment: invariant now covers the scoped mandate; note hand-sync with the guard hook |
| `src/delivery/workflow-primer.ts` | lines 11–13 | Rewrite `MANDATE` (sketch below) |
| `src/delivery/workflow-primer.ts` | new constants near line 14 | Add `READ_ONLY_SURFACE_BULLETS` (long) and a one-line short-variant pointer string, each with a sync comment pointing at `.claude/hooks/metta-guard-bash.mjs` `ALLOWED_*` blocks |
| `src/delivery/workflow-primer.ts` | line 39 area (`workflowPrimerShort`) | Insert the one-line read-only/fail-closed pointer |
| `src/delivery/workflow-primer.ts` | line 60 | Replace Forbidden bullet with enumerated mutating families (mirror `BLOCKED_SUBCOMMANDS` + `BLOCKED_TWO_WORD`, incl. `verify`, `backlog migrate`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`) |
| `src/delivery/workflow-primer.ts` | after line 61 (or after trust-model bullets) | Add `### Read-only queries (permitted directly)` subsection + generation-time qualifier + fail-closed guidance |
| `.claude/hooks/metta-guard-bash.mjs` | comments above lines 37, 47, 89 (the three `ALLOWED_*` blocks) and optionally 66/75 (`BLOCKED_*`) | Comment-only: "Mirrored in src/delivery/workflow-primer.ts read-only subsection — keep in sync." |
| `docs/workflows/README.md` | lines 45–51 | Reword Core rule to the scoped mandate + read-only acknowledgement; keep line 51's "CLAUDE.md wins" note; keep the stub-artifact prohibition from line 49 |
| `CLAUDE.md` (metta's own) | region lines 39–101 | Regenerated from the long primer — via the `/metta-refresh` skill (direct `metta refresh` is itself Tier-2 blocked), or by hand-applying the exact `buildWorkflowSection()` output during execute and letting the next refresh confirm idempotence |
| `tests/delivery.test.ts` | line 61 + new describe block | Update/extend as itemized in section 4 |
| `tests/refresh.test.ts` | `buildWorkflowSection` block | Optional single added assertion |

## 6. Proposed wording sketch

**MANDATE (both variants, byte-identical):**

> **State-mutating metta commands MUST go through the matching metta skill — never as direct CLI calls from an AI orchestrator session.** Enforcement authority is the `metta-guard-bash` PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a read-only query surface directly. (Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.)

**Short-variant pointer (one line):**

> Read-only queries (`metta status`, `metta progress`, `metta issues list`, …) are permitted directly; the guard fails closed, so attempting a query is always safe.

**Forbidden bullet (long variant):**

> - Invoking any state-mutating metta command directly from an AI orchestrator session: `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`. Use the matching skill.

**Read-only subsection (long variant):**

> ### Read-only queries (permitted directly)
>
> The `metta-guard-bash` hook allows these directly (no skill needed). This list mirrors the hook's allow-lists at generation time — the hook, not this text, is authoritative:
> - Single-word: `status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install`
> - Two-word: `issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`
> - Bare (flags only): `roadmap`, `release`, `backlog` (e.g. `metta roadmap --json`)
>
> When in doubt about a command not listed here, attempt it — the guard fails closed and blocks anything unrecognized, so an attempt is always safe. Never pass a `--` operand terminator; the guard rejects it unconditionally.

Wording decision to surface at design time: the subsection title says "read-only" but
`iteration`/`model-escalation`/`tokens` append instrumentation records and `install` writes
scaffold files. Either hedge in prose ("read-only or instrumentation-only") or keep the spec's
exact title and add a parenthetical; the spec fixes the title, so hedge in the body.

## 7. Tradeoffs of this approach

**Pros**
- Smallest viable surface: one source file + one test file + one docs file + comment-only hook
  edit; zero runtime/build coupling (matches the "template files never inlined... hooks stay
  standalone `.mjs`" constraint that killed the shared-manifest option).
- Propagates through the existing refresh/init paths — the fix travels the same road the bug did.
- Fail-closed guidance converts future drift from "false prohibition" (hours lost, wrong
  answers) into "harmless blocked attempt" — the failure mode becomes cheap.
- Spec/stories for this change are already written against exactly this approach; no spec rework.

**Cons / risks**
- **Drift recurrence is real, not hypothetical**: the enumerated lists now live in at least four
  hand-synced places (primer strings, metta's CLAUDE.md region [auto-derived], docs README,
  `docs/internals/guard-hooks.md` tables) against one authority (the hook). Sync comments are
  advisory only.
- The spec's "entries MUST match the hook at the time of this change" scenario is manual unless
  automated (see mitigation).
- Consumer projects only get the fix on their next refresh — accepted in intent.md.

**Recommended drift mitigation (cheap, in-scope, test-only):** add a Vitest case in
`tests/delivery.test.ts` that reads `.claude/hooks/metta-guard-bash.mjs` as text, extracts the
`ALLOWED_SUBCOMMANDS` / `ALLOWED_TWO_WORD` / `ALLOWED_BARE` entries with a regex, and asserts
each appears in `workflowPrimerLong()`. This makes drift a CI failure without any runtime or
build coupling between the hook and the primer — it delivers most of the shared-manifest
option's guarantee at ~30 lines of test code. Precedent exists: the mint-seam tests already pin
the `GRACE_MS` equality across the two hook files (see comment at `metta-guard-bash.mjs:118-119`).
If the executing agent judges this beyond the spec's letter, log it as a follow-up backlog item
instead; the spec only *requires* comments.

## 8. Effort estimate

Small. ~60–80 changed/added lines in `workflow-primer.ts`, ~10 comment lines in the hook,
~15 lines in docs README, ~50–70 test lines, plus the CLAUDE.md region regeneration.
One focused session (2–4 h) including the drift-guard test; verify with
`npx vitest run tests/delivery.test.ts tests/refresh.test.ts tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts`.

## 9. Recommendation

Proceed with this approach as specced. It is the only option consistent with the project's
"hooks are standalone `.mjs`, templates never inlined" constraints, the change's intent.md
explicitly defers the shared-manifest alternative, and the drift risk — the approach's one real
weakness — is largely neutralizable with the test-only mirror check above plus the fail-closed
guidance already required by the spec. No blockers found; every file, line, and test named in
the spec exists where expected, and the hook's grown surface (`verify` blocked, `backlog
migrate`, `milestone` forms, `release status|cut`, bare `backlog`/`release`) is already
correctly captured in the change's spec.md enumerations.
