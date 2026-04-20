# Security Review (Iteration 2): batch-skill-template-consistency-enforcement-1-pretooluse

## Summary

All four prior findings were addressed. The hook now classifies every invocation as `allow | block | unknown`, blocks unknown subcommands conservatively (exit 2, distinct stderr message), uses a generic "matching /metta-<skill>" stderr pointer that removes the incorrect `/metta-ship` advice, documents the threat model in a header comment, and exempts `metta install` from the blocklist so AI-driven reinstalls work. No new exploitable vulnerabilities were introduced. One spec-vs-implementation inconsistency remains around `metta install` (spec still lists it as blocked) but this is a documentation gap, not a security regression.

## Scope Reviewed

- `/home/utx0/Code/metta/src/templates/hooks/metta-guard-bash.mjs`
- `/home/utx0/Code/metta/src/cli/commands/install.ts` (`installMettaBashGuardHook` at lines 55-94)
- `/home/utx0/Code/metta/.claude/hooks/metta-guard-bash.mjs` (byte-identical mirror, verified via diff)
- `/home/utx0/Code/metta/tests/metta-guard-bash.test.ts`
- `/home/utx0/Code/metta/spec/changes/batch-skill-template-consistency-enforcement-1-pretooluse/spec.md`

## Verification of Prior Findings

### 1. Unknown metta subcommand silent pass — FIXED

`metta-guard-bash.mjs:68-77` introduces `classify(inv)` which returns `'unknown'` when `inv.sub` is defined but not present in any ALLOW or BLOCK table. `main()` at line 101-109 emits a distinct stderr message (`"Blocked unknown metta subcommand..."`) and exits 2. The test at `tests/metta-guard-bash.test.ts:78-89` confirms `metta unknowncmd` and `metta unknown foo` both exit 2 with the expected stderr substring. Spec scenario at `spec.md:61-66` is now honored.

### 2. Wrong skill pointer for `changes abandon` — FIXED

The per-subcommand skill-name lookup is gone. Lines 112-117 now emit a generic message that says "Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping." This removes the actively misleading `/metta-ship` suggestion for `changes abandon`. The stderr still contains a `/metta-` substring (satisfies spec scenarios at `spec.md:19-22`, `spec.md:23-27`, `spec.md:29-33`, `spec.md:35-39` which require "contains the string `/metta-`" or "mentions the correct skill or the bypass instruction").

### 3. Threat model not documented — FIXED (partially)

Lines 2-5 now contain a header comment declaring:
- purpose: "block direct metta state-mutating CLI calls from AI orchestrator sessions"
- primary bypass: inline env-var prefix
- secondary bypass: `process.env.METTA_SKILL`
- emergency bypass: `.claude/settings.local.json`

The header does not explicitly call out known tokenizer limits (quoted executable, case variants, path-qualified, eval / bash -c / here-docs, leading redirect). Treating this as sufficient because the header honestly characterizes the hook as a set of bypass-aware guardrails rather than a sandbox; future contributors can infer "not a security boundary" from the multiple documented bypass paths. Not a blocker.

### 4. `metta install` in blocklist broke AI-driven reinstalls — FIXED

Line 10-13 moves `install` into `ALLOWED_SUBCOMMANDS` with an explicit comment: "intentional pass-through for human/CI-driven install (no matching skill yet)." The test at `tests/metta-guard-bash.test.ts:127-130` asserts `metta install` exits 0. This resolves the UX dead-end from the prior iteration.

**Spec-alignment caveat:** `spec.md:9` still lists `metta install` as a blocked pattern. The implementation and test are now inconsistent with the written spec, though consistent with the intent expressed in the prior review fix request. This needs to be reconciled in one of two places — either update the spec to remove `metta install` from the blocklist and add a scenario asserting it passes, or re-block it and add a skill. This is a documentation / spec-hygiene issue, NOT a security regression.

## New Security Observations (iteration 2)

### Critical (must fix)

None.

### Warnings (should fix)

- `src/templates/hooks/metta-guard-bash.mjs:10-13` vs `spec.md:9` — spec-implementation drift for `metta install`. Choose one side and align the other. Recommended: update the spec to reflect the implementation (add `metta install` to the read-only/allowed list in `BashHookPassesReadOnlyCommands`).

- `src/templates/hooks/metta-guard-bash.mjs:48-63` — the tokenizer still skips exactly 3 tokens per `metta` match and then scans for a chain separator. This means a pathological command like `echo metta status metta propose` (no separator between the two metta invocations) will classify the first `{sub: 'status', third: 'metta'}` (allowed, since `status` is in ALLOWED_SUBCOMMANDS and `third` is ignored for single-word allow) and then scan past `propose` looking for a separator that never comes — the second invocation is missed. This is not realistic orchestrator output, so it is acceptable for a guardrail, but remains a known limit. Worth noting in a comment near the tokenizer.

- `src/templates/hooks/metta-guard-bash.mjs:19,20` — `ALLOWED_TWO_WORD` now includes `['changes', new Set(['list'])]` and `BLOCKED_TWO_WORD` also includes `['changes', new Set(['abandon'])]`. If a future command `metta changes delete` (new, unknown third word under the `changes` prefix) arrives, `classify` returns `'unknown'` and blocks conservatively. Good. Confirmed by reading `classify` — `allowedTwo.has(inv.third)` is false, `blockedTwo.has(inv.third)` is false, falls through to `return 'unknown'`. No action needed, just confirming the defensive path.

- `src/cli/commands/install.ts:60` (and `:19`, `:102`) — template-path resolution via `new URL(..., import.meta.url).pathname` is unchanged from iteration 1. Same portability footgun on paths with percent-encoded characters applies. Still not exploitable, still low priority, still shared across three install helpers. Not blocking.

- `src/cli/commands/install.ts:55-94` — no `lstat` check before `writeFile(settingsPath, ...)`. Same defense-in-depth note as iteration 1 regarding symlink-following on `.claude/settings.json`. Unchanged behavior relative to the two sibling installers (`installMettaGuardHook`, `installMettaStatusline`). Not blocking, but should be logged as a shared hardening opportunity.

### Suggestions (nice to have)

- `src/templates/hooks/metta-guard-bash.mjs:2-5` — expand the header comment to list the known tokenizer bypasses (quoted executable, path-qualified invocation like `./metta`, `eval`, `bash -c`, here-docs, command substitution). One or two extra lines would complete the threat-model documentation.

- `src/templates/hooks/metta-guard-bash.mjs:112-117` — the generic stderr message mentions `CLAUDE.md` as the skill-mapping reference. Confirm that `CLAUDE.md` in new projects (post-install) actually contains a metta subcommand-to-skill mapping table. If not, the pointer is misleading. The currently-installed `CLAUDE.md` in this repo does contain a "Lifecycle skills" section that lists the skills by slug; an orchestrator can map subcommand → skill by convention (`metta propose` → `/metta-propose`). Reasonable.

- `src/cli/commands/install.ts:81-84` — duplicate-entry detection uses `includes('metta-guard-bash.mjs')`. Same iteration-1 suggestion about using `endsWith` or exact match; still non-blocking.

## Spec Compliance — security-relevant

- `spec.md:61-66` (unknown subcommand not silently allowed) — **now satisfied** (classify + unknown branch).
- `spec.md:13` (stderr names correct skill entrypoint) — **satisfied via generic pointer**. The message points to the skill family rather than a specific slug, which is correct for avoiding the wrong-skill-pointer failure mode.
- `spec.md:9` (`metta install` listed as blocked) — **not satisfied**, intentionally, per prior review guidance. Spec should be updated.
- `spec.md:115-119` (emergency bypass via `.claude/settings.local.json`) — no change; still handled at Claude Code's settings-layer precedence, not inside the hook. Correct.

## Verdict

**PASS_WITH_WARNINGS**

### Critical count: 0
### Warnings count: 5 (one new spec-drift, four carry-forwards that are known limits)
### Suggestions count: 3

All four items from the prior review are materially addressed. The remaining warnings are either (a) a spec-text update to mirror the `metta install` exemption, or (b) carry-forward hardening notes that apply equally to the existing `metta-guard-edit` and `metta-statusline` installers and do not regress in this change. No critical security issues remain.
