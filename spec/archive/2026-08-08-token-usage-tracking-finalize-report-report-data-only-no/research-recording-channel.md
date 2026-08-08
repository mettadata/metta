# Research: Recording Channel — `metta tokens record`, schema, guard hook

Scope: the recording CLI, the `token_usage` schema field, CLI registration, guard-hook
allowlisting, and test mirroring. All findings are from direct inspection of the worktree
at `.metta/worktrees/token-usage-tracking-finalize-report-report-data-only-no`. No external
grounding was needed — every fact here is in-repo.

## 1. Mirror source: `src/cli/commands/model-escalation.ts` (97 lines)

Exact structure to replicate:

1. **Imports**: `Command` from `commander`; `createCliContext`, `outputJson`,
   `getErrorMessage` from `../helpers.js`; the record schema
   (`ModelEscalationSchema`) from `../../schemas/change-metadata.js`.
2. **Export shape**: a single `export function registerModelEscalationCommand(program: Command): void`.
3. **Command group**: `program.command('model-escalation').description(...)`, then a
   nested `.command('record')` with `.requiredOption(...)` per required flag and
   `.option('--change <name>', 'Change name (auto-selects when exactly one active change exists)')`.
4. **Action handler** (`async (options) => {...}`):
   - `const json = program.opts().json` — the global `--json` flag lives on the root program.
   - `const ctx = createCliContext()` — no argument; uses `process.cwd()`. Context exposes
     `ctx.artifactStore` (an `ArtifactStore` rooted at `<cwd>/spec`); see
     `src/cli/helpers.ts:39`.
   - Everything else inside one `try`.
5. **Pre-validation of enum-ish flags** before touching the store: model-escalation
   hand-checks `--trigger` and throws
   `` `--trigger must be 'stop_deviation' or 'verify_fail' (got '${options.trigger}')` ``.
   The tokens equivalent: parse `--tokens` with `Number(...)` and let
   `TokenUsageRecordSchema.parse` reject non-positive/non-integer values and non-enum
   `--model` values (Zod gives field-named errors; a hand-check for `--model` is optional
   but matches the sibling style).
6. **Change auto-selection** (verbatim pattern, lines 45–54):
   ```ts
   const changes = await ctx.artifactStore.listChanges()
   const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
   if (!changeName) {
     throw new Error(
       changes.length === 0
         ? 'No active changes.'
         : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`,
     )
   }
   ```
7. **Read → validate → append → persist** (lines 56–69):
   - `const meta = await ctx.artifactStore.getChange(changeName)` (throws on nonexistent
     change — that is how the "named change does not exist" exit-4 path works).
   - `SchemaX.parse({...fields, timestamp: new Date().toISOString()})` — comment in source:
     "Zod-validate the record shape here for a clear, field-naming error;
     ArtifactStore.updateChange re-validates the whole metadata on write."
   - `const next = [...(meta.model_escalations ?? []), record]`
   - `await ctx.artifactStore.updateChange(changeName, { model_escalations: next })`
   - Ordering guarantees "no partial state on failure": validation precedes the single write.
8. **Success output**: `--json` → `outputJson({ change: changeName, ...echoed fields })`
   (flat object, no `timestamp` echoed by the sibling); human → one `console.log` line.
9. **Error path** (lines 84–94): catch-all →
   `getErrorMessage(err)`; `--json` →
   `outputJson({ error: { code: 4, type: 'model_escalation_error', message } })`;
   human → `console.error(...)`; then `process.exit(4)` unconditionally.
   Tokens analog: `type: 'tokens_record_error'` (one-word type per sibling convention:
   `iteration_error`, `model_escalation_error`).

## 2. Sibling: `src/cli/commands/iteration.ts` (73 lines)

Same skeleton, confirming the pattern is stable across both instrumentation commands:
`iteration` group → `record` subcommand → same auto-selection block character-for-character
→ `updateChange` → same `{ error: { code: 4, type, message } }` / `process.exit(4)` shape.
Differences: it mutates a counter instead of appending to an array, and does not import a
Zod schema (counter validation happens only via `updateChange`'s full-metadata re-parse).
For tokens, model-escalation is the closer mirror because it appends a Zod-validated record.

## 3. Schema landing zone: `src/schemas/change-metadata.ts`

- `ModelAliasEnum` is imported at the top from `./project-config.js`
  (`src/schemas/project-config.ts:77`):
  `z.enum(['sonnet', 'opus', 'haiku', 'fable', 'inherit'])`. Already imported in
  change-metadata.ts — no new import needed.
- Existing record schemas to sit beside (all `.strict()`):
  - `ArtifactTokensSchema` (line 41): `{ context, budget }` nonneg ints — the
    context-engine budget record. Keyed record `artifact_tokens:
    z.record(z.string(), ArtifactTokensSchema).optional()` at line 87. The new field's
    doc comment must disambiguate from this.
  - `ModelEscalationSchema` (line 57): `{ task: z.string().min(1), from_model:
    ModelAliasEnum, to_model: ModelAliasEnum, trigger: enum, timestamp:
    z.string().datetime() }.strict()` — the closest shape template for
    `TokenUsageRecordSchema`.
  - `ModelRunSchema` (line 67): `{ task, model: ModelAliasEnum, timestamp }`.
- `ChangeMetadataSchema` (line 75) is itself `.strict()`; array fields follow the
  `model_escalations: z.array(ModelEscalationSchema).optional()` pattern (line 93).
  `token_usage: z.array(TokenUsageRecordSchema).optional()` slots in identically.
- Proposed record shape per spec: `{ task: z.string().min(1), agent: z.string().min(1),
  model: ModelAliasEnum, tokens: z.number().int().positive(), timestamp:
  z.string().datetime() }.strict()` — every constraint has a direct precedent in this file.
- `artifact_timings` (line 86) is `z.record(z.string(), ArtifactTimingSchema)` — its keys
  are the "expected-run set" the report GAPS section will use; no schema change needed there.

### Discrepancy flagged for design: `cheap` is not a `ModelAliasEnum` member

The spec delta's passing scenario uses `model: "cheap"` and mandates a "cheap-vs-inherit
split", while simultaneously requiring rejection of "model values outside `ModelAliasEnum`".
`ModelAliasEnum` is `['sonnet', 'opus', 'haiku', 'fable', 'inherit']` — `"cheap"` would be
rejected by the very schema the spec defines. In this codebase "cheap" is a role/tier
concept (the "cheap-executor model" resolved per tier in
`spec/specs/instruction-contracts/spec.md` and `src/util/ceremony-metrics.ts`), not an
alias. Design must pick one of:
(a) add `'cheap'` to `ModelAliasEnum` — touches model-resolution surface, arguably
violating the "no model resolution changes" out-of-scope clause;
(b) record the resolved concrete alias and define the report split as
non-`inherit` vs `inherit` (recommended — zero enum change, data stays truthful);
(c) a tokens-only local enum superset — creates two model vocabularies, worst option.
This research recommends (b) and treating the spec scenario's `"cheap"` literal as a
spec-authoring error to correct during design.

## 4. CLI registration: `src/cli/index.ts`

Flat register-function convention: one import line
(`import { registerTokensCommand } from './commands/tokens.js'`) near line 41–42 next to
`registerIterationCommand` / `registerModelEscalationCommand`, and one call
(`registerTokensCommand(program)`) next to their calls at lines 93–94. Notes:
- `tokens` must NOT be added to `CONFIG_PARSE_EXEMPT_COMMANDS` or
  `DRIFT_CHECK_EXEMPT_COMMANDS` (iteration/model-escalation are not exempt either); the
  `preAction` hook's config fail-fast applies normally.
- New file `src/cli/commands/tokens.ts` (kebab-case, matches siblings). No barrel change
  needed inside `src/cli/commands/` (there is none); check `src/index.ts` root barrel only
  if it re-exports command registrars (it does not export sibling registrars, so no change
  expected — verify at implementation).

## 5. Guard hook: both copies, exact allowlist mechanics

Files: `.claude/hooks/metta-guard-bash.mjs` and
`src/templates/hooks/metta-guard-bash.mjs` — **verified byte-identical today** (`diff`
clean).

Classification mechanics: `tokenize()` extracts `{ sub, third }` per `metta` invocation;
`classify()` checks `ALLOWED_SUBCOMMANDS.has(inv.sub)` first (line 115). Membership on the
**first word alone** allows the whole group — `iteration` and `model-escalation` are listed
as bare subcommand names with inline comments (lines 22–23), so `metta iteration record`,
`metta model-escalation record` pass without third-word checks. `'tokens'` therefore goes
into `ALLOWED_SUBCOMMANDS` (not `ALLOWED_TWO_WORD`), exactly as the spec requires.

Current entries being mirrored (lines 19–25 of both files):

```js
const ALLOWED_SUBCOMMANDS = new Set([
  'status', 'instructions', 'progress', 'doctor',
  'next', // read-only routing query (`metta next --json`); first Bash call of the metta-next skill body
  'iteration', // counter-only instrumentation; skills call it during fan-out. Read-safe-ish; no state-mutating side effects beyond a per-change counter.
  'model-escalation', // audit-only instrumentation; skills call it during the execute/verify fix loop. Appends a per-change escalation record; no broader state-mutating side effects than the iteration counter has.
  'install', // intentional pass-through for human/CI-driven install (no matching skill yet)
]);
```

Byte-identical edit to apply to **both** copies — one line inserted after the
`'model-escalation'` entry:

```js
  'tokens', // append-only usage instrumentation; skills call it after each subagent returns. Appends a per-change token_usage record; no broader state-mutating side effects than model-escalation has.
```

Then `node --check` on each file and a `diff` (or `cmp`) to confirm the pair stayed
byte-identical. No other set (`BLOCKED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`,
`SKILL_ENFORCED_SUBCOMMANDS`, `ALLOWED_BARE`) changes. Consequence to note in design: like
its siblings, the allow is orchestrator-reachable without any fork identity or session
credential — that is intentional (the recording contract is executed by the main-session
orchestrator after each subagent returns, outside any fork).

## 6. Test files to mirror

- **CLI**: `tests/model-escalation-command.test.ts` (198 lines) is the direct template →
  new `tests/tokens-command.test.ts`. Structure: `mkdtemp` sandbox with `spec/` +
  minimal `.metta/config.yaml` (to satisfy the preAction ConfigLoader); `runCli` helper
  spawning `npx tsx src/cli/index.ts` with 15 s timeout; `ArtifactStore` used directly to
  seed changes and re-read `.metta.yaml`. Its six cases map 1:1 onto the tokens spec
  scenarios: first-record append + JSON payload + ISO-timestamp round-trip; subsequent
  append; invalid value rejected without mutation (tokens: `--tokens -5` / `12.5` / bad
  `--model`); auto-select single change; multi-change error naming both candidates with
  exit 4; nonexistent `--change` exit 4. `tests/iteration-command.test.ts` is the same
  skeleton (confirms the harness is a stable convention).
- **Guard hook**: `tests/metta-guard-bash.test.ts` has the exact precedent at ~line 218:
  "allows `metta model-escalation record ...` with no agent_type (orchestrator-driven,
  non-forked) (exit 0)" — add the byte-parallel case for
  `metta tokens record --task x --agent executor --model inherit --tokens 1000`, plus the
  suite's existing byte-identical-copies assertion pattern if present (also see
  `tests/cli-metta-guard-bash-integration.test.ts`).
- **Schema**: `tests/schemas.test.ts` holds the `ArtifactTokensSchema` describe-block
  (line 495 ff.) with positive/negative/float/missing-field cases — mirror a
  `TokenUsageRecordSchema` block there (or in a change-metadata-focused block alongside),
  covering the four rejection scenarios from the spec.
- **Skill wording** (other research channel, noted for completeness):
  `tests/skill-iteration-record.test.ts` is the precedent for asserting skill-file
  instruction text + template/deployed parity.

## 7. Options: command surface shape

**Option A — `tokens` group with `record` subcommand (`metta tokens record`)**
- Pros: byte-parallel with both existing instrumentation commands (`iteration record`,
  `model-escalation record`); matches the spec text verbatim (`metta tokens record`);
  guard allowlists the single word `tokens` exactly like its siblings; leaves room for a
  future read-only `tokens show` without new guard surface.
- Cons: none observed; the group indirection is two extra lines of Commander code.

**Option B — flat `tokens-record` command**
- Pros: marginally less Commander nesting.
- Cons: breaks the established sibling pattern; contradicts the spec requirement text
  ("a `metta tokens record` subcommand, registered alongside `iteration` and
  `model-escalation`"); guard entry `'tokens-record'` would be the only instrumentation
  entry not matching a group name; skills-contract wording in the spec already says
  `metta tokens record`.

**Option C — hang `record` under an existing group (e.g. `model-escalation tokens`)**
- Rejected outright: semantically wrong, and the guard's first-word classification would
  conflate audit types.

## 8. Recommendation

**Option A.** Implement `src/cli/commands/tokens.ts` as a structural clone of
`model-escalation.ts`: `registerTokensCommand` → `tokens` group → `record` subcommand with
`--task/--agent/--model/--tokens` required + `--change` optional, the verbatim
auto-selection block, `TokenUsageRecordSchema.parse` before a single
`artifactStore.updateChange` append, `outputJson` success payload
`{ change, task, agent, model, tokens }`, and the
`{ error: { code: 4, type: 'tokens_record_error', message } }` / `process.exit(4)` failure
path. Add `'tokens'` to `ALLOWED_SUBCOMMANDS` in both guard copies with the comment line
given in §5, keep the pair byte-identical, and mirror
`tests/model-escalation-command.test.ts` for coverage. Carry the §3 `cheap`-alias
discrepancy into the design phase with resolution (b) (record concrete aliases; report the
split as non-inherit vs inherit) as the default position.
