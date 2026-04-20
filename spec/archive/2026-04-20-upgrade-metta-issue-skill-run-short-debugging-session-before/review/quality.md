# Quality Review: upgrade-metta-issue-skill-run-short-debugging-session-before

**Verdict**: PASS

## Summary

Round 2 fixes landed cleanly. Both round 1 criticals (template drift on `metta-issue` and `metta-fix-issues` skills) are resolved — the templates and their deployed copies are byte-identical. The WARN on magic-number documentation in `readPipedStdin` is fixed with clear block comments explaining the 100ms timeout, the `pause()`/`unref()` cleanup rationale, and partial-buffer-on-timeout behavior. The full test suite is green (58 files, 818/818 passing, 635s duration). The two deferred WARNs (no direct unit test for `readPipedStdin`; broadened `vitest.config.ts` include) are acceptable and non-blocking — the task rules explicitly exclude "missing-unit-test-for-helper" from FAIL criteria.

## Findings

### Critical

None.

### Warnings

- `src/cli/helpers.ts:299-349` — `readPipedStdin` still lacks a dedicated unit test. Coverage is indirect via the 9 previously-timing-out CLI tests in `tests/cli.test.ts` that now pass (validating the pipe-no-writer hang is bounded by the 100ms timeout). Not a blocker per task rules, but a direct unit test covering (a) TTY short-circuit, (b) end-emits-before-timeout, (c) timeout-with-partial-buffer, and (d) error path would improve regression safety for a timing-sensitive helper.
- `vitest.config.ts:7` — `include` now matches both `tests/**/*.test.ts` and `src/**/*.test.ts`. Accepted as a deliberate project-wide decision so co-located tests (e.g. `src/issues/issues-store.test.ts`) run without a second config. Worth noting in `spec/project.md` conventions if co-location becomes standard practice, since the convention section currently implies `tests/` is the canonical test root.

### Notes

- `diff -q src/templates/skills/metta-issue/SKILL.md .claude/skills/metta-issue/SKILL.md` → no output (identical). Round 1 template drift fixed (commit `07aff46ad`).
- `diff -q src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md` → no output (identical). Round 1 template drift fixed (commit `8bf2cf307`).
- `src/cli/helpers.ts:316-321, 339-343` — round 2 added the requested explanatory comments. The block at 316-321 explains why stdin hangs without a writer attached and why the timer plus `pause()`/`unref()` bounds the wait. The block at 339-342 documents the decision to preserve the partial buffer on timeout (commit `7875e73a5`).
- `src/cli/helpers.ts:304` — the comment `"After setEncoding('utf8'), chunks are guaranteed strings — no Buffer branch needed."` correctly justifies the string-only `onData` signature.
- `src/cli/commands/issue.ts:18-23` — stdin payload is read first, trimmed for presence check only, then falls back to the `description` argument; the missing-description guard still fires correctly when both are absent. `stdinPayload` is passed to `IssuesStore.create(..., body, ...)` untrimmed, which is correct for preserving body formatting (matches the `readPipedStdin` contract: "Does NOT trim — callers must handle whitespace-only payloads themselves").
- `src/issues/issues-store.ts:34-48` — `parseIssue` handles H2-structured bodies correctly. The `i > 0` guard on `descStart` and the verbatim body return prevent H2 fragments from leaking into title/metadata fields. The inline comment at lines 43-44 documents why H2 headings in the body are safe.
- `src/issues/issues-store.test.ts:1-53` — 3 focused scenarios that exercise real parser behavior (freeform round-trip, H2 preservation, metadata boundary). No trivial happy-path-only coverage; titles are asserted to NOT leak H2 fragments (`expect(issue.title).not.toContain('##')`), which is the exact regression class that motivated the change.
- `npx vitest run` → 58 files, 818/818 tests passing. Suite fully green, duration 635.69s.
