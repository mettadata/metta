# fix-issue-metta-install-should

## Problem

`metta install` calls `runRefresh(root, false)` (lines 178-183 of `src/cli/commands/install.ts`) and includes `CLAUDE.md` in its git commit (`git add .metta/ spec/ CLAUDE.md`). This violates the install/init boundary shipped in `split-metta-install-metta-init`.

The split established a clear contract:
- `metta install` — pure file scaffolding (dirs, config, skills, guard hook, commit)
- `metta init` → `/metta:init` — discovery interview, `project.md` population, CLAUDE.md generation

The violation produces three concrete problems:

1. **Stale CLAUDE.md on fresh install.** `runRefresh` reads `spec/project.md` and the active specs directory. On a fresh install, `project.md` is a blank template and `spec/specs/` is empty, so the generated CLAUDE.md contains no project-specific content. It looks authoritative but is meaningless.

2. **CLAUDE.md committed before discovery runs.** The install commit captures `CLAUDE.md` with blank template content. When the user later runs `/metta:init` and the discovery agent populates `project.md`, a second refresh is needed to propagate those answers into CLAUDE.md — but nothing triggers it automatically. The init commit (`git add spec/ .metta/` in the discovery agent) never stages `CLAUDE.md`, so the file can sit stale in the working tree.

3. **Re-running install overwrites curated CLAUDE.md.** A user who has run `metta install`, completed `/metta:init`, and manually edited CLAUDE.md will lose their edits if they re-run `metta install`, because `runRefresh` unconditionally rewrites the marker sections.

All three symptoms trace to the same root cause: `install` reaches into content generation that belongs to the init layer.

## Proposal

### 1. Remove `runRefresh` from `install`

Delete the try/catch block at lines 177-183 of `src/cli/commands/install.ts`:

```typescript
// Generate CLAUDE.md using the same code as metta refresh
try {
  const { runRefresh } = await import('./refresh.js')
  await runRefresh(root, false)
} catch {
  // Refresh failure doesn't block init
}
```

`install` MUST NOT import or invoke `runRefresh`.

### 2. Remove `CLAUDE.md` from the install git commit

Change the `git add` call from:

```bash
git add .metta/ spec/ CLAUDE.md
```

to:

```bash
git add .metta/ spec/
```

`install` MUST NOT stage or commit `CLAUDE.md`.

### 3. Add `runRefresh` call to `metta init`

In `src/cli/commands/init.ts`, after `buildDiscoveryInstructions` completes and output is emitted, call `runRefresh(root, false)`. This call is the canonical trigger for CLAUDE.md generation in the init flow.

Note: `metta init` currently only emits discovery instructions; actual project.md population happens in the discovery agent spawned by `/metta:init`. Placing `runRefresh` at the end of `init.ts` would regenerate CLAUDE.md with still-blank project.md. The correct placement is inside the `/metta:init` skill body (step 4), after the discovery agent writes project.md and commits it.

### 4. Update `/metta:init` skill to call refresh after discovery commit

Add a step to `.claude/skills/metta-init/SKILL.md` instructing the orchestrator to run `metta refresh` (or invoke `runRefresh` via `metta refresh --json`) after the discovery agent's commit, then commit CLAUDE.md separately:

```
git add CLAUDE.md
git commit -m "chore: generate CLAUDE.md from discovery"
```

### 5. Remove CLAUDE.md from install human-mode output

The human-readable `console.log` block in `install.ts` does not currently print a "Created: CLAUDE.md" line, so no text change is needed there. Confirm the JSON output (`outputJson`) also does not reference CLAUDE.md — it currently does not.

### 6. Update install tests

In `tests/cli.test.ts`, any test that asserts `CLAUDE.md` exists after running `metta install` MUST be moved to an init-flow test or removed. Tests for `install` MUST NOT assert CLAUDE.md presence.

## Impact

- **`metta install`**: No longer produces or commits CLAUDE.md. The install commit contains only `.metta/`, `spec/`, and `.claude/`. This is a behavior change for existing scripts or docs that rely on CLAUDE.md being present after install.
- **`/metta:init` skill**: Gains an explicit `metta refresh` step and a CLAUDE.md commit. The skill already orchestrates the full init flow; this extends it by two operations (refresh + commit).
- **`metta init` (CLI command)**: No functional change to the TypeScript source beyond confirming it does not call `runRefresh`. Discovery instructions are emitted as before.
- **CLAUDE.md lifecycle**: Is now absent until `/metta:init` completes. Any documentation stating "CLAUDE.md is created by `metta install`" must be updated to "CLAUDE.md is created by `/metta:init`".
- **Tests**: `cli.test.ts` install assertions that check CLAUDE.md must be relocated to init-flow tests. Likely one to three test cases affected.
- **Existing installed repos**: Unaffected. CLAUDE.md is already present; nothing removes it. Re-running install no longer overwrites it, which is an improvement.

## Out of Scope

- Changing the content or structure of CLAUDE.md or the refresh pipeline.
- Changing what questions the discovery agent asks or how `spec/project.md` is populated.
- Auto-refreshing CLAUDE.md on `metta complete`, `metta finalize`, or `metta ship`.
- Teaching `metta propose`, `metta execute`, or any other lifecycle command about refresh.
- Adding a `--no-refresh` flag to install or init.
- Changing the `metta refresh` command itself (`src/cli/commands/refresh.ts`).
- Non-Claude-Code AI tool adapters.
