# fix-metta-install-deploys-hooks-hardcoded-list-omitting

## Problem

`metta install` deploys Claude Code hooks into consumer projects from a hardcoded list instead of enumerating the hooks template directory. `src/templates/hooks/` ships four hooks (`metta-guard-agent-dispatch.mjs`, `metta-guard-bash.mjs`, `metta-guard-edit.mjs`, `metta-session-mint.mjs`), but `install.ts` only copies the two guard hooks: `installMettaGuardHook` hardcodes the template path `../../templates/hooks/metta-guard-edit.mjs` (install.ts:33) and `installMettaBashGuardHook` hardcodes `../../templates/hooks/metta-guard-bash.mjs` (install.ts:66). Nothing in the file does a `readdir` over `templates/hooks/`.

The consequence is critical, not cosmetic. The installed `metta-guard-bash.mjs` requires a Tier-2 session credential minted by `.claude/hooks/metta-session-mint.mjs` (documented at `src/templates/hooks/metta-guard-bash.mjs:11`). Because the mint hook is never installed, no token can ever mint in a consumer project, and every Tier-2 lifecycle command (`complete`, `finalize`, etc.) is guard-blocked — the consumer workflow is fully bricked. Observed live in `/home/utx0/Code/zeus`: `.claude/hooks/` contains only the two guard hooks. The agent-dispatch guard is likewise silently absent there.

Root cause of the drift: the trust-model change (`metta-session-mint.mjs`, commit ea089c4b2) and the fork-orphaning change (`metta-guard-agent-dispatch.mjs`, commit c2208978f) added hooks to metta's own `.claude/` and to `src/templates/hooks/`, but no commit updated `install.ts`, and no test asserts that the installed hooks match the template inventory. The drift-proof pattern already exists in the codebase — `src/delivery/command-installer.ts:19` uses `readdir` over the templates dir to install all skills and agents — but the hook installer never adopted it.

**Who is affected:** every consumer project that runs `metta install` (or has already run it, e.g. zeus). Metta's own repo is unaffected because its `.claude/` copies were updated directly by the originating commits.

## Proposal

Replace the hardcoded per-hook template paths in `src/cli/commands/install.ts` with a readdir-driven copy of the entire `src/templates/hooks/` directory, mirroring the skills/agents pattern in `src/delivery/command-installer.ts:19`. Specifically:

1. **Enumerate and copy all hooks.** During `metta install`, read the `templates/hooks/` directory and copy every hook file into the consumer's `.claude/hooks/`, preserving executable bits via `chmod 0o755` exactly as the current hardcoded copies do. A hook added to the templates dir in the future is installed with zero installer changes.
2. **Keep settings.json registration exactly as it is.** Only `metta-guard-edit.mjs` (matcher `Edit|Write|NotebookEdit|MultiEdit`) and `metta-guard-bash.mjs` (matcher `Bash`) get PreToolUse entries in `.claude/settings.json`. `metta-session-mint.mjs` and `metta-guard-agent-dispatch.mjs` are frontmatter-scoped by design and MUST NOT be registered in settings.json. The existing idempotent already-registered checks are preserved.
3. **Add an inventory-completeness test.** A test asserts that after install, the contents of the target `.claude/hooks/` directory exactly match the file inventory of `src/templates/hooks/` — so any future template hook that misses the installer fails CI instead of silently bricking consumers.
4. **Preserve install reporting.** The JSON output and human-readable console output continue to report hook installation status, extended to reflect all installed hooks rather than only the two guards.

Existing consumer projects repair themselves by re-running `metta install` (hook copies are unconditional overwrites, so the missing files appear on the next run).

## Impact

- `src/cli/commands/install.ts` — the two per-hook install functions are refactored: file copying becomes directory-enumeration-driven; settings.json registration logic for the two guard hooks is retained unchanged in behavior.
- Consumer projects — `metta install` (fresh or re-run) now deploys all four hooks; Tier-2 credential minting and the agent-dispatch guard start working in consumer projects for the first time. This unbricks `complete`, `finalize`, and all other Tier-2 lifecycle commands.
- `.claude/settings.json` in consumer projects — no behavioral change; same two PreToolUse entries, same idempotency.
- Install output — the `guard_hook_installed` / `bash_guard_hook_installed` JSON fields and console lines may be generalized to cover the full hook set; consumers of `metta install --json` output may see additional/renamed fields (to be pinned in the spec).
- Tests — new inventory-completeness test for the hooks directory; existing install tests updated to expect four hooks.
- `src/delivery/command-installer.ts` — read as the reference pattern only; not modified.

## Out of Scope

- Changing the design of any hook itself (mint logic, guard rules, dispatch behavior) — the hook template files are copied verbatim, not edited.
- Registering `metta-session-mint.mjs` or `metta-guard-agent-dispatch.mjs` in settings.json PreToolUse — they are frontmatter-scoped by design.
- Applying the same readdir pattern to the statusline installer or other single-file template copies (statusline is a single canonical file, not a growing inventory).
- Automatic migration/repair of already-installed consumer projects beyond what re-running `metta install` provides (no new `metta repair` or version-check machinery).
- Restructuring `install.ts` more broadly (stack detection, gate scaffolding, git init, config writing all unchanged).
- Uninstall/removal of hooks that no longer exist in the templates dir (stale-hook cleanup is a separate concern).
