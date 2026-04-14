# split-metta-install-metta-init

## Problem
Today one CLI command — `metta install` — does two unrelated jobs: (1) scaffolds Metta files into a repo (dirs, skills, default config, commit) and (2) emits a `discovery` payload that the `/metta-init` skill consumes to run interactive project discovery. This conflates setup-time mechanics with an AI-driven discovery step.

Concrete symptoms:
- The `/metta-init` skill hardcodes `metta init --json`, which doesn't exist — the command is `metta install`. The skill only works because Claude self-corrects. A first-time user following docs will hit `unknown command 'init'`.
- `install`'s JSON output is ambiguous: callers can't tell whether to treat the response as "files scaffolded" or "begin discovery."
- Users have no way to re-run discovery on a project that's already installed without re-running scaffolding side effects.

Affected: anyone running `/metta-init` in Claude Code, anyone integrating Metta into other AI tools that consume the JSON payload, and the Metta docs/skill templates that reference these commands.

## Proposal
Split into two commands with strict separation:

- **`metta install`** — scaffolding only. Git check, create `.metta/` + `spec/` directories, write default `.metta/config.yaml` + `spec/project.md` + `.metta/.gitignore`, install `.claude/` skills+agents+commands, run `refresh` to generate CLAUDE.md, commit as `chore: initialize metta`. JSON output describes what was scaffolded. Prints "next: run `metta init`". Does **not** emit a `discovery` payload. Idempotent — re-running on an installed repo is a no-op that reports existing state.

- **`metta init`** — discovery only. Requires `.metta/config.yaml` to exist; errors with exit code 3 + guidance to run `metta install` first if missing. Detects brownfield vs greenfield by scanning for stack markers and source dirs. Returns the `discovery` JSON payload (agent persona, questions, templates, output paths) that the `/metta-init` skill consumes to drive `AskUserQuestion`-based interview and fill `spec/project.md`.

- **`/metta-init` skill** — already calls `metta init --json`; no body change required, but verify the skill doesn't depend on any field that moves.

- **No auto-run**: `metta install` never invokes discovery. Users run `metta install` once, then `/metta-init` (or `metta init` directly) to discover.

## Impact
- **CLI surface**: adds `metta init` command; `metta install` JSON schema loses `discovery` field. Anything parsing `install`'s JSON expecting `discovery` will break — this is a pre-1.0 breaking change, acceptable.
- **Skills**: `/metta-init` starts working correctly for first-time users without self-correction. No change to skill body.
- **Tests**: existing tests for `init.ts` (the file; command name is `install`) need updating; add tests for the new `init` command and its error path.
- **Docs**: CLAUDE.md workflow table already lists both concepts under "Lifecycle" heuristically; no doc rewrite needed beyond ensuring `metta install` and `metta init` are both documented with their distinct roles.
- **Existing installed repos** (e.g. `demos/zeus`, `demos/todo`): unaffected by `install` changes; `metta init` is new and opt-in.

## Out of Scope
- Renaming the source file `src/cli/commands/init.ts` (file currently registers `install`; will house both commands or be split — decided in design).
- Adding a `--force` re-scaffold mode to `install`.
- Any change to discovery *content* (questions, templates, agent persona) — lift-and-shift only.
- Non-Claude-Code AI tool adapters (still v0.1 Claude-only).
- Adding an `uninstall` command.
