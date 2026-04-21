# Research: harden-metta-config-yaml-lifecycle-across-three-related-bugs

## Decision: yaml Document API for writes, lenient parseDocument for doctor repair, discovery-agent-mediated persistence for Round 4

Three parallel research axes converge on a coherent implementation plan. Per-axis detail:

- [research-yaml-document-api.md](research-yaml-document-api.md)
- [research-doctor-fix-repair.md](research-doctor-fix-repair.md)
- [research-init-round-4-verifier.md](research-init-round-4-verifier.md)

### Axis 1 — yaml Document API for idempotent config writes

**Selected**: `yaml.parseDocument(source)` + `doc.setIn(path, value)` + `doc.toString()`.

- `yaml` is already a project dependency (v2.8.3 installed). No new npm dep.
- `setIn` replaces the value node in place; comments on the key node (`commentBefore`) survive.
- Idempotency: calling `setProjectField(root, ['project','stacks'], ['rust'])` twice produces byte-identical output after the first trailing-newline normalization.
- **Flow vs block style**: default `setIn` produces block-style arrays. To preserve flow style (`stacks: ["rust"]`) when already present, the helper detects `existing instanceof YAMLSeq && existing.flow` and constructs a new `YAMLSeq` with `flow = true`.
- **Duplicate-key tolerance**: the default parse with `uniqueKeys: true` survives duplicates — they go to `doc.errors`, first-occurrence wins. This is fine for the writer path (doctor handles dedup separately).

Rejected:
- **`yaml.parse` + plain-object mutation + `yaml.stringify`** — drops all comments.
- **CST surgery** — byte-perfect but overkill for a single-field setter.

### Axis 2 — `metta doctor --fix` repair strategy

**Selected architecture**: pure `repairProjectConfig(source: string): RepairResult` in a new `src/config/repair-config.ts` that does all YAML/Zod logic with no I/O. The `--fix` action handler in `doctor.ts` owns read → repair → write → commit.

Decisions:
- **Lenient parse**: `yaml.parseDocument(source, { uniqueKeys: false })` inside repair. Doctor bypasses `ConfigLoader` (which will hard-fail once R3 lands).
- **Dedup semantics**: last-occurrence wins naturally under `{ uniqueKeys: false }` (`doc.toJSON()` returns the last value per key). Matches the install-time append pattern so the newest install's intent sticks.
- **Schema-invalid key removal**: iterate Zod `unrecognized_keys` issues, call `doc.deleteIn([...issue.path, badKey])` per offending key. Surgical; preserves surrounding formatting and comments.
- **Idempotency**: string-compare `repairedSource !== originalSource` after the pure function; skip write and commit when unchanged.
- **Branch safety**: no `assertOnMainBranch` on `metta doctor --fix` — a developer may be on a feature branch precisely because the hard-fail blocks them. `autoCommitFile`'s existing dirty-tree guard is sufficient.
- **Reporting**: per-key `- removed duplicate key 'project'` lines in human mode; structured `repair: { duplicates_removed, invalid_keys_removed, committed }` in `--json` mode. No `--dry-run` flag.
- **Bounded iteration**: after deletions, re-run `safeParse` once; cap at 3 passes to catch cascading issues without looping.

### Axis 3 — `/metta-init` Round 4 and verifier context wiring

**Critical ordering**: `ProjectConfigSchema` MUST gain the optional `verification` field **FIRST**, before any SKILL.md or write code lands. Writing a `verification:` block to `.metta/config.yaml` with an unmodified `.strict()` schema causes `ConfigLoader.load()` to throw on the next read.

Selected design:

- **Round 4 placement**: append after Round 3 (Conventions), before Step 3 (`<DISCOVERY_ANSWERS>` XML build). Update the exit-criterion counter ("three rounds" → "four rounds") and the between-round status lines in both SKILL.md copies.
- **Persistence path**: hand the answers to the existing `metta-discovery` subagent via a new `<verification>` element inside `<DISCOVERY_ANSWERS>`. The discovery agent already writes `.metta/config.yaml`; one clause in its task prompt extends the write to include `verification:` under `project:` (or as a sibling top-level block — final placement decided in design per schema shape). **Rejected**: calling `metta config set` — that subcommand is a stub that prints "edit directly for now" and writes nothing.
- **Verifier context**: in `src/cli/commands/instructions.ts`, after the `InstructionGenerator.generate()` call, when `artifactId === 'verification'`, read `ctx.configLoader.load()` and append `verification_strategy`, `verification_instructions` to the `output.context` payload. Also add the new "## Verification Context" section to both `.claude/agents/metta-verifier.md` and `src/templates/agents/metta-verifier.md` (byte-identical parity tests apply).
- **Missing-strategy error**: the error message MUST NOT reference `metta config set` (stub). It provides a literal YAML snippet to paste under `project:` and the option to re-run `/metta-init`. Example: `verification:\n  strategy: tests_only  # or tmux_tui | playwright | cli_exit_codes\n  instructions: "<describe>"`.
- **First-run vs legacy distinction**: the verifier uses the heuristic `spec/changes/` empty AND `spec/archive/` empty → first-run (soft default to `tests_only` + informational note). Either non-empty → legacy project (hard error + remediation snippet).

### Rationale

Each decision reinforces the others:

- The `yaml.parseDocument` path shared between install, init-persistence, and doctor's repair concentrates all config-write logic in one tested module (`src/config/config-writer.ts` for production writes, `src/config/repair-config.ts` for pure repair). No regex-based string munging anywhere.
- Hard-failing the consumer + making doctor the sole escape hatch + keeping doctor lenient means the "corrupt config masks real problems" failure mode is gone. Users see the exact file:line and a one-command fix.
- Schema-first ordering prevents a self-inflicted regression: we'd be writing `verification:` blocks that `ConfigLoader.load()` then rejects before the schema update lands.

### Artifacts Produced

- [research-yaml-document-api.md](research-yaml-document-api.md) — Document API comparison, flow/block preservation sketch, `setProjectField` diff.
- [research-doctor-fix-repair.md](research-doctor-fix-repair.md) — pure `repairProjectConfig` signature, dedup walk, Zod-issue-driven key deletion.
- [research-init-round-4-verifier.md](research-init-round-4-verifier.md) — Round 4 text, `<DISCOVERY_ANSWERS>` extension, `instructions.ts` diff, verifier persona addition, first-run heuristic.
