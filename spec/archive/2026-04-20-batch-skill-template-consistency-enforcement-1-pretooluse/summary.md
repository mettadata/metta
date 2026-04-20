# Summary: batch-skill-template-consistency-enforcement-1-pretooluse

## What changed

Two mechanical enforcements landed together: (1) a new PreToolUse Bash hook that blocks direct state-mutating metta CLI calls from AI orchestrator sessions, bypassed via `METTA_SKILL=1`; (2) `/metta-propose` skill review + verify fan-outs now mandate in-tree per-persona/per-aspect output paths (`spec/changes/<name>/review/*.md` and `.../verify/*.md`) with `mkdir -p` pre-step and post-hoc `test -s` existence checks. Three skill templates (`metta-propose`, `metta-issue`, `metta-quick`) prefix their state-mutating CLI calls with `METTA_SKILL=1` so the hook passes them through.

## Files

**Hook + install:**
- `src/templates/hooks/metta-guard-bash.mjs` (NEW) + `.claude/hooks/metta-guard-bash.mjs` (NEW, byte-identical mirror)
- `src/cli/commands/install.ts` (MODIFIED) — new `installMettaBashGuardHook` registers the hook in `.claude/settings.json` idempotently alongside `metta-guard-edit`

**Skill templates (all with `.claude/` byte-identical mirrors):**
- `src/templates/skills/metta-propose/SKILL.md` — review step rewritten with numbered MUST bullets for `spec/changes/<change>/review/<persona>.md` paths, `mkdir -p` pre-step, post-hoc `test -s` gate; verify step same treatment with `verify/<aspect>.md`; all state-mutating CLI calls prefixed with `METTA_SKILL=1`
- `src/templates/skills/metta-issue/SKILL.md` — `metta issue` call prefixed
- `src/templates/skills/metta-quick/SKILL.md` — 5 state-mutating call sites prefixed (quick, 3× complete, finalize)

## Tests

- `tests/metta-guard-bash.test.ts` (NEW) — 41 unit tests (20 scenarios × 2 hook paths + byte-identity)
- `tests/cli.test.ts` (MODIFIED) — +3 install tests (register, idempotency, byte-identical copy)
- `tests/cli-metta-guard-bash-integration.test.ts` (NEW) — 8 e2e tests (5 skill-bypass cases, 1 direct-block case, 2 install wiring)
- `tests/skill-discovery-loop.test.ts` — byte-identity invariants continue to pass across all 3 updated SKILL.md mirror pairs

## Runtime behavior

- AI orchestrator running `metta propose`/`metta complete`/etc. via Bash tool without `METTA_SKILL=1` → exit 2 with message pointing to the matching `/metta-<cmd>` skill
- Same orchestrator using the skill → skill prefixes with `METTA_SKILL=1`, passes through
- Read-only commands (`status`, `instructions`, `issues list`, `gate list`, `progress`, `changes list`, `doctor`) always pass
- Human running metta in a terminal — no hook fires (no Claude tool event), no behavior change
- Emergency bypass: disable the hook in `.claude/settings.local.json` (documented in the exit-2 message)

## Out of scope (deferred)

- Same hook/bypass treatment for `/metta-auto`, `/metta-fix-issues`, `/metta-fix-gap`, `/metta-plan`, `/metta-execute`, `/metta-verify`, `/metta-ship`, `/metta-backlog` — these skills still have unprefixed CLI calls; scope limited to the three skills most affected by the immediate drift. Follow-up change can prefix the rest.
- Extending the hook to block non-metta commands
- `metta doctor` subcommand (tracked in backlog)
