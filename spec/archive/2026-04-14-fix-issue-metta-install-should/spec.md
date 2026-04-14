# Spec: fix-issue-metta-install-should

## Overview

`metta install` currently calls `runRefresh()` and commits `CLAUDE.md` as part of the install commit. This violates the install/init boundary established by `split-metta-install-metta-init`. Install is responsible for pure file scaffolding; CLAUDE.md generation belongs to the init layer, triggered after the discovery agent populates `spec/project.md`.

This spec covers three changes: removing refresh from install, adding a refresh step to the `/metta:init` skill after discovery completes, and updating tests to reflect the corrected boundary.

---

## REQ-1 — REMOVED: install-regenerates-claude-md

`metta install` MUST NOT import or invoke `runRefresh` at any point during its execution.

`metta install` MUST NOT stage `CLAUDE.md` in its git commit. The `git add` call MUST NOT include `CLAUDE.md` as an argument; it MUST stage only `.metta/` and `spec/` (plus `.claude/` when present).

The human-mode console output MUST NOT include any line claiming `CLAUDE.md` was created or written.

The JSON output object emitted by `outputJson` MUST NOT include a `claude_md` key or any equivalent field describing CLAUDE.md creation.

After a successful `metta install` run, `CLAUDE.md` MUST NOT exist in the project root unless it was already present before install ran.

### Scenarios

**Scenario 1.1 — Fresh install in empty git repo produces no CLAUDE.md**

Given an empty directory with a git repo initialized and no pre-existing `CLAUDE.md`,
When `metta install` completes successfully,
Then `CLAUDE.md` MUST NOT exist in the project root,
And the install git commit object MUST NOT include `CLAUDE.md` as a changed file,
And the console output MUST NOT contain the string "CLAUDE.md".

**Scenario 1.2 — `metta install --json` output contains no claude_md reference**

Given a clean git repo with no prior metta setup,
When `metta install --json` is executed,
Then the JSON object written to stdout MUST NOT contain a `claude_md` key,
And the JSON object MUST NOT contain any key whose value is a path ending in `CLAUDE.md`.

**Scenario 1.3 — Re-running install does not overwrite existing CLAUDE.md**

Given a project where `/metta:init` has already run and `CLAUDE.md` exists with curated content,
When `metta install` is run a second time,
Then the content of `CLAUDE.md` MUST be identical to its content before install ran,
And the install git commit MUST NOT include `CLAUDE.md` as a changed or staged file.

---

## REQ-2 — ADDED: init-generates-claude-md

The `/metta:init` skill MUST be responsible for producing `CLAUDE.md`. The skill body MUST include an explicit step, executed after the metta-discovery agent commits `spec/project.md` and `.metta/config.yaml`, that invokes `metta refresh` (via `Bash` tool) to regenerate `CLAUDE.md`.

After `metta refresh` completes, the skill MUST stage and commit `CLAUDE.md` in a separate git commit with the message `chore: generate CLAUDE.md from discovery`.

The refresh invocation MUST appear in step 4 of the skill (or a step immediately following the discovery agent's commit), not in `src/cli/commands/init.ts`. Placing it in `init.ts` is insufficient because at that point `spec/project.md` is still a blank template; the refresh MUST execute only after the discovery agent has written real project content.

The `metta init` CLI command (`src/cli/commands/init.ts`) MUST NOT call `runRefresh`. Its sole responsibility remains emitting discovery instructions.

After the full `install` + `/metta:init` sequence completes in a project, `CLAUDE.md` MUST exist and MUST contain content derived from the answers written by the discovery agent into `spec/project.md`.

### Scenarios

**Scenario 2.1 — CLAUDE.md exists after `/metta:init` completes**

Given a project where `metta install` has been run (no `CLAUDE.md` yet),
When `/metta:init` completes the discovery interview and the discovery agent commits `spec/project.md`,
Then `metta refresh` MUST be invoked by the skill orchestrator,
And after the refresh, `CLAUDE.md` MUST exist in the project root,
And a git commit with message `chore: generate CLAUDE.md from discovery` MUST be present in the log.

**Scenario 2.2 — CLAUDE.md reflects project.md content after init**

Given the discovery agent has written project name "Acme API" and stack "Node.js, TypeScript" into `spec/project.md`,
When the `/metta:init` skill runs `metta refresh` after the discovery commit,
Then `CLAUDE.md` MUST contain the text "Acme API",
And `CLAUDE.md` MUST contain a reference to the detected stack.

**Scenario 2.3 — install + init sequence produces CLAUDE.md only after init**

Given an empty git repo,
When `metta install` is run and then `/metta:init` is run to completion,
Then `CLAUDE.md` MUST NOT appear in the install git commit,
And `CLAUDE.md` MUST appear in a commit made after the discovery agent's commit,
And the commit containing `CLAUDE.md` MUST have the message `chore: generate CLAUDE.md from discovery`.

**Scenario 2.4 — `metta init` CLI emits no CLAUDE.md side-effect**

Given a project with `metta install` completed,
When `metta init --json` is executed (the CLI command, not the skill),
Then `CLAUDE.md` MUST NOT be created or modified,
And the working tree MUST be clean with respect to `CLAUDE.md`.

---

## REQ-3 — MODIFIED: install-tests-no-claude-md-assertion

Any test in `tests/cli.test.ts` (or other test files) that asserts `CLAUDE.md` exists after running `metta install` MUST be removed or relocated to an init-flow test.

Tests for the `install` command MUST NOT assert that `CLAUDE.md` is present, created, or non-empty following install execution.

A test covering CLAUDE.md creation MUST exist in the test suite that exercises the init flow (e.g., an integration test or a test that exercises the post-discovery refresh path). This test SHOULD live in a dedicated init test file or in an `init`-labelled describe block within `tests/cli.test.ts`.

### Scenarios

**Scenario 3.1 — Install test block does not assert CLAUDE.md**

Given the `tests/cli.test.ts` file after this change is applied,
When the describe block for `metta install` is inspected,
Then no `expect` or assertion call MUST reference the path `CLAUDE.md`,
And no assertion MUST check `existsSync('CLAUDE.md')` or equivalent.

**Scenario 3.2 — An init-flow test asserts CLAUDE.md creation**

Given a test that simulates the post-discovery refresh step (either via integration test or a unit test that calls `runRefresh` on a populated `spec/project.md`),
When the test runs,
Then it MUST assert that `CLAUDE.md` exists after the refresh,
And it MUST assert the file is non-empty.

---

## Out of Scope

- Changing the content, structure, or marker format of CLAUDE.md.
- Changing what questions the discovery agent asks or how `spec/project.md` is populated.
- Auto-refreshing CLAUDE.md on `metta complete`, `metta finalize`, or `metta ship`.
- Teaching `metta propose`, `metta execute`, or any other lifecycle command about refresh.
- Adding `--no-refresh` or `--refresh` flags to any command.
- Modifying `src/cli/commands/refresh.ts` or the `runRefresh` function internals.
- Non-Claude-Code AI tool adapters.
- Updating user-facing documentation outside of this change's files.
