# Verification Summary — fix-metta-install-deploys-hooks-hardcoded-list-omitting

**Verdict: PASS**

Verified against `intent.md` and `spec/issues/metta-install-deploys-hooks-from-a-hardcoded-list-omitting.md` by exercising real behavior in a throwaway consumer fixture (scratchpad, cleaned up afterward). Implementation commit: `475965dc6`.

## Check 1 — Fresh install deploys the exact template inventory

Ran `node dist/cli/index.js install --git-init --json` in a fresh fixture directory.

- `.claude/hooks/` contained EXACTLY the four files in `src/templates/hooks/` (`diff` of directory listings: exact match, no extras): `metta-guard-agent-dispatch.mjs`, `metta-guard-bash.mjs`, `metta-guard-edit.mjs`, `metta-session-mint.mjs`.
- Every installed hook byte-identical to its template (`cmp` per file: all IDENTICAL) and executable (`rwxr-xr-x`, 0755).
- `.claude/settings.json` registered PreToolUse entries for guard-edit (matcher `Edit|Write|NotebookEdit|MultiEdit`) and guard-bash (matcher `Bash`) ONLY — mint and agent-dispatch not registered, per the frontmatter-scoped design (intent Proposal #2).
- JSON output includes new `hooks_installed` array listing all four hooks, plus preserved `guard_hook_installed: true` and `bash_guard_hook_installed: true` (intent Proposal #4; `src/cli/commands/install.ts:410`).

Evidence: readdir-driven installer at `src/cli/commands/install.ts:38-53` (`installMettaHooks` enumerates the templates dir with `readdir` at line 43); registration split into `registerGuardEditHook` (line 56) and `registerGuardBashHook` (line 81), copy logic removed from both.

## Check 2 — Heal proof: the trust model functions in a consumer project

This is the point of the fix: previously the mint hook was never installed, so no Tier-2 token could ever mint and `complete`/`finalize` were permanently guard-blocked in consumers.

In the fixture, simulated the consumer skill lifecycle:

1. `node dist/cli/index.js propose "add a hello endpoint"` → change `hello-endpoint` created (exit 0).
2. Wrote a real `intent.md` for the change.
3. Minted a token exactly as a Tier-2 skill frontmatter hook does: piped a synthetic PreToolUse Bash event (`tool_name: "Bash"`, `cwd: <fixture>`, command `metta complete intent ...`) into the INSTALLED `<fixture>/.claude/hooks/metta-session-mint.mjs` with slug `metta-next` → exit 0, token written at `.metta/scratch/skill-session.token` with `skill: "metta-next"`, `subcommands: ["complete","finalize"]`, 300000ms TTL.
4. Piped the same synthetic event into the INSTALLED `<fixture>/.claude/hooks/metta-guard-bash.mjs` → **exit 0** (token accepted); audit log entry `{"verdict":"allow","subcommand":"complete","reason":"session-credential-verified","tier":"session"}`.
5. Ran `node dist/cli/index.js complete intent --change hello-endpoint --json` → **exit 0**, artifact completed, `next: ["implementation"]`.
6. Negative: `rm .metta/scratch/skill-session.token`, re-piped the same event to guard-bash → **exit 2**, stderr `Blocked direct CLI call 'metta complete intent'...`, audit entry `{"verdict":"block","reason":"missing-credential","tier":"session"}`.

Conclusion: with the full inventory installed, mint → guard-accept → complete works end-to-end in a consumer project, and the guard still blocks without a credential. The previously-bricked lifecycle is unbricked purely by the installer change.

## Check 3 — Re-install idempotency (and repair)

- Re-ran `metta install` in the same fixture: exit 0, `hooks_installed` again lists all four; md5 of `.claude/settings.json` and `.metta/config.yaml` **unchanged** (checksum verified before/after); hooks inventory still exact and byte-identical; still exactly 2 PreToolUse entries (no duplicates).
- Repair scenario (zeus's observed state): deleted `metta-session-mint.mjs` and `metta-guard-agent-dispatch.mjs` from the fixture's `.claude/hooks/`, re-ran install → both files restored, full inventory present. Confirms intent's claim that existing consumers self-repair by re-running `metta install`.

## Check 4 — Regression test enumerates dynamically (no hardcoded inventory)

`tests/cli-install.test.ts:238-265` ("inventory completeness"):

- Lines 242-244: `readdir` over `src/templates/hooks/` builds the expected file list dynamically — NOT a hardcoded array.
- Lines 246-248: `readdir` over the installed `.claude/hooks/`.
- Line 253: `expect(installedFiles).toEqual(templateFiles)` — exact set equality, so a future hook added to templates but missed by the installer (or by the build's copy-templates step, since the installer reads from `dist/templates/hooks/`) fails this assertion; extraneous installed files also fail.
- Lines 254-255: sanity anchors that the two previously-omitted hooks are in the template set.
- Lines 257-264: per-file byte-identity (`Buffer.equals`) and executable-bit (`mode & 0o111`) assertions.

Templates were not modified during verification.

## Check 5 — Gates

| Gate | Result |
|------|--------|
| `npx vitest run` | 87 files passed, 1450 tests passed, 0 failed (245.73s) |
| `npx tsc --noEmit` | clean |
| `npm run lint` (tsc --noEmit) | clean |
| `npm run build` | success (templates copied to dist, incl. `dist/templates/hooks/`) |

## Scope compliance

- settings.json registration behavior unchanged (guards only) — confirmed live and in diff.
- No hook template file edited by the change (`git show 475965dc6 --stat`: only `install.ts` + `cli-install.test.ts`).
- No manifest machinery, no stale-hook cleanup — matches Out of Scope.

**Verdict: PASS** — implementation matches intent; heal proof demonstrated end-to-end.
