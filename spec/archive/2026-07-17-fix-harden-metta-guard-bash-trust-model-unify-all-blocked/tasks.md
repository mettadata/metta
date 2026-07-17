# Tasks: fix-harden-metta-guard-bash-trust-model-unify-all-blocked

<!--
Requirement -> Task mapping (orchestration-guard spec requirements + user stories):

- Inline Command-Text Tokens Never Authorize a Blocked Subcommand -> 2.1, 4.1, 5.1 (US-1)
- Fork-Dispatched Subcommands Require Verified Caller Identity -> 2.1, 2.2, 5.1 (US-3)
- Main-Session Lifecycle Subcommands Require a Non-Forgeable Session Credential -> 1.1, 1.2, 2.1, 2.2, 5.1 (US-2)
- Unrecognized metta Subcommands Fail Closed -> 2.1, 2.2 (regression-only, untouched logic)
- Every Rejection and Every Tier-2 Acceptance Is Recorded -> 2.1, 2.2 (US-2, US-3)
- Skill Contracts Reference Only the Sanctioned Authorization Mechanism -> 3.1, 4.1 (US-1, US-4)
- Forked Agents Are Blocked From Running Background Bash -> 2.1, 2.2 (regression-only, untouched logic) (US-3)
- The Trust Model Is Documented Where Operators and Contributors Will Read It -> 3.3 (US-5)
- US-1 (forgeable inline token grants nothing) -> 2.1, 4.1, 5.1
- US-2 (main-session lifecycle skills keep working) -> 1.1, 1.2, 2.1, 2.2, 3.1, 5.1
- US-3 (fork-tier enforcement unchanged) -> 2.1, 2.2, 4.1, 5.1
- US-4 (complete migration, no dangling legacy prefixes) -> 3.1, 3.2, 4.1
- US-5 (two-tier trust model documented) -> 3.3
-->

## Batch 1: Mint hook (new, inert)

### 1.1 [x] Create the session-mint hook

**Files:**
- `.claude/hooks/metta-session-mint.mjs` (new)
- `src/templates/hooks/metta-session-mint.mjs` (new, byte-identical mirror)

**Action:**
Create the new `PreToolUse` mint hook per design.md's API Design and Data Model sections. Script
signature: `metta-session-mint.mjs <skill-slug>` (slug is `argv[2]`, a static ship-time string never
sourced from event data). On each invocation:
- Read stdin PreToolUse JSON (same `readStdin`/`JSON.parse`-with-swallow pattern as
  `metta-guard-bash.mjs`); if `event.tool_name !== 'Bash'`, exit 0 without minting.
- Resolve `<cwd>/.metta/scratch/skill-session.token` (`event.cwd ?? process.cwd()`).
- Hard-code the `SKILL_SCOPES` map exactly as specified in design.md's Data Model section (9 keys:
  `metta-next`, `metta-plan`, `metta-execute`, `metta-verify`, `metta-refresh`, `metta-import`,
  `metta-init`, `metta-backlog`, `metta-fix-gap`; two-word scope entries keyed `"<sub>:<third>"`).
  If `argv[2]` is not a key in `SKILL_SCOPES`, exit 0 without minting (defensive — should never
  happen since only the 9 Tier-2 skills invoke this script).
- Read the existing token file if present (swallow I/O/parse errors as absent). Mint a fresh token
  (`{ token: crypto.randomUUID(), skill: slug, subcommands: SKILL_SCOPES[slug], mintedAt: Date.now(),
  ttlMs: 300000 }`) when the file is absent, unparsable, or `Date.now() - existing.mintedAt >=
  existing.ttlMs * 0.8` (sliding TTL, re-primed at 80% per design.md). Otherwise leave the existing
  file untouched (no unnecessary write/rotation on every call).
- `mkdirSync(dirname(path), { recursive: true })` before writing; `writeFileSync(path,
  JSON.stringify(token), { mode: 0o600 })`.
- Swallow all I/O errors (never break the calling skill's Bash call on a mint failure) and always
  exit 0 — this hook never blocks, it only mints.
- File header comment: one paragraph explaining this is the Tier-2 credential-minting half of the
  two-tier trust model, cross-referencing `metta-guard-bash.mjs` as the validating half, and stating
  the slug argument is ship-time-authored (not orchestrator-controlled).

Write `src/templates/hooks/metta-session-mint.mjs` first, then copy byte-for-byte to
`.claude/hooks/metta-session-mint.mjs` (or vice versa) so the two are identical from the first
commit — this pair follows the same deployed/template byte-identity convention as
`metta-guard-bash.mjs`.

Since this task creates a new hook file (not yet wired into any guard logic), the self-gating
discipline still applies: run `node --check` on both copies immediately after writing them, before
any other Bash call in this task.

**Verify:**
```
node --check .claude/hooks/metta-session-mint.mjs
node --check src/templates/hooks/metta-session-mint.mjs
diff .claude/hooks/metta-session-mint.mjs src/templates/hooks/metta-session-mint.mjs
chmod +x .claude/hooks/metta-session-mint.mjs src/templates/hooks/metta-session-mint.mjs
```
`diff` must produce no output (empty). Both `node --check` invocations must exit 0.

**Done:** Both copies exist, are byte-identical, executable, and `node --check` passes on both. The
hook is not yet referenced by any `SKILL.md` frontmatter or by `metta-guard-bash.mjs`, so it has no
functional effect on the running guard yet.

---

### 1.2 [x] Mint hook unit tests

**Files:**
- `tests/metta-session-mint.test.ts` (new)

**Action:**
Write unit tests for `.claude/hooks/metta-session-mint.mjs`, following the existing `runHook` /
synthetic-stdin-JSON pattern established in `tests/metta-guard-bash.test.ts` (sandboxed `cwd` under
a temp dir, spawn the script with stdin piped, inspect the resulting token file — no live hook
wiring required). Cover:
- **Fires and writes a token**: no token file present, script invoked with a valid `PreToolUse Bash`
  event and slug `metta-next` -> `.metta/scratch/skill-session.token` exists after the call, mode
  `0600`, valid JSON.
- **Payload shape**: parsed token has exactly the keys `token, skill, subcommands, mintedAt, ttlMs`;
  `token` is a v4-UUID-shaped string; `skill` equals the slug argument; `subcommands` equals
  `SKILL_SCOPES['metta-next']` (`['complete', 'finalize']`); `ttlMs` is `300000`.
- **Rotation on stale token**: pre-seed a token file with `mintedAt` older than 80% of `ttlMs` ago ->
  after invocation, `token` value differs from the seeded value and `mintedAt` is refreshed to
  approximately `Date.now()`.
- **No rotation on fresh token**: pre-seed a token file with `mintedAt` within the last 10% of
  `ttlMs` -> after invocation, `token` value is unchanged (sliding TTL does not thrash on every
  call).
- **Scope table**: parametrized case asserting each of the 9 `SKILL_SCOPES` entries (`metta-next,
  metta-plan, metta-execute, metta-verify, metta-refresh, metta-import, metta-init, metta-backlog,
  metta-fix-gap`) produces the exact `subcommands` array specified in design.md's Data Model
  section, including the two-word `"backlog:add"`-style scoping.
- **Unknown slug is a no-op**: an unrecognized slug argument exits 0 and writes no token file.
- **Non-Bash tool_name is a no-op**: `tool_name !== 'Bash'` exits 0 and writes no token file.

This task only adds a test file; it does not touch either hook script. No `node --check`
self-gating step is required here since no hook file is edited.

**Verify:**
```
npx vitest run tests/metta-session-mint.test.ts
```
All new tests pass; no existing test file is modified.

**Done:** `tests/metta-session-mint.test.ts` exists, exercises fire/rotate/payload-shape/scope-table
behavior of `metta-session-mint.mjs`, and passes.

---

## Batch 2: Guard Tier-2 branch (dual-accept transition window)

### 2.1 [x] Add the Tier-2 branch to metta-guard-bash.mjs, dual-accepting legacy + token

**Files:**
- `.claude/hooks/metta-guard-bash.mjs`
- `src/templates/hooks/metta-guard-bash.mjs`

**Action:**
This is the pivot task described in design.md's "Ordering Constraint (the guard gates its own
author)" section, step 2. Edit **both** copies identically (edit one, then `diff` to confirm, or
apply the same edit to both):

1. Add a `readSessionToken(cwd)` helper: resolve `<cwd>/.metta/scratch/skill-session.token`, read +
   `JSON.parse`, return `null` on any I/O or parse error (never throw). After a successful parse,
   structurally validate the shape (constitution-check finding): `token` is a non-empty string,
   `skill` is a string, `subcommands` is an array of strings, `mintedAt`/`ttlMs` are finite numbers —
   any shape mismatch returns `null` so a valid-JSON-wrong-shape file fails closed as
   `missing-credential`, never throws inside the offender predicate.
2. Replace the `offender` predicate's non-enforced branch (`return !inv.skillBypass;` at line 170)
   with the Tier-2 branch from design.md's API Design section, **plus a temporarily-retained legacy
   fallback**, in this exact precedence order, each arm tagged inline:
   ```js
   // Tier 1, unchanged (kept above, untouched)
   if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
     return !(inv.skillBypass && isTrustedSkillCaller(event));
   }
   // Tier 2: fork body calling a Tier-2 sub from inside a Tier-1 skill's own body
   if (isTrustedSkillCaller(event)) return false;
   // REMOVE-AFTER-SHIP: legacy inline METTA_SKILL=1 prefix, dual-accepted only during this
   // change's own migration window (see design.md Ordering Constraint). Deleted in the final
   // implementation task once the Tier-2 token path is test-proven.
   if (inv.skillBypass) return false;
   const tok = readSessionToken(event.cwd);
   if (!tok) return { offender: true, reason: 'missing-credential' };
   if (Date.now() - tok.mintedAt >= tok.ttlMs) return { offender: true, reason: 'credential-expired' };
   const key = inv.third ? `${inv.sub}:${inv.third}` : inv.sub;
   if (!tok.subcommands.includes(key)) return { offender: true, reason: 'subcommand-not-in-scope' };
   return false;
   ```
   Adjust the surrounding `invocations.find((inv) => {...})` callback so it can propagate the
   `{ offender: true, reason }` object (not just a boolean) up to the caller — thread `reason`
   through to the block below verdict computation, defaulting to the existing `'block'` /
   `'unknown'` reason strings when the Tier-2 branch did not fire.
3. Add `tier: 'fork' | 'session' | null` to `appendAuditLog`'s emitted entry per design.md's Audit
   Log section. Call `appendAuditLog` for:
   - every Tier-2 rejection (`missing-credential`, `credential-expired`,
     `subcommand-not-in-scope`) with `tier: 'session'`,
   - every Tier-2 acceptance (the `isTrustedSkillCaller` OR valid-token accept paths) with
     `tier: 'session'`, `reason: 'session-credential-verified'` — this is new; today's code only
     logs rejections and Tier-1 `allow_with_bypass`,
   - existing Tier-1 reject/`background-bash-from-fork` paths get `tier: 'fork'`,
   - the `unknown`-subcommand and generic `block` paths get `tier: null`.
   Keep the legacy `allow_with_bypass` logging call for the `REMOVE-AFTER-SHIP` branch's accept path
   during the transition window only.
4. Update the two user-facing `process.stderr.write` messages that currently say `prefix with
   METTA_SKILL=1` (the `unknown` block at line ~207 and the generic `block` at line ~218) to instead
   name the sanctioned skill entry point and mention the session-credential mechanism, per spec
   requirement *Unrecognized metta Subcommands Fail Closed* and *Skill Contracts Reference Only the
   Sanctioned Authorization Mechanism* — do not delete the `REMOVE-AFTER-SHIP` legacy fallback logic
   itself yet (task 4.1 does that), only the stale guidance text that would mislead a reader mid-
   window.
5. Do **not** touch: `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, `BLOCKED_SUBCOMMANDS`,
   `BLOCKED_TWO_WORD`, `SKILL_ENFORCED_SUBCOMMANDS`, `SKILL_HINT_MAP`, `tokenize()`, `classify()`,
   `isTrustedSkillCaller()`, or the `run_in_background`-from-fork rejection block — all preserved
   verbatim per US-3 and the Migration Map.

**Self-gating discipline (mandatory, before any other Bash call in this task or the next):**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
```
Run this immediately after saving each edit to either copy — before issuing any other Bash tool
call in the session, since this hook gates the executor's own subsequent calls (intent scope item
6, US-4 acceptance criterion 4).

**Verify:**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
diff .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs
grep -n "REMOVE-AFTER-SHIP" .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs
```
Both `node --check` calls exit 0; `diff` is empty; the `REMOVE-AFTER-SHIP` tag is present exactly
once in each copy, on the legacy fallback line.

**Done:** Both guard-hook copies dual-accept the legacy `METTA_SKILL=1` inline prefix and the new
Tier-2 token for non-enforced, non-fork-caller invocations; Tier-1 logic and the background-Bash
rejection are byte-for-byte unchanged; every Tier-2 accept/reject and every fork-tier reject is now
audit-logged with a `tier` field; `node --check` passes on both copies.

---

### 2.2 [x] Guard tests for the Tier-2 branch and legacy dual-accept window

**Files:**
- `tests/metta-guard-bash.test.ts`
- `tests/cli-metta-guard-bash-integration.test.ts`

**Action:**
Extend both existing test files (do not create new ones — design.md's Artifacts Produced section
notes "no new harness needed"). Add cases, writing a token file into
`<sandboxCwd>/.metta/scratch/skill-session.token` before calling `runHook` where a token is under
test:

- **Fresh valid token, in-scope subcommand**: `metta complete intent` with a token whose
  `subcommands` includes `'complete'` and `mintedAt` within `ttlMs` -> exit 0, no stderr rejection.
- **Expired token**: same but `mintedAt` older than `ttlMs` ago -> exit 2, stderr does not credit
  the token, audit log entry has `reason: 'credential-expired'`, `tier: 'session'`.
- **Fabricated/missing token**: no token file at all -> exit 2, audit log `reason:
  'missing-credential'`, `tier: 'session'`.
- **Out-of-scope subcommand**: valid unexpired token whose `subcommands` does not include the
  invoked subcommand (e.g. token minted for `metta-refresh` used to call `metta finalize`) -> exit
  2, audit log `reason: 'subcommand-not-in-scope'`.
- **Fork-body pass-through**: `isTrustedSkillCaller(event)` true (trusted `agent_type`), no token
  file at all, Tier-2 subcommand invoked -> exit 0 (fork body calling a Tier-2 sub from inside a
  Tier-1 skill body is accepted without a token, per design.md's key decision).
- **Legacy still accepted during the window**: `METTA_SKILL=1 metta finalize` with no token file and
  no trusted `agent_type` -> exit 0 (this is the transition-window behavior; this specific test case
  is the one 4.1 will delete/flip when the legacy branch is removed — tag it with a comment noting
  that).
- **Tier-1 regression, untouched**: re-run (do not remove) the existing enforced-subcommand and
  `run_in_background`-from-fork cases already present in `tests/metta-guard-bash.test.ts` to confirm
  they still pass unmodified after the edit — no new assertions needed here beyond confirming the
  existing suite is green.
- **Session-tier acceptance is logged**: after a fresh-token-accept run, read
  `<sandboxCwd>/.metta/logs/guard-bypass.log` and assert the last line has `tier: 'session'`,
  `reason: 'session-credential-verified'`.

No hook file is edited in this task, so the self-gating `node --check` step is not required here —
but confirm task 2.1's `node --check` already passed before running these tests (it must have, per
2.1's Done criteria).

**Verify:**
```
npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts
```
All tests pass, including every pre-existing test in both files (no regressions).

**Done:** Both guard test files cover fresh/expired/missing/out-of-scope token cases, fork-body
pass-through, the legacy dual-accept window, and session-tier audit logging; the full pre-existing
Tier-1 suite still passes unmodified.

---

## Batch 3: Skill migration, config-loader cleanup, documentation

### 3.1 [x] Migrate all 15 SKILL.md pairs

**Files:**
- `.claude/skills/{metta-auto,metta-backlog,metta-execute,metta-fix-gap,metta-fix-issues,metta-import,metta-init,metta-issue,metta-next,metta-plan,metta-propose,metta-quick,metta-refresh,metta-ship,metta-verify}/SKILL.md`
- `src/templates/skills/{same 15 dirs}/SKILL.md`

**Action:**
For all 15 skill pairs (30 files), delete the `METTA_SKILL=1 ` text from every call-site line
(~154 lines total per the intent's count) so each becomes a bare `metta <cmd>` invocation, per
design.md's Migration Map:

- **6 Tier-1 skills** (`metta-propose`, `metta-quick`, `metta-auto`, `metta-ship`, `metta-issue`,
  `metta-fix-issues`): delete the `METTA_SKILL=1 ` prefix text only. No frontmatter change — these
  already carry `context: fork` / `agent: metta-skill-host` and rely on the unchanged
  `isTrustedSkillCaller` + Tier-2-fork-passthrough path added in 2.1.
- **9 Tier-2 skills** (`metta-next`, `metta-plan`, `metta-execute`, `metta-verify`,
  `metta-refresh`, `metta-import`, `metta-init`, `metta-backlog`, `metta-fix-gap`): delete the
  `METTA_SKILL=1 ` prefix text, AND add the `hooks:` frontmatter block from design.md's API Design
  section to each `SKILL.md`'s YAML frontmatter, with the skill-specific slug argument:
  ```yaml
  hooks:
    PreToolUse:
      - matcher: Bash
        hooks:
          - type: command
            command: .claude/hooks/metta-session-mint.mjs <skill-slug>
          <skill-slug> = metta-next | metta-plan | metta-execute | metta-verify |
                          metta-refresh | metta-import | metta-init | metta-backlog | metta-fix-gap
  ```
  Preserve research.md's race-handling guidance: confirm (do not need to add, if already present)
  that each of these 9 skill bodies' first Bash action after skill launch is an already-allow-listed
  call (`metta status --json` / `metta next --json` pattern) before any Tier-2 subcommand — if a
  skill body currently issues a Tier-2 call as its very first Bash action, insert the allow-listed
  status/next call ahead of it so the mint hook has a prior sequential cycle to complete in.

Apply each edit to both the `.claude/skills/` deployed copy and the `src/templates/skills/`
template copy identically, keeping them byte-identical (per US-4 acceptance criterion 2).

No hook file is touched in this task, so no `node --check` step applies here — this task only edits
`SKILL.md` files.

**Verify:**
```
grep -rc "METTA_SKILL=1" .claude/skills/ src/templates/skills/ | grep -v ':0$'
for d in metta-auto metta-backlog metta-execute metta-fix-gap metta-fix-issues metta-import metta-init metta-issue metta-next metta-plan metta-propose metta-quick metta-refresh metta-ship metta-verify; do
  diff ".claude/skills/$d/SKILL.md" "src/templates/skills/$d/SKILL.md" || echo "MISMATCH: $d"
done
grep -l "hooks:" .claude/skills/{metta-next,metta-plan,metta-execute,metta-verify,metta-refresh,metta-import,metta-init,metta-backlog,metta-fix-gap}/SKILL.md | wc -l
```
The first command returns no output (zero remaining `METTA_SKILL=1` call sites). The diff loop
prints no `MISMATCH` lines. The `hooks:` grep count is exactly `9`.

**Done:** All 15 `SKILL.md` pairs (30 files) have zero `METTA_SKILL=1` occurrences; the 9 Tier-2
skills carry the mint-hook frontmatter with their correct slug; deployed and template copies are
byte-identical for all 15 skills.

---

### 3.2 [x] Remove the dead config-loader RESERVED entry

**Files:**
- `src/config/config-loader.ts`
- `tests/config-loader.test.ts` (or the existing config-loader test file — locate via grep for
  `RESERVED` / `METTA_SKILL` before editing)

**Action:**
Per design.md's Components table and Migration Map: delete the `METTA_SKILL` `RESERVED` set entry
at `config-loader.ts:77` and its preceding comment block (`:73-76`) now that the inline env-var
prefix is fully retired (task 3.1 removed every call site that could set it). Locate the exact
current line range first (line numbers may have drifted since research.md/design.md were written)
via `grep -n "METTA_SKILL\|RESERVED" src/config/config-loader.ts`, then remove the entry and its
comment cleanly, leaving `RESERVED` either as an empty set with an updated comment (if the pattern
is expected to be reused for a future transitional case) or removed entirely if `RESERVED` has no
other members — inspect the surrounding code to decide which, and confirm the choice does not break
any other `RESERVED`-dependent logic in the same file.

Update the corresponding config-loader test(s) that assert `METTA_SKILL` env vars are suppressed
from the "unrecognized key" warning — either delete that specific test case (if `RESERVED` becomes
empty/removed) or update it if a different mechanism replaces it.

**Verify:**
```
grep -n "METTA_SKILL" src/config/config-loader.ts
npx vitest run tests/config-loader.test.ts
npx tsc --noEmit
```
The grep returns no matches. The test file passes. `tsc --noEmit` reports no errors.

**Done:** `config-loader.ts` no longer references `METTA_SKILL` anywhere; its test suite reflects
the removal and passes; the codebase type-checks cleanly.

---

### 3.3 [x] Update guard-hook header, CLAUDE.md, and workflow-primer for the two-tier model

**Files:**
- `.claude/hooks/metta-guard-bash.mjs`
- `src/templates/hooks/metta-guard-bash.mjs`
- `src/delivery/workflow-primer.ts`
- `CLAUDE.md` (regenerated, not hand-edited — see Verify)

**Action:**
Per design.md's Components table (`workflow-primer.ts:23,36`) and spec requirement *The Trust Model
Is Documented Where Operators and Contributors Will Read It* / US-5:

1. Rewrite the guard hook's file-header comment block (lines 1-5 in both copies, the
   "Primary skill-initiated bypass / Secondary bypass / Emergency bypass" block) to describe the
   two-tier model instead: Tier 1 (fork-dispatched: `propose, quick, auto, ship, issue, fix-issue`,
   authorized by `event.agent_type` set by the runtime for a forked `metta-skill-host` subagent, not
   forgeable from command text), Tier 2 (main-session lifecycle: `complete, finalize, refresh,
   import, init, fix-gap`, plus scoped two-word `backlog add/done/promote` and `changes abandon`,
   authorized by the `.metta/scratch/skill-session.token` minted by
   `.claude/hooks/metta-session-mint.mjs` and rotated on a sliding TTL — not derivable from reading
   any skill file), and the emergency bypass (disable the hook in `.claude/settings.local.json`,
   unchanged). Apply identically to both copies.
2. Rewrite `workflow-primer.ts`'s "How to work" text (both locations near lines 23 and 36 — re-grep
   for the current line numbers before editing) to document both tiers at the level of detail US-5's
   acceptance criteria require: which subcommands belong to each tier, why each signal is
   non-forgeable, and that `.claude/settings.local.json` remains the emergency bypass for humans/CI.
   Remove any residual text instructing an orchestrator to type `METTA_SKILL=1`.
3. Regenerate `CLAUDE.md` from the updated primer using the project's own `/metta-refresh`-equivalent
   mechanism (the workflow-primer is the generator source; do not hand-edit `CLAUDE.md`'s "How to
   work" section directly — confirm how `workflow-primer.ts` output reaches `CLAUDE.md` via
   `codegraph_callers` or grep before choosing the exact regeneration command, since this may be a
   build step or a dedicated regen script rather than the `/metta-refresh` skill itself, to avoid
   invoking the skill mid-task-execution).

**Self-gating discipline (mandatory, since this task edits both guard-hook copies):**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
```
Run this immediately after saving the header-comment edit to either copy, before any other Bash
call in this task.

**Verify:**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
diff .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs
grep -in "Primary/Secondary/Emergency\|METTA_SKILL=1" .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs CLAUDE.md
npx tsc --noEmit
```
Both `node --check` calls exit 0; `diff` is empty; the grep for the retired model's language and
`METTA_SKILL=1` returns no matches in any of the three files; `tsc --noEmit` reports no errors.

**Done:** The guard hook's header comment (both copies), `workflow-primer.ts`, and the regenerated
`CLAUDE.md` all describe the two-tier trust model accurately with no remaining reference to the
retired single-tier inline-prefix model.

---

## Batch 4: Delete the legacy branch (final implementation task)

### 4.1 [x] Remove the REMOVE-AFTER-SHIP legacy branch and flip its test coverage

**Files:**
- `.claude/hooks/metta-guard-bash.mjs`
- `src/templates/hooks/metta-guard-bash.mjs`
- `tests/metta-guard-bash.test.ts`
- `tests/cli-metta-guard-bash-integration.test.ts`

**Action:**
Per design.md's "Ordering Constraint" step 4, this task runs only after task 2.2's Tier-2 tests
(fresh/expired/fabricated/out-of-scope/missing token cases, plus fork-body pass-through) are
confirmed green. Edit both guard-hook copies to delete the `// REMOVE-AFTER-SHIP:` legacy fallback
line added in 2.1:
```js
// DELETE this line:
if (inv.skillBypass) return false;
```
so the Tier-2 branch becomes purely `isTrustedSkillCaller(event) OR validSessionToken`, with no
inline-command-text acceptance path remaining anywhere in the file. Also remove the now-dead
`allow_with_bypass` / `skillBypass`-only logging branch in `appendAuditLog`'s call sites if it is no
longer reachable (re-inspect after the deletion — `skillBypass` on `SKILL_ENFORCED_SUBCOMMANDS`
members is still legitimate input data used by Tier 1's existing check, so do not remove the
`skillBypass` field from `tokenize()`'s return value or Tier 1's `!(inv.skillBypass &&
isTrustedSkillCaller(event))` check — only the Tier-2 fallback arm is deleted).

Update the "legacy still accepted during the window" test case added in 2.2 (both test files) to
assert the opposite outcome: `METTA_SKILL=1 metta finalize` with no token file and no trusted
`agent_type` now returns exit 2, with the rejection reason `missing-credential` (since
`inv.skillBypass` is no longer consulted and the flow falls through to the token check with no token
present).

**Self-gating discipline (mandatory — this is a hook edit):**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
```
Run this immediately after saving the deletion to either copy, before any other Bash call in this
task.

**Verify:**
```
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
diff .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs
grep -rn "REMOVE-AFTER-SHIP\|METTA_SKILL" .claude/skills/ src/templates/skills/ .claude/hooks/ src/templates/hooks/ src/config/config-loader.ts
npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts
```
Both `node --check` calls exit 0; `diff` is empty; the grep for `REMOVE-AFTER-SHIP` and
`METTA_SKILL` across skills/hooks/config-loader returns zero matches (US-4's Independent Test
Criteria, verified in full here); the full guard test suite passes with the flipped legacy-branch
assertion.

**Done:** No code path in either guard-hook copy accepts inline command text as sufficient
authorization for any blocked subcommand (spec requirement *Inline Command-Text Tokens Never
Authorize a Blocked Subcommand* fully satisfied); the transition-window dual-accept branch is
completely gone; `node --check` passes on both copies; the full repository has zero remaining
`METTA_SKILL` references in skills, hooks, and `config-loader.ts`.

---

## Batch 5: Full verification sweep

### 5.1 [x] Full test/build sweep and live synthetic-event story proofs

**Files:** none (verification only; no source edits)

**Action:**
Run the complete verification sweep and produce the story-level synthetic-event proofs called for
by stories US-1, US-2, and US-3's Independent Test Criteria, piping hand-authored `PreToolUse` JSON
events into `.claude/hooks/metta-guard-bash.mjs` directly (matching the pattern
`echo '<json>' | node .claude/hooks/metta-guard-bash.mjs; echo "exit:$?"`) to confirm end-to-end
behavior outside the test harness as well as within it:

- **US-1 proof**: pipe `{"tool_name":"Bash","cwd":"...","tool_input":{"command":"METTA_SKILL=1 metta finalize"}}`
  with no `agent_type` and no token file present -> exit 2, stderr names the sanctioned skill entry
  point, does not credit the inline token.
- **US-2 proof**: pre-seed a valid unexpired token scoped to `finalize` under
  `<tmpcwd>/.metta/scratch/skill-session.token`, pipe `{"tool_name":"Bash","cwd":"...","tool_input":{"command":"metta finalize"}}`
  with no `agent_type` -> exit 0. Re-run with the token deleted -> exit 2.
- **US-3 proof**: pipe `{"tool_name":"Bash","agent_type":"metta-skill-host","tool_input":{"command":"metta propose \"foo\""}}`
  -> exit 0; same without `agent_type` -> exit 2; same with `tool_input.run_in_background: true` and
  `agent_type: "metta-skill-host"` -> exit 2 with the background-Bash rejection message.

**Verify:**
```
npx vitest run
npx tsc --noEmit
npm run build
grep -rn "METTA_SKILL" .claude/skills/ src/templates/skills/ .claude/hooks/ src/templates/hooks/ src/config/config-loader.ts src/delivery/workflow-primer.ts CLAUDE.md
node --check .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
node --check .claude/hooks/metta-session-mint.mjs
node --check src/templates/hooks/metta-session-mint.mjs
diff .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs
diff .claude/hooks/metta-session-mint.mjs src/templates/hooks/metta-session-mint.mjs
```
`vitest run` — full suite green, zero failures. `tsc --noEmit` — zero errors. `npm run build` —
succeeds, template copy step completes without error. The `METTA_SKILL` grep across all listed
paths returns zero matches. All four `node --check` calls exit 0. Both `diff` calls are empty. The
three hand-piped synthetic-event proofs above produce the documented exit codes and stderr content.

**Done:** The full repository test suite, type-check, and build all pass; zero `METTA_SKILL`
references remain anywhere in shipped code, skills, hooks, config-loader, or documentation; both
hook pairs are byte-identical and pass `node --check`; live synthetic-event proofs for US-1, US-2,
and US-3 all produce the spec-mandated outcomes.
