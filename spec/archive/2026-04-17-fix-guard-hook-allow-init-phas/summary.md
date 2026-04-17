# Summary: fix-guard-hook-allow-init-phas

## What changed

`metta-guard-edit.mjs` now allow-lists two init-phase paths when no active change exists: `spec/project.md` and `.metta/config.yaml`. Any other Write/Edit target without an active change is still blocked. Removes the need for `metta-discovery` to bypass the guard via Bash heredoc during `/metta-init`.

## Files modified

- `src/templates/hooks/metta-guard-edit.mjs`
- `.claude/hooks/metta-guard-edit.mjs` (byte-identical mirror per REQ-3)

## Files added

- `tests/metta-guard-edit.test.ts` — 9 integration tests via `spawnSync` covering allow-list paths pass, non-allow-listed paths block, byte-identity between source and deployed copies

## Resolves

- `metta-discovery-agent-cannot-write-outside-an-active-change-` (minor)

## Verification

- Byte-identity: `diff src/templates/hooks/metta-guard-edit.mjs .claude/hooks/metta-guard-edit.mjs` empty
- `npm test`: 556/556 pass (44 files, +1 new file, +9 new tests)
- `npx tsc --noEmit`: clean
- Manual: `{tool_name:'Write', file_path:'spec/project.md'}` with no change → exit 0; `src/foo.ts` → exit 2 with block message
