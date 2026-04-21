# Quality Review: harden-metta-config-yaml-lifecycle-across-three-related-bugs

**Verdict**: PASS_WITH_WARNINGS

## Summary

The change lands cleanly across 8 source files plus template pairs. Template drift is zero, naming conventions are correct, no dead imports remain, and the full test suite is green at 835/835 across 60 files. Two warnings concern test coverage — the `VerificationConfigSchema.strict()` rejection path and the metta-verifier byte-identity parity — neither blocks shipping but both should be queued for follow-up. All critical checks pass.

## Findings

### Critical

None.

### Warnings

- `src/schemas/project-config.ts:58-63` — `VerificationConfigSchema` uses `.strict()` and `VerificationStrategyEnum` enumerates four values, but no dedicated schema test exercises (a) rejection of `strategy: 'magic'` (spec.md scenario "invalid strategy enum value is rejected with a field-level error"), or (b) rejection of an unknown sub-key under `verification:` (e.g. `verification: { strategy: 'tests_only', extra: 'x' }`). The `tests/schemas.test.ts` file contains `.strict()` coverage for `ChangeMetadataSchema`, `ComplexityScoreSchema`, and `git.merge_strategy` enum rejection, but nothing for `VerificationConfigSchema`. This leaves two spec scenarios without direct unit-test evidence. Add a `describe('VerificationConfigSchema', ...)` block with two cases (bad enum value, bad sub-key).

- `tests/agents-byte-identity.test.ts:7-10` — The byte-identity test array enumerates only `metta-product`. `metta-verifier.md` pair is not included even though the design-doc risk #7 (design.md:380) explicitly calls for parity tests on templates touched by this change. The pair is byte-identical today (verified via `diff -q`), but without the test a future edit to only one copy will silently diverge them — exactly the failure mode the spec is trying to prevent. Add `'metta-verifier'` to the `agents` array.

- `src/config/config-writer.test.ts:33-41` — The comment-preservation test asserts only that the literal substring `# comment above project` survives the round-trip; it does not verify the comment stays immediately above the mutated `stacks:` line as required by spec.md scenario "comment above mutated key is preserved" ("on the line immediately preceding the `stacks:` key"). Strengthen the assertion with a regex such as `/# comment above project\n(?:[^\n]*\n)*?\s*stacks:/` or inspect the node's `commentBefore`.

### Notes

- `src/config/repair-config.ts:81` — The non-`unrecognized_keys` branch logs `dropped invalid key '${path}'` while the `unrecognized_keys` branch at line 72 logs `dropped unrecognized key '${key}'`. Two slightly different phrasings for conceptually similar removals. Cosmetic only; the test at `tests/cli.test.ts:503` asserts the `'dropped unrecognized key'` string explicitly.

- `src/config/config-writer.ts:3` — `YAMLSeq` and `Scalar` are imported as value constructors; fine under the `yaml@2.8.3` API. The fall-through `else` at line 29 for non-flow existing arrays (and line 33 for non-array values) both call `doc.setIn(path, value)` — the two branches could be consolidated without hurting readability, but splitting them makes the flow-preservation intent explicit.

- `src/cli/index.ts:96-123` — The preflight hook block is well-documented. The `CONFIG_PARSE_EXEMPT_COMMANDS` set (`install`, `init`, `doctor`, `update`, `completion`) and the two-line comment above it clearly explain the exemption rationale. The `parseAsync().catch()` safety net at line 127-132 is a sensible belt-and-suspenders. Meets the focus-area 7 bar without caveat.

- `src/cli/commands/install.ts:2` — `readFile` and `writeFile` imports are both still used (11 call sites between settings.json handling, gate scaffolding, and template writes). The refactor to use `setProjectField` for the `stacks:` write did not create dead imports; correct.

- `vitest.config.ts:7` — `include: ['tests/**/*.test.ts', 'src/**/*.test.ts']` picks up the two new co-located test files (`src/config/config-writer.test.ts`, `src/config/repair-config.test.ts`). Both ran and passed in the 835/835 total.

- `src/config/repair-config.ts:111-137` — `dedupMap` walks the map items in reverse and tracks seen keys, which correctly implements last-occurrence-wins. The `keyStr === null` branch skips non-string/non-number/non-boolean keys silently — probably correct for config files but worth a one-line comment.

- `src/index.ts:30-31` — Both `./config/config-writer.js` and `./config/repair-config.js` are barrel-exported as required by spec.md.

- Full suite run: `npx vitest run` reports `Test Files  60 passed (60)` and `Tests  835 passed (835)` in 682.69s. No failures, no skips flagged.

- Templates verified byte-identical via `diff -q .claude/skills/metta-init/SKILL.md src/templates/skills/metta-init/SKILL.md` and `diff -q .claude/agents/metta-verifier.md src/templates/agents/metta-verifier.md` — both returned empty output.

- Naming is consistent with metta conventions: `setProjectField` (camelCase function), `repairProjectConfig` (camelCase function), `RepairResult` (PascalCase interface), `VerificationStrategyEnum` and `VerificationConfigSchema` (PascalCase Zod exports), `ConfigParseError` (PascalCase custom Error class extending `Error` per the conventions in CLAUDE.md).

- `setProjectField` does not duplicate any write path in `config-loader.ts` (which is read-only); `repairProjectConfig` is a pure function and deliberately bypasses `loadYamlFile` to remain operable on corrupt bytes — no duplication.
