# Spec Traceability

**Verdict**: PASS

## Summary
All 6 requirements in spec.md trace to evidence in code and tests. Round 2 spec alignment reconciled earlier drift.

## Traceability

### R1: Guard hook fails closed on enforced subcommands
- **Evidence**: `src/templates/hooks/metta-guard-bash.mjs:38-46` (SKILL_ENFORCED_SUBCOMMANDS), lines 142-150 (offender logic), lines 169-179 (stderr). Tests: `tests/metta-guard-bash.test.ts` cases (a)-(e) in both source/deployed describes.
- **Status**: Verified.

### R2: Preserves inline bypass for non-enforced
- **Evidence**: `src/templates/hooks/metta-guard-bash.mjs:148` — non-enforced path falls to `return !inv.skillBypass`.
- **Test**: case (f) in guard-bash unit tests.
- **Status**: Verified.

### R3: Audit log written to `.metta/logs/guard-bypass.log`
- **Evidence**: `appendAuditLog` at hook lines 104-122; called on block paths and non-enforced-bypass observations.
- **Tests**: cases (g)-(i); integration test (c).
- **Status**: Verified.

### R4: Read-only subcommands unaffected
- **Evidence**: `ALLOWED_SUBCOMMANDS` + `ALLOWED_TWO_WORD` untouched; classify() returns 'allow' before offender logic considered.
- **Test**: case (g) asserts no audit log for `metta status`.
- **Status**: Verified.

### R5: Template and deployed hook byte-identical
- **Evidence**: `diff -q src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` empty. Parity test `tests/metta-guard-bash.test.ts` runs source + deployed describe blocks. `tests/agents-byte-identity.test.ts` now covers `metta-skill-host` too.
- **Status**: Verified.

### R6: Skills using inline METTA_SKILL=1 for enforced subcommands migrated
- **Evidence**: all 6 skills (metta-issue, metta-fix-issues, metta-propose, metta-quick, metta-auto, metta-ship) now have `context: fork` + `agent: metta-skill-host` in frontmatter. Byte-identical across `.claude/` and `src/templates/` trees.
- **Status**: Verified. (End-to-end skill dispatch will be validated by the first post-merge use of `/metta-issue`.)
