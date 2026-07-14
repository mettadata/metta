# Verification: fix-metta-guard-edit-hook-blocks-edit-write-files-outside

**Verdict: PASS**

Verified on branch `metta/fix-metta-guard-edit-hook-blocks-edit-write-files-outside`, 2026-07-14.

## What was verified

The intent requires an early "outside project root" allow check in the guard hook's
path-scoping logic — exiting 0 when `relPath.startsWith('..')` or `isAbsolute(relPath)` —
applied identically to both the installed hook and the template source, with existing
in-repo block and allow-list behavior unchanged.

Implementation evidence: `.claude/hooks/metta-guard-edit.mjs:74-76` and
`src/templates/hooks/metta-guard-edit.mjs:74-76` — the check sits after `relPath`
computation (line 69) and before the `ALLOW_LIST`/`ALLOW_PREFIXES` checks, inside the
`filePath` truthy branch only, exactly as specified.

## Live hook invocations

Exercised exactly as Claude Code invokes it: a PreToolUse JSON event
(`{"tool_name": ..., "tool_input": {"file_path": ...}}`) piped to
`node <hook> ` on stdin. Because this repo currently has an active change (this one),
the no-active-change condition was simulated with a temp-dir fixture (as in
`tests/metta-guard-edit.test.ts`) plus a `metta` shim on PATH deterministically
returning `{"changes": [], "message": "no active change"}`.

| Case | Payload file_path | Installed hook | Template hook |
|------|-------------------|----------------|---------------|
| (a) outside root, absolute | `/tmp/outside-test.md` (Write) | exit 0, no stderr | exit 0 |
| (b) inside root, unmatched | `<projectRoot>/src/index.ts` (Write) | exit 2, stderr `metta-guard: Write blocked — no active metta change.` + nudge/bypass text | exit 2 |
| (c) outside root, ..-relative | `../escape.md` (Edit) | exit 0, no stderr | exit 0 |

Case (b) confirms the guard's core in-repo protection is preserved, with the block
message unchanged (nudge to `/metta:quick`, emergency-bypass instructions intact).

## Gates

- `npx vitest run tests/metta-guard-edit.test.ts` — **19/19 passed**, covering both hook
  copies: outside-root absolute path allowed (test at
  `tests/metta-guard-edit.test.ts:96`), `..`-escape allowed (line 111), allow-list
  (`spec/project.md`, `.metta/config.yaml`) and allow-prefixes (`spec/issues/`,
  `spec/backlog/` `.md`-only) unchanged, non-allow-listed in-repo paths still blocked
  (line 135), non-guarded tools pass through, and byte-identity of source vs deployed
  hook (line 165).
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (aliases tsc --noEmit).
- `npm run build` — succeeded; `copy-templates` step ships `src/templates/hooks/` to
  `dist/templates/hooks/`.

## Byte-identity

- `diff .claude/hooks/metta-guard-edit.mjs src/templates/hooks/metta-guard-edit.mjs` — identical.
- `diff src/templates/hooks/metta-guard-edit.mjs dist/templates/hooks/metta-guard-edit.mjs` (post-build) — identical.

## Scope check

No changes to the guarded tool set, active-change detection (`metta status --json`),
allow-list/prefix contents, block message text, or project-root determination
(`process.cwd()`), matching the intent's Out of Scope section. Temp fixtures were
removed after verification.
