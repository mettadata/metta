# metta install deploys hooks from a hardcoded list, omitting the session-mint and agent-dispatch hooks — consumer projects' lifecycle is completely blocked

**Captured**: 2026-07-17
**Status**: resolved
**Severity**: critical

## Symptom
`metta install` deploys hooks into consumer projects from a hardcoded list, omitting the session-mint and agent-dispatch hooks. Observed live in /home/utx0/Code/zeus: `src/templates/hooks/` contains four hooks (`metta-guard-agent-dispatch.mjs`, `metta-guard-bash.mjs`, `metta-guard-edit.mjs`, `metta-session-mint.mjs`) but zeus's `.claude/hooks/` contains only the two guard hooks. Because the installed guard-bash requires the Tier-2 session credential minted by `.claude/hooks/metta-session-mint.mjs`, and that file is absent, no token can ever mint and every lifecycle command (`complete`, `finalize`, etc.) is guard-blocked — the consumer workflow is fully bricked. The agent-dispatch guard is likewise silently inert there.

## Root Cause Analysis
`install.ts` copies hooks by literal filename: `installMettaGuardHook` hardcodes `../../templates/hooks/metta-guard-edit.mjs` and `installMettaBashGuardHook` hardcodes `../../templates/hooks/metta-guard-bash.mjs`. Nothing enumerates the `src/templates/hooks/` directory, unlike `src/delivery/command-installer.ts`, which uses `readdir` over the templates dir to install all skills and agents. The two hooks added by the trust-model and fork-orphaning changes (`metta-session-mint.mjs` in commit ea089c4b2, `metta-guard-agent-dispatch.mjs` in commit c2208978f) updated metta's own `.claude/` copies and the templates dir, but no corresponding commit touched `install.ts` (its history since 1f4c70c71 contains no hook-inventory change). This is the installer-inventory variant of the template-vs-deployed drift trap: no test asserts that the installed hooks directory matches the `templates/hooks` inventory, so new template hooks silently miss the installer. The result is an internally inconsistent install — guard-bash from after the trust-model change (which demands the minted credential) ships without the mint hook that produces it.

### Evidence
- `src/cli/commands/install.ts:33` — hardcodes the single template path `templates/hooks/metta-guard-edit.mjs` (and line 66 likewise hardcodes `metta-guard-bash.mjs`); no readdir of the hooks templates dir anywhere in the file.
- `src/delivery/command-installer.ts:19` — the skills/agents installer uses `readdir` over the templates directory and copies everything, proving the drift-proof pattern already exists in the codebase but was not applied to hooks.
- `src/templates/hooks/metta-guard-bash.mjs:11` — guard-bash documents that the Tier-2 credential is minted by `.claude/hooks/metta-session-mint.mjs`, so installing guard-bash without the mint hook hard-blocks all Tier-2 lifecycle commands in consumer projects.

## Candidate Solutions
1. **Readdir-driven hook install (mirror command-installer)** — Replace the per-file hook copies in `install.ts` with a single readdir over `templates/hooks/` that copies and chmods every `.mjs` file, keeping the existing settings.json PreToolUse registration logic only for guard-bash and guard-edit (session-mint and agent-dispatch are skill/agent-frontmatter-scoped by design and need no settings registration). Add a test asserting the installed `.claude/hooks/` inventory exactly equals the `templates/hooks/` inventory. Tradeoff: any stray file dropped into templates/hooks/ ships to every consumer automatically, so the templates dir becomes a de facto public contract requiring hygiene.
2. **Keep explicit list, add completeness test only** — Add the two missing copy calls for `metta-session-mint.mjs` and `metta-guard-agent-dispatch.mjs`, plus a test that fails whenever `templates/hooks/` contains a file the installer does not copy. Tradeoff: retains the manual list as a maintenance point; every future hook still requires an installer edit, with the test converting silent drift into a build failure rather than eliminating the class.
3. **Manifest-driven install** — Introduce a hooks manifest (e.g. `templates/hooks/manifest.json`) declaring each hook plus its registration mode (settings-registered vs frontmatter-scoped), and drive both copying and settings.json registration from it, validated by Zod. Tradeoff: most robust and self-describing, but adds a new file format and schema for what is currently a four-file directory — likely over-engineering at this scale.

## Resolution

**Resolved**: 2026-08-08 (stale-issue sweep)

Fixed: install.ts is readdir-driven over src/templates/hooks/ (full inventory, completeness test); zeus re-installed and healed.
