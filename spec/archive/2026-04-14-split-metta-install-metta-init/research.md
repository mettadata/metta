# Research: split-metta-install-metta-init

## Decision: Split into `install.ts` + `init.ts` with shared `_discovery.ts` helper

### Approaches Considered

1. **Rename `init.ts` to `install.ts`, add new `init.ts`, extract shared helpers to `_discovery.ts`** (selected) — Clean 1:1 file-to-command mapping. No duplication. Helper module is small (4 exports) and has a single consumer at split time, making it cheap to maintain.

2. **Keep single `init.ts` registering both commands** — Smaller churn, but `init.ts` housing the `install` command is already confusing (the current bug surface). Perpetuates the naming mismatch. Rejected.

3. **Split into `install.ts` + `init.ts` with no shared file** — Avoids the helper module but duplicates `STACK_FILES`, `BROWNFIELD_MARKERS`, and `detectBrownfield` verbatim across two files. Any future stack marker addition must be applied twice. Rejected.

### Rationale

The current file already causes cognitive overhead: `src/cli/commands/init.ts` exports `registerInitCommand` which registers the command named `install`. Option 1 resolves that at the cost of one rename and one new file. The helper module `_discovery.ts` (leading underscore signals internal/non-command) keeps brownfield logic co-located and avoids import sprawl.

---

## Decision: Shared helpers belong entirely in `_discovery.ts`, not duplicated

### Approaches Considered

1. **Extract `STACK_FILES`, `BROWNFIELD_MARKERS`, `detectBrownfield`, `buildDiscoveryInstructions` to `src/cli/commands/_discovery.ts`** (selected) — All four symbols are used exclusively inside `init.ts` today (`src/cli/commands/init.ts:24–75`, `src/cli/commands/init.ts:121`, `src/cli/commands/init.ts:206–341`). Grep confirms zero other callers in `src/`. After split they are all needed by the new `init.ts` (discovery command) only — `install.ts` does not need brownfield detection at all. The helper module becomes a private dep of `init.ts`.

2. **Leave helpers inside the new `init.ts`** — Also acceptable since `init.ts` is the sole consumer, but extracting keeps the command file slim and makes brownfield logic unit-testable in isolation. Slight preference for extraction given the existing test convention (near 1:1 test-to-source).

### Rationale

No other source file outside `src/cli/commands/init.ts` references any of these four symbols. The `src/index.ts` barrel does not export them. Moving them to `_discovery.ts` is a pure lift-and-shift with a single import path change.

---

## Decision: Exit code 3 for `metta init` when `.metta/` is missing

### Approaches Considered

1. **Use exit code 3 for precondition failure** (selected) — Exit code 3 is currently used only by `metta install` for `git_missing` precondition (`src/cli/commands/init.ts:101`, `src/cli/commands/init.ts:109`). The semantic is "a required precondition is absent." `metta init` without `.metta/` is the same category of failure. Codes 1 and 2 are used by `finalize`, `verify`, `ship` for domain-level outcomes (gate failure, conflict). Code 4 is the universal catch-all error across all commands. Code 3 as "precondition missing" is consistent and not overloaded.

2. **Use exit code 4** — Generic error. Loses the semantic distinction that lets callers distinguish "precondition" from "runtime error." Rejected.

### Rationale

The exit code table as observed:
- `1` — gate/verification failure, merge failure
- `2` — conflict (ship, finalize gate)
- `3` — precondition absent (git missing on install; will add: metta not installed on init)
- `4` — unexpected runtime error (default catch-all)

Adding `metta init` exit 3 for `metta_not_installed` extends this pattern without collision.

---

## Decision: Remove `discovery` field from `install --json` output

### Approaches Considered

1. **Remove `discovery` from install JSON output** (selected) — Grep for `.discovery` and `"discovery"` in `src/` returns zero matches outside `src/cli/commands/init.ts` itself. The skill template at `src/templates/skills/metta-init/SKILL.md:13-22` calls `metta init --json` (not `metta install --json`) and reads `discovery` from that response. No in-tree code parses `install`'s JSON `discovery` field.

2. **Keep `discovery` in install output for backward compat** — No internal consumer exists. The intent doc explicitly calls this a pre-1.0 breaking change. Rejected.

### Rationale

The only consumer of the `discovery` payload is the `/metta-init` skill, and it already calls `metta init --json` (the command that does not yet exist). After this change, `install --json` schema is: `{ status, mode, git_initialized, committed, directories, constitution, detected_tools, installed_commands }`. The `mode`, `git_initialized`, `detected_tools`, `installed_commands` fields stay as-is. The `discovery` key is simply omitted.

Note: `install`'s current JSON still includes a `mode` field (`brownfield`/`greenfield`). After split, `install` no longer calls `detectBrownfield` at all, so `mode` should also be removed from install output. The spec does not explicitly call this out but it follows from "scaffolding only — does not emit discovery instructions."

---

## Decision: Skill body requires no changes

### Approaches Considered

1. **No change to skill body** (selected) — The template at `src/templates/skills/metta-init/SKILL.md` already says `metta init --json` on step 1 and reads these fields from `discovery`:
   - `discovery.agent.persona`
   - `discovery.mode`
   - `discovery.detected` (stack, directories)
   - `discovery.questions`
   - `discovery.output_paths` (constitution, context_file, config)
   - `discovery.constitution_template`
   - `discovery.context_template`

   All seven sub-fields are produced by `buildDiscoveryInstructions` in the current `init.ts`. After split they move to the new `init.ts` (discovery command), so the JSON contract is unchanged. The deployed copy at `.claude/skills/metta-init/SKILL.md` is byte-identical to the template (confirmed by reading both files).

2. **Update skill to call `metta install --json` first, then `metta init --json`** — Would let a single skill handle a fresh machine. Rejected as out-of-scope per intent doc. Users are expected to run `install` once, then invoke `/metta-init`.

### Rationale

The skill template is already correct. The only action required under `Requirement: init-skill-invokes-init-command` is to verify the template matches the deployed copy — it does — and to ensure `metta init --json` actually exists and emits the `discovery` object the skill expects, which is what this change delivers.

---

## Decision: File registration export naming

### Approaches Considered

1. **Rename `registerInitCommand` to `registerInstallCommand` in `install.ts`; export `registerInitCommand` from new `init.ts`** (selected) — `src/cli/index.ts:4` imports `{ registerInitCommand } from './commands/init.js'`. After rename: `install.ts` exports `registerInstallCommand`, `init.ts` exports `registerInitCommand`. The index import lines change to match. Naming aligns function name with command name.

2. **Keep `registerInitCommand` in `install.ts` for minimal diff** — Deepens the naming confusion. Rejected.

### Rationale

One-line change in `src/cli/index.ts` per new command. No other files import from `src/cli/commands/init.ts`.

---

## Testing Approach

Existing tests relevant to this change are in `/home/utx0/Code/metta/tests/cli.test.ts`. The `metta install` describe block (lines 45–79) covers:
- `git_missing` JSON exit 3
- `--git-init` creates filesystem layout
- `--json` with `--git-init` checks `status: "initialized"` and `constitution` field
- Normal install on existing git repo

Tests to add or modify:

1. **Modify existing `install --json` test** (line 65–71): assert no `discovery` key in output and no `mode` key.

2. **Add `metta init` describe block**:
   - `init --json` before install exits code 3 with error message referencing `metta install`
   - `init --json` after install on brownfield project emits `discovery.mode: "brownfield"` with non-empty `detected.stack` or `detected.directories`
   - `init --json` after install on greenfield emits `discovery.mode: "greenfield"` with empty `detected.stack` and `detected.directories`
   - `init --json` after install does not mutate the filesystem (no new commits, files unchanged)
   - `init` (human mode) after install prints guidance without raw JSON

3. **Add unit tests** in a new `tests/commands-init.test.ts` (or extend `tests/cli.test.ts`) for `detectBrownfield` directly, covering: `skipScan: true` returns all-empty, stack file detection, source dir detection, both empty yields greenfield.

---

## Risks and Open Questions

**Does `metta refresh` need to run differently?**

No. `metta install` calls `runRefresh` today and continues to do so after the split. `metta init` produces only a JSON payload and writes nothing — it never calls refresh. This is correct per spec.

**What happens if a user runs `metta init` twice?**

The spec (scenario "init does not mutate the repository") says `init` is read-only. Running it twice is a no-op: it re-scans and re-emits the same discovery JSON. No spec language prohibits re-running. This is safe and desirable (re-run discovery after adding new stack files). The spec leaves the human-mode output unspecified for repeated runs; the implementation should print the same output both times.

**Backward compat for out-of-tree callers reading `install --json` discovery field**

Any tool or script that calls `metta install --json` and reads `.discovery` will break. The intent doc acknowledges this as an acceptable pre-1.0 breaking change. No in-tree consumers exist (confirmed by grep). No mitigation needed beyond a changelog entry.

**`--skip-scan` option placement**

Currently `--skip-scan` is on `install`. After split, it belongs on `init` (it forces greenfield detection mode). Remove it from `install`'s option list and add it to `init`.

**`mode` field in `install --json`**

Current install JSON includes `mode: "brownfield"|"greenfield"`. After split, install no longer calls `detectBrownfield`. This field should be dropped from install output. The spec only says to drop `discovery`; implementors should confirm dropping `mode` is also intended. This is a minor open question — not blocking.

### Artifacts Produced

None. This is a CLI refactor with no new contracts, schemas, or diagrams.
