# Design: split-metta-install-metta-init

## Approach

The current `src/cli/commands/init.ts` (which paradoxically registers the `install` command) is split into three files. `src/cli/commands/install.ts` takes the scaffolding body verbatim and exports `registerInstallCommand`. A new `src/cli/commands/init.ts` exports `registerInitCommand` and implements the discovery-only command. All brownfield detection logic — `STACK_FILES`, `BROWNFIELD_MARKERS`, `detectBrownfield`, and `buildDiscoveryInstructions` — is extracted into `src/cli/commands/discovery-helpers.ts` (see naming rationale in Risks section) and imported by `init.ts` alone; `install.ts` does not import it. The `--skip-scan` option moves from `install` to `init`. The `discovery` and `mode` fields are removed from `install --json` output. `metta init` acquires a precondition check: if `.metta/config.yaml` is absent it exits 3 with a JSON error pointing to `metta install`. The `/metta-init` skill body (`src/templates/skills/metta-init/SKILL.md`) requires no change — it already calls `metta init --json` and reads exactly the `discovery` object that the new `init.ts` will emit. `src/cli/index.ts` gains one new import line and one new registration call; all other files are untouched.

---

## Components

### `src/cli/commands/install.ts`

**Exported function:** `registerInstallCommand(program: Command): void`

**Scaffold steps (in order):**
1. Read `program.opts().json` for output mode.
2. Resolve `root` via `createCliContext().projectRoot`.
3. Check `.git/` existence. If absent and `--json`: emit `{ status: "git_missing", message: "..." }` and `process.exit(3)`. If absent and interactive: prompt user; on rejection `process.exit(3)`. If absent and `--git-init`: run `git init`.
4. `mkdir` `.metta/`, `spec/specs/`, `spec/changes/`, `spec/archive/` with `{ recursive: true }`.
5. `writeFile` `.metta/config.yaml` with `{ flag: 'wx' }` (no-op if exists).
6. `writeFile` `spec/project.md` with `{ flag: 'wx' }` (no-op if exists).
7. `writeFile` `.metta/.gitignore` with `{ flag: 'wx' }` (no-op if exists).
8. Detect Claude Code presence (`.claude/` or `CLAUDE.md`); create `.claude/` if absent; call `installCommands(claudeCodeAdapter, root)`.
9. Call `runRefresh(root, false)` from `./refresh.js`; swallow errors.
10. Stage `.metta/`, `spec/`, `CLAUDE.md`, `.claude/` and commit `chore: initialize metta`; set `committed = true` only on success.
11. Emit output (JSON or human).

**Exit codes:**
- `0` — success
- `3` — git precondition missing (`git_missing`)
- `4` — unexpected runtime error

**JSON success payload:**
```
{
  status: "initialized",
  git_initialized: boolean,
  committed: boolean,
  directories: string[],       // [".metta/", "spec/"]
  constitution: string,        // "spec/project.md"
  detected_tools: string[],    // ["Claude Code"]
  installed_commands: string[] // list of installed command names
}
```
Fields removed vs. today (`src/cli/commands/init.ts:208-219`): `discovery` (removed), `mode` (removed).

**JSON error payload (exit 3):**
```
{ status: "git_missing", message: string }
```

**JSON error payload (exit 4):**
```
{ error: { code: 4, type: "install_error", message: string } }
```
Convention matches `outputJson` from `src/cli/helpers.ts:75-77`.

**Human-readable final line (line 236 equivalent):**
```
Next: run `metta init` to discover project context
```

---

### `src/cli/commands/init.ts`

**Exported function:** `registerInitCommand(program: Command): void`

**Steps (in order):**
1. Read `program.opts().json` and `options.skipScan`.
2. Resolve `root` via `createCliContext().projectRoot`.
3. **Precondition check:** if `.metta/config.yaml` does not exist → emit error JSON and `process.exit(3)`.
4. Call `detectBrownfield(root, options.skipScan)` from `./discovery-helpers.js`.
5. Call `buildDiscoveryInstructions(root, isBrownfield, detectedStack, detectedDirs)` from `./discovery-helpers.js`.
6. Emit output (JSON or human). Write nothing to the filesystem.

**Precondition:** `.metta/config.yaml` must exist (`existsSync(join(root, '.metta', 'config.yaml'))`). This is the canonical signal that `metta install` has been run.

**Exit codes:**
- `0` — success
- `3` — `.metta/` absent (`metta_not_installed`)
- `4` — unexpected runtime error

**JSON success payload:**
```
{
  discovery: {
    agent: {
      name: "discoverer",
      persona: string,
      tools: string[]
    },
    mode: "brownfield" | "greenfield",
    detected: {
      stack: string[],
      directories: string[]
    },
    questions: Array<{ id: string; question: string; hint: string }>,
    output_paths: {
      constitution: string,   // absolute path to spec/project.md
      context_file: string,   // absolute path to CLAUDE.md
      config: string          // absolute path to .metta/config.yaml
    },
    constitution_template: string,
    context_template: string
  }
}
```
Structure is a lift-and-shift of the return value of `buildDiscoveryInstructions` (`src/cli/commands/init.ts:250-342`), wrapped in a top-level `discovery` key. The skill (`src/templates/skills/metta-init/SKILL.md:14`) reads `discovery.*` directly — this wrapping is already correct in the skill.

**JSON error payload (exit 3):**
```
{
  error: {
    code: 3,
    type: "metta_not_installed",
    message: "No .metta/ directory found. Run `metta install` first."
  }
}
```

**JSON error payload (exit 4):**
```
{ error: { code: 4, type: "init_error", message: string } }
```

---

### `src/cli/commands/discovery-helpers.ts`

**Exported symbols (signatures preserved from `src/cli/commands/init.ts:24-75` and `src/cli/commands/init.ts:250-342`):**

```typescript
export const STACK_FILES: Record<string, string>

export const BROWNFIELD_MARKERS: string[]

export async function detectBrownfield(
  root: string,
  skipScan: boolean,
): Promise<{ isBrownfield: boolean; detectedStack: string[]; detectedDirs: string[] }>

export function buildDiscoveryInstructions(
  root: string,
  isBrownfield: boolean,
  detectedStack: string[],
  detectedDirs: string[],
): {
  agent: { name: string; persona: string; tools: string[] }
  mode: 'brownfield' | 'greenfield'
  detected: { stack: string[]; directories: string[] }
  questions: Array<{ id: string; question: string; hint: string }>
  output_paths: { constitution: string; context_file: string; config: string }
  constitution_template: string
  context_template: string
}
```

This file is consumed exclusively by `src/cli/commands/init.ts`. `install.ts` does not import it. No barrel export from `src/index.ts`.

---

## Data Model

### `install --json` success payload (final)

```json
{
  "status": "initialized",
  "git_initialized": false,
  "committed": true,
  "directories": [".metta/", "spec/"],
  "constitution": "spec/project.md",
  "detected_tools": ["Claude Code"],
  "installed_commands": ["metta:propose", "metta:init"]
}
```

Fields removed vs. today's output at `src/cli/commands/init.ts:208-219`:
- `discovery` — removed; owned by `metta init`
- `mode` — removed; install no longer calls `detectBrownfield`

### `init --json` success payload (final)

```json
{
  "discovery": {
    "agent": {
      "name": "discoverer",
      "persona": "You are a senior technical interviewer...",
      "tools": ["Read", "Write", "Grep", "Glob", "Bash", "AskUserQuestion"]
    },
    "mode": "brownfield",
    "detected": {
      "stack": ["Rust"],
      "directories": ["src"]
    },
    "questions": [
      { "id": "corrections", "question": "...", "hint": "..." }
    ],
    "output_paths": {
      "constitution": "/abs/path/to/spec/project.md",
      "context_file": "/abs/path/to/CLAUDE.md",
      "config": "/abs/path/to/.metta/config.yaml"
    },
    "constitution_template": "# ...",
    "context_template": "# ..."
  }
}
```

The `discovery` object shape is identical to what `buildDiscoveryInstructions` returns today. The skill at `src/templates/skills/metta-init/SKILL.md:14-22` already expects this exact structure.

### Error payload shape (both commands)

Follows the `outputJson` convention from `src/cli/helpers.ts:75-77`:

```json
{ "error": { "code": 3, "type": "metta_not_installed", "message": "..." } }
```

For `install` git precondition, the existing status-keyed form is kept for backward compat with the existing test at `tests/cli.test.ts:49`:

```json
{ "status": "git_missing", "message": "..." }
```

---

## API Design

### CLI surface

```
metta install [--git-init] [--json]
metta init [--skip-scan] [--json]
```

`--skip-scan` is removed from `install` and added to `init`. On `install`, brownfield detection no longer occurs, so the flag has no meaning there. Removal rather than deprecation is appropriate at pre-1.0.

`--git-init` stays on `install` only. `init` is read-only and cannot create a git repo.

`--json` is a global flag on `program` (already wired at `src/cli/index.ts:44`); both commands read it via `program.opts().json`.

### Registration in `src/cli/index.ts`

```typescript
import { registerInstallCommand } from './commands/install.js'  // replaces line 4
import { registerInitCommand }    from './commands/init.js'      // new line

// ...

registerInstallCommand(program)  // replaces line 49: registerInitCommand(program)
registerInitCommand(program)     // new line, after registerInstallCommand
```

Registration order: `install` before `init`. This matches the logical user workflow and has no functional impact since Commander.js routes by name.

### Post-install human-readable message

Replace `src/cli/commands/init.ts:236`:
```
Next: run /metta:init to complete project discovery
```
with:
```
Next: run `metta init` to discover project context
```

---

## Dependencies

### `src/cli/commands/install.ts` imports

```typescript
import { Command } from 'commander'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { createCliContext, outputJson } from '../helpers.js'
import { claudeCodeAdapter } from '../../delivery/claude-code-adapter.js'
import { installCommands } from '../../delivery/command-installer.js'
// runRefresh imported dynamically: await import('./refresh.js')
```

No new external packages.

### `src/cli/commands/init.ts` imports

```typescript
import { Command } from 'commander'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createCliContext, outputJson } from '../helpers.js'
import { detectBrownfield, buildDiscoveryInstructions } from './discovery-helpers.js'
```

No new external packages.

### `src/cli/commands/discovery-helpers.ts` imports

```typescript
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'
```

No new external packages.

---

## Risks and Mitigations

**Risk: user re-runs `metta install` expecting re-scaffolding to also redo discovery.**
Mitigation: the final human-readable line of `install` explicitly directs users to `metta init`. The `install --json` payload contains no `discovery` key, making the separation machine-evident. Document the split in the changelog.

**Risk: `install --json` consumers parsing `discovery` or `mode` fields will break.**
Mitigation: research confirmed zero in-tree consumers of `install`'s `discovery` field (the only consumer, the `/metta-init` skill, already calls `metta init --json`). This is an accepted pre-1.0 breaking change. Add a changelog entry. No migration shim needed.

**Risk: file rename (`init.ts` → `install.ts` + new `init.ts`) breaks imports.**
Mitigation: only `src/cli/index.ts:4` imports from the current `init.ts`. Update that single file. Grep confirms no other source file imports from `src/cli/commands/init.ts`.

**Risk: leading-underscore naming convention for `_discovery.ts` is not established in this codebase.**
Resolution: do not use `_discovery.ts`. No leading-underscore files exist anywhere under `src/` (confirmed by filesystem search). Use `discovery-helpers.ts` instead — this follows the existing kebab-case file naming seen in `fix-gap.ts`, `command-installer.ts`, etc. The "internal" signal is provided by the absence of a barrel export, not the filename prefix.

**Risk: `init.ts` precondition check on `.metta/config.yaml` is too strict — a partially-failed `install` could create `.metta/` without the config.**
Mitigation: `install` writes `.metta/config.yaml` as the first file after directory creation (step 5 in scaffold order above). A partial failure before that point leaves no `.metta/config.yaml`, so `init` correctly blocks. A partial failure after that point (e.g., skill install fails) leaves the config in place and `init` will proceed — which is the correct behavior since the discovery payload does not depend on skill installation state.

**Risk: `metta init` human-mode output is undefined in the spec.**
Mitigation: print a summary of detected mode, stack, and directories, then instruct the user to run `/metta:init` in Claude Code to proceed with the interactive interview. This mirrors the pattern used by other commands' human-mode output without requiring a spec change.

---

## Test Strategy

All test cases belong in `tests/cli.test.ts` (extending existing patterns). Unit-level helpers tests go in a new `tests/commands-discovery-helpers.test.ts`.

### Modify existing tests

**`install outputs JSON with git_initialized when --git-init is used`** (`tests/cli.test.ts:65-71`):
- Add assertion: `expect(data).not.toHaveProperty('discovery')`
- Add assertion: `expect(data).not.toHaveProperty('mode')`
- Covers spec scenario "fresh install in a git repo" (Requirement: install-command-scaffolds-only).

### New `metta install` tests

**`install JSON has no discovery or mode fields`** (new, under existing `describe('metta install')`):
- `runCli(['--json', 'install', '--git-init'], tempDir)` → assert `data.discovery === undefined` and `data.mode === undefined`.
- Covers Requirement: install-command-scaffolds-only.

**`install human output directs user to metta init`** (new):
- `runCli(['install', '--git-init'], tempDir)` → assert `stdout` contains the string `metta init`.
- Covers spec scenario "human-readable install output points at init".

**`install is idempotent on already-installed project`** (new):
- Run install twice; assert second run exits 0, `data.status === 'initialized'`, `data.committed === false`.
- Covers spec scenario "install on a project that already has .metta".

### New `metta init` describe block

**`init errors with exit 3 when .metta/ missing`** (new):
- `runCli(['--json', 'init'], tempDir)` (no prior install) → assert `code === 3`, `data.error.type === 'metta_not_installed'`, `data.error.message` contains `metta install`.
- Covers spec scenario "init before install is blocked".

**`init emits brownfield discovery for Rust project`** (new):
- After `install --git-init`, write `Cargo.toml` and a non-empty `src/` to `tempDir`.
- `runCli(['--json', 'init'], tempDir)` → assert `data.discovery.mode === 'brownfield'`, `data.discovery.detected.stack` includes `'Rust'`, `data.discovery.detected.directories` includes `'src'`.
- Covers spec scenario "init after install in a brownfield project".

**`init emits greenfield discovery for empty project`** (new):
- After `install --git-init` with no additional files.
- `runCli(['--json', 'init'], tempDir)` → assert `data.discovery.mode === 'greenfield'`, `data.discovery.detected.stack` is empty, `data.discovery.detected.directories` is empty.
- Covers spec scenario "init on a greenfield project".

**`init does not mutate repo`** (new):
- After `install --git-init`, capture git status output (clean). Run `metta init --json`. Capture git status again. Assert identical. Assert `config.yaml` mtime unchanged.
- Covers spec scenario "init does not mutate the repository".

**`init --skip-scan forces greenfield`** (new):
- After `install --git-init`, write `Cargo.toml` to `tempDir`. `runCli(['--json', 'init', '--skip-scan'], tempDir)` → assert `data.discovery.mode === 'greenfield'`.
- Verifies `--skip-scan` is wired to `detectBrownfield`'s `skipScan` parameter.

### New `tests/commands-discovery-helpers.test.ts`

**`detectBrownfield returns greenfield when skipScan is true`**:
- Call `detectBrownfield(root, true)` with stack files present → assert `isBrownfield === false`, both arrays empty.

**`detectBrownfield detects Rust from Cargo.toml`**:
- Write `Cargo.toml` and non-empty `src/` to temp dir → assert `detectedStack` includes `'Rust'`, `detectedDirs` includes `'src'`.

**`detectBrownfield returns greenfield for empty project`**:
- Empty temp dir → assert `isBrownfield === false`.

**`buildDiscoveryInstructions returns brownfield question set`**:
- Call with `isBrownfield: true` → assert `questions[0].id === 'corrections'`.

**`buildDiscoveryInstructions returns greenfield question set`**:
- Call with `isBrownfield: false` → assert `questions[0].id === 'description'`.

### Skill template test

**`skill template references metta init command`** (new, in `tests/cli.test.ts` or a static file test):
- Read `src/templates/skills/metta-init/SKILL.md` and assert it contains `metta init --json` and does not contain `metta install --json`.
- Covers Requirement: init-skill-invokes-init-command, scenario "skill template references init command".
- Note: the template already has this correct (`src/templates/skills/metta-init/SKILL.md:13`); the test guards against regression.
