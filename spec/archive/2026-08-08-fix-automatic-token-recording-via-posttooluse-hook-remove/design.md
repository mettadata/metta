# Design: fix-automatic-token-recording-via-posttooluse-hook-remove

## Approach

Token recording moves from a prose contract ("orchestrator, run `metta tokens record` after every subagent") to deterministic framework behavior: a standalone **SubagentStop hook** (`metta-tokens-record.mjs`) that reads the subagent's own JSONL transcript (via the payload's `agent_transcript_path`), sums harness-written `message.usage` values to an exact total, and invokes the existing `metta tokens record` CLI as a child process with `--source hook`. The spec is authoritative on the event pivot: research (`research-posttooluse-payload.md`, Claude Code 2.1.226) proved PostToolUse on `Agent` fires at launch time with an async receipt and never carries usage (408/408 dispatches), while SubagentStop + transcript summing yields exact counts with zero model self-reporting.

Four principles shape everything below:

1. **Hooks stay dumb; the CLI owns semantics.** The worktree-blindness history (guard-edit, PR #57/#59) showed hook-side duplication of active-change resolution drifts from CLI behavior. The hook passes no `--change` and does no path logic — it spawns the CLI with `cwd: payload.cwd`, and `tokens.ts` gains a worktree-cwd resolution rule that applies identically to direct invocations (spec: Worktree-Aware Change Resolution).
2. **Never misattribute; never block.** Every hook failure mode is swallowed (exit 0, stderr-only diagnostics, no decision output — on SubagentStop a `decision: "block"` would force the subagent to continue). An unresolvable change is a typed CLI exit 4 with no write; the missed run surfaces later in TOKENS.md GAPS as a hook coverage miss.
3. **Append-only state; report-time dedupe.** The persisted `token_usage` array is never rewritten or pruned. Provenance is an optional additive `source` field (absent = prose); duplicate collapse is a pure filter in the report generator. No migration.
4. **Demote, don't delete, the prose path.** One identical fallback sentence replaces the per-subagent mandate in the four lifecycle skill pairs, teaching `--source prose` for hook-unavailable environments (hooks disabled, non-Claude-Code AI tools in instruction mode). The guard's `tokens` allowlist entry stays.

Composition throughout: the hook composes existing pieces (stdin-JSON hook pattern from `metta-guard-bash.mjs`, transcript-usage parsing pattern from `statusline.mjs:32-47`, the existing CLI write path). No inheritance, no shared hook library (per the standalone-`.mjs` hook convention), no new dependencies.

### Design decisions (ADRs)

**ADR-1: Totals definition — `input_tokens + output_tokens`, excluding cache components.**
The recorded `--tokens` value is the sum over all assistant transcript records of `message.usage.input_tokens + message.usage.output_tokens` (missing numeric components treated as 0). Rationale: `cache_read_input_tokens` and `cache_creation_input_tokens` represent the same context re-served or written to cache on every API request of the run; summing them across a multi-request subagent run would multi-count the same tokens N times and swamp the genuinely new work. `input_tokens + output_tokens` is the closest transcript-derivable analogue to "new tokens processed for this run", is stable across cache hit/miss variance, and keeps hook-vs-hook run comparisons meaningful. The hook still *parses* all four components (and may echo them in its stderr diagnostic line) so a future totals change is a one-line edit, but only the ADR-1 sum is recorded — the schema's single `tokens` integer is fixed by the spec. Note this intentionally differs from `statusline.mjs`, which sums input + cache components because it measures *context size at one instant*, a different question. Rejected alternatives: all-four-components sum (multi-counts cached context), harness `totalTokens` (only exists in the never-taken sync-completion schema; definition unverifiable).

**ADR-2: `--task` derivation — static agent-type→artifact-id map, agent_type verbatim as fallback.**
`--task = AGENT_TASK_MAP[agent_type] ?? agent_type`, with the map (inside the hook, mirroring the workflow YAML artifact ids): `metta-proposer→intent`, `metta-specifier→spec`, `metta-product→stories`, `metta-researcher→research`, `metta-architect→design`, `metta-planner→tasks`, `metta-executor→implementation`, `metta-reviewer→implementation`, `metta-verifier→verification`. Rationale: `artifact_timings` (the GAPS reference set) is keyed by artifact id, and the spawning skills bind agent type to artifact deterministically, so `agent_type` — which the payload delivers directly and which equals the transcript's `attributionAgent` — is the most reliable route into that vocabulary (spec permits attribution/context-derived mapping). Unmapped types (`metta-discovery`, `metta-constitution-checker`, `metta-uat-runner`, `metta-skill-host`, future agents) record under their own agent_type string: they still count toward totals and per-role rollups, cannot clear an artifact gap they don't own, and cannot be misfiled. Full-workflow variant ids (`domain-research`, `architecture`, `ux-spec`) are not distinguishable from `agent_type` alone; those runs record under the standard ids and the corresponding GAPS rows may conservatively over-report (a safe-direction health warning, documented in Risks). Rejected alternatives: free-text `description`/prompt-derived task ids (breaks the `(task, agent)` dedupe key and floods GAPS), hook-side `metta status` probe for `current_artifact` (reintroduces hook-side state semantics plus a probe race — the drift pattern this design forbids).

**ADR-3: Hook filtering — `metta-*` agents only.**
The hook records only payloads where `agent_type` is a string starting with `metta-`; all other stops exit 0 silently before touching the transcript. Rationale: the feature's scope is per-change metta lifecycle spend; non-metta subagents (ad-hoc Explore/general-purpose agents) usually run outside any active change (guaranteed exit-4 noise), would pollute per-role rollups with unbounded agent names, and have no artifact mapping. The filter is one prefix test in the hook — the only scoping mechanism available, since SubagentStop registrations take no matcher (spec: registration scenario). Widening later is a one-line change.

**ADR-4: Fallback sentence (verbatim, identical in all four skill pairs).**
> Token recording is automatic — a SubagentStop hook records each subagent's harness-measured usage; do not run `metta tokens record` after subagent returns. Only if the hook is unavailable, record manually: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name> --source prose`.

Rationale: names the mechanism (so an orchestrator seeing hook stderr understands it), gives an explicit negative instruction (the old habit is trained into transcripts), and teaches `--source prose` so fallback records dedupe correctly if the hook was actually alive. Verbatim-identical across all four skills preserves the existing single-sentence discipline and lets `tests/skill-tokens-record.test.ts` assert it exactly.

**ADR-5: Hook error-handling structure — single guarded pipeline, unconditional exit 0.**
One `main()` async function with early-return short-circuits for every expected miss (non-metta agent, missing/unreadable transcript, zero usage records, non-positive sum), wrapped as `main().catch(logStderr).finally(() => process.exit(0))`. Malformed transcript lines are skipped per-line (statusline precedent); the CLI child is awaited under its own try/catch with a 30s timeout; a non-zero child exit becomes a one-line stderr note. The hook never writes stdout (no JSON decision output at all — the safest way to never emit `decision: "block"`), never writes into `.metta/` or change metadata, and has no retry. Rejected alternative: exit-2-on-error diagnostics (surfaces errors to the model mid-flow for pure bookkeeping — noise with no action available).

**ADR-6: `--model` derivation.** Take `message.model` from the **last** assistant record bearing usage (reflects the model actually finishing the run if a mid-run switch occurred), map to `ModelAliasEnum` by case-insensitive substring containment of an alias name (`haiku`, `sonnet`, `opus`, `fable`) in the model id string; unmapped or absent → `inherit`. Model ids contain exactly one family name, so containment is unambiguous; `inherit` is the schema's designated "no explicit pin" value and the spec-mandated unmapped default.

## Components

All paths relative to the change worktree root.

| # | Component | Files | Responsibility |
|---|---|---|---|
| 1 | **SubagentStop recording hook** (new) | `src/templates/hooks/metta-tokens-record.mjs` + `.claude/hooks/metta-tokens-record.mjs` (byte-identical pair, executable, `#!/usr/bin/env node` shebang, Node builtins only, no shared lib) | Read stdin payload; filter `agent_type` per ADR-3; read + parse the `agent_transcript_path` JSONL; sum usage per ADR-1; derive `--agent`/`--model`/`--task` per ADR-2/6; spawn `execFile('metta', ['tokens','record',...,'--source','hook'], { cwd: payload.cwd ?? process.cwd(), timeout: 30_000 })`; swallow everything, always exit 0 (ADR-5). |
| 2 | **Hook registration** | `.claude/settings.json` | Add a `SubagentStop` block (no matcher) pointing at `.claude/hooks/metta-tokens-record.mjs`. The existing `PreToolUse` entries (guard-edit, guard-bash) and `statusLine` block are byte-for-byte untouched. |
| 3 | **Worktree change detection** (new pure function) | `src/util/git-worktree.ts` (owner of `DEFAULT_WORKTREE_DIR`) + `tests/git-worktree.test.ts` | `detectWorktreeChangeName(cwd, worktreeDir = DEFAULT_WORKTREE_DIR): string \| null` — pure path-segment math: resolve `cwd`, scan its segments for the **last** adjacent occurrence of the worktree-dir segment pair (`.metta`,`worktrees`) with a following segment; return that segment else `null`. No I/O (functional core); the caller performs the best-effort `realpathSync`. |
| 4 | **Tokens CLI resolution + `--source`** | `src/cli/commands/tokens.ts` + `tests/tokens-command.test.ts` | Replace the two-rule block (lines 35–44) with the four-rule ordering; add optional `--source <hook\|prose>`; include effective source in success output. One coherent edit (both research tracks touch this file). |
| 5 | **Schema provenance field** | `src/schemas/change-metadata.ts` + its test | Add `source: z.enum(['hook','prose']).optional()` to the strict `TokenUsageRecordSchema`. Additive; nothing else changes; `artifact_tokens` untouched. |
| 6 | **Report dedupe + wording** | `src/finalize/tokens-report-generator.ts`, `src/templates/artifacts/tokens.md`, `tests/tokens-report-generator.test.ts` | Pure dedupe filter ahead of total/table/rollups/split; Provenance column in the per-artifact table; GAPS reworded as hook coverage miss; template header reworded to hook=exact vs prose=estimate. Section structure and order unchanged. `finalizer.ts` call site unchanged. |
| 7 | **Skill prose demotion** | 4 template+deployed SKILL.md pairs: `src/templates/skills/{metta-plan,metta-execute,metta-verify,metta-next}/SKILL.md` + `.claude/skills/...` counterparts | Replace the per-subagent mandate sentence in place (metta-plan step 2d, line 24; metta-execute standalone paragraph, line 50; metta-verify step 3, line 26; metta-next Rules bullet, line 30) with the ADR-4 sentence. Step lettering/numbering stays stable; no other diff. Pairs byte-identical. |
| 8 | **Guard comment refresh** | `src/templates/hooks/metta-guard-bash.mjs:24` + `.claude/hooks/metta-guard-bash.mjs` | Comment-only: the stale "skills call it after each subagent returns" note on the `tokens` allowlist entry becomes "hook-driven recording plus manual `--source prose` fallback". Entry retained; zero behavior change; pair stays byte-identical. |
| 9 | **Tests** (new/inverted) | `tests/metta-tokens-record-hook.test.ts` (new, 1:1 with the hook template), `tests/skill-tokens-record.test.ts` (inverted) | Hook test: execute the template hook as a child process against a temp dir with fixture payloads/transcripts and a stub `metta` shim on PATH capturing argv — covers exact-sum recording, non-metta filter, missing/empty/usage-free transcript no-ops, CLI-failure swallow, exit 0 + empty stdout in every case, and template/deployed byte-identity (plus `node --check` on both copies). Skill test: assert the old mandate string absent, the ADR-4 sentence present verbatim, and template/deployed byte-identity for the four pairs. |

### CLI resolution ordering (component 4, normative)

1. **Explicit `--change <name>`** → use verbatim (existing; `getChange` failure surfaces as the existing typed error).
2. **Worktree cwd** → `detectWorktreeChangeName(bestEffortRealpath(process.cwd()))`; a non-null candidate **binds unconditionally — no fall-through to rule 3**. If the candidate is not among `listChanges()`, fail with the typed error naming the derivation (`worktree cwd names change '<x>' but it is not an active change`) and write nothing. Fall-through would recreate the exact misattribution the spec forbids (cwd says `beta`, only `alpha` active → record lands on `alpha`).
3. **Single active change** → auto-select (existing behavior, including main-root aggregation of worktree-hosted changes via the store's `worktreesDir` wiring).
4. **Otherwise** → existing typed `error: { code: 4, type: 'tokens_record_error', ... }` naming candidates, `process.exit(4)`, no write. The hook swallows this (stderr note, exit 0); the run surfaces in GAPS.

### Report dedupe rule (component 6, normative)

```
effectiveSource(r) = r.source ?? 'prose'
key(r)             = `${r.task} ${r.agent}`
hookKeys           = { key(r) : r.source === 'hook' }
deduped            = records.filter(r => r.source === 'hook' || !hookKeys.has(key(r)))
```

All hook records are kept (two genuine hook-recorded runs of one `(task, agent)` both count); prose records are dropped only when shadowed by a same-key hook record; prose-only and all legacy records are retained. Applied identically before the total, per-artifact table, both rollups, and the inherit split. Pure function; persisted state untouched.

## Data Model

One additive change. `TokenUsageRecordSchema` (strict) becomes:

```ts
export const TokenUsageRecordSchema = z.object({
  task: z.string().min(1),          // artifact or task id (dedupe + GAPS key)
  agent: z.string().min(1),         // subagent role / agent_type
  model: ModelAliasEnum,            // 'sonnet' | 'opus' | 'haiku' | 'fable' | 'inherit'
  tokens: z.number().int().positive(), // ADR-1 sum for hook records; orchestrator estimate for prose
  timestamp: z.string().datetime(),
  source: z.enum(['hook', 'prose']).optional(), // absent ⇒ prose-sourced (legacy-compatible)
}).strict()
```

- **Provenance semantics:** `hook` = harness-measured (transcript-summed, exact); `prose` or absent = orchestrator-reported estimate. Consumers classify via `r.source ?? 'prose'` — every pre-delta record parses unchanged, so no migration and no fixture rewrites. When the CLI is invoked without `--source`, the field is **omitted** (not written as `'prose'`), keeping new fallback records shape-identical to legacy ones.
- Strictness preserved: unknown keys, non-positive/non-integer `tokens`, out-of-enum `model` or `source` all still reject (spec scenarios).
- `ChangeMetadataSchema` is otherwise untouched; `artifact_tokens` (context-vs-budget) untouched; `artifact_timings` remains the GAPS reference set with exact-string-match keys.
- Nothing new is persisted by the hook itself — its only durable effect is the CLI-validated append through `ctx.artifactStore.updateChange` (full-metadata re-validation on write, per the no-unvalidated-writes convention).

## API Design

### `metta tokens record` (modified, backward compatible)

```
metta tokens record --task <artifact-or-task-id> --agent <role> --model <alias>
                    --tokens <n> [--change <name>] [--source <hook|prose>]
```

- New optional `--source`; omitted ⇒ record persisted without the field (prose-sourced). Invalid value fails Zod validation before any write, exit 4.
- Change targeting per the four-rule ordering above; every pre-delta invocation shape remains valid with identical behavior at the repo root with a single active change.
- `--json` success payload gains the effective source: `{ change, task, agent, model, tokens, source: 'hook' | 'prose' }`. Failure payloads unchanged: `{ error: { code: 4, type: 'tokens_record_error', message } }`, exit 4, nothing written.

### `detectWorktreeChangeName` (new, exported)

```ts
/** Pure: returns the change name when `cwd` is at or below
 *  `<...>/.metta/worktrees/<name>/` (last occurrence wins), else null. No I/O. */
export function detectWorktreeChangeName(
  cwd: string,
  worktreeDir: string = DEFAULT_WORKTREE_DIR,
): string | null
```

### Hook I/O contract (`metta-tokens-record.mjs`)

- **stdin:** SubagentStop payload JSON — consumed fields: `agent_type` (filter + `--agent` + ADR-2 map key), `agent_transcript_path` (usage source), `cwd` (child-process cwd). All other fields ignored.
- **stdout:** always empty. **stderr:** optional single-line diagnostics prefixed `metta-tokens-record:` (includes the component sums on success/failure for auditability). **exit code:** always 0.
- **Side effect:** at most one `metta tokens record ... --source hook` child invocation (bare `metta` PATH lookup via `execFile`, the guard-edit precedent — no shell). Zero side effects on any short-circuit.
- **Processing pipeline (ADR-5):** parse stdin → prefix-filter `agent_type` → `readFile(agent_transcript_path)` whole-file (a subagent transcript covers exactly one run; no tail-windowing) → per-line JSON.parse skipping malformed lines → collect assistant records with a `message.usage` object → short-circuit if none or if the ADR-1 sum is not a positive integer → derive flags → spawn CLI → log child failure to stderr → exit 0.

### `generateTokensReport` (modified, signature unchanged)

`TokensReportInput`/`TokensReportResult` are unchanged; `tokenUsage` now carries optional `source`. Internal additions: the dedupe filter, a `Provenance` column in the per-artifact table rendering `hook (exact)` / `prose (estimate)`, gap line wording `- \`<key>\` — run evidence with no token record; the recording hook missed this run`, and the template header replacing the blanket "approximate, orchestrator-reported" disclaimer with the hook=exact vs prose=estimate distinction. `NO_GAPS` ("No gaps found.") retained. Seven-section order unchanged.

## Dependencies

**External:** none added. The hook uses Node builtins only (`node:fs/promises`, `node:child_process`, `node:util`, `node:path`) per the standalone-hook convention. No hosted-model API calls anywhere (constitution constraint) — all measurement comes from harness-written transcript files.

**Platform (flagged, vendor-coupled):** Claude Code ≥ 2.1.226 SubagentStop event semantics — payload fields `agent_type`, `agent_transcript_path`, `cwd`, and the transcript JSONL shape (`message.usage` components, `message.model`). The event is docs-acknowledged but its full schema is binary-verified only; this is inherent Claude Code coupling (the whole hook/skill layer shares it), and the tool-agnostic path is preserved via the `--source prose` CLI fallback for non-Claude-Code instruction-mode tools. Re-verify payload/transcript shape on Claude Code upgrades; every shape drift degrades to a silent no-op + GAPS entry, never a wrong record.

**Internal (existing, consumed unchanged unless listed as modified):** `ArtifactStore.listChanges`/`getChange`/`updateChange` (worktree-aware discovery + validated writes), `createCliContext`/`resolveProjectRoot`, `TokenUsageRecordSchema`/`ModelAliasEnum`, `TemplateEngine` + `tokens.md` template, `finalizer.ts` call site (unchanged), template copy-to-`dist/` build step (must cover `src/templates/hooks/` — it already ships the four existing hooks from that directory), `metta-guard-bash` `ALLOWED_SUBCOMMANDS` (`tokens` entry retained). Spec references: finalize-ship delta requirements in this change's `spec.md`; research decisions per `research.md` tracks 1–3.

**Ordering:** components 3→4 (function before CLI use) and 5→{1,4,6} (schema before writers/readers) are the only build-order edges; skill demotion (7) and guard comment (8) land last with the hook (1,2) proven recording in tests.

## Risks & Mitigations

1. **SubagentStop schema drift on Claude Code upgrades** (binary-verified fields). *Mitigation:* every consumed field is guarded (type-checked, fail-silent); any drift produces a no-op + stderr note and shows up as GAPS rows — a visible health signal, never a fabricated or misfiled record. Re-verification on upgrade noted in the hook's header comment.
2. **Dedupe key vocabulary mismatch during transition** — a prose record with a fine-grained task id (e.g. `2.2`) will not collapse against a hook record keyed `implementation`, double-counting that run if an orchestrator ignores the demoted prose. *Mitigation:* ADR-2 pins hook vocabulary to artifact ids; ADR-4 explicitly instructs "do not run"; the inverted skill test locks the mandate out; steady-state prose recording is a rare fallback. Residual exposure accepted (transition-only).
3. **Main-root sessions with multiple active changes skip recording** (rule 4; the payload cwd is the session cwd, not the subagent's). *Mitigation:* accepted by spec — never misattribute; the run lands in GAPS with hook-coverage-miss wording that sets that expectation. Orchestration keeps worktree-hosted work resolvable via rules 2–3 in the common cases.
4. **Full-workflow artifact ids** (`domain-research`, `architecture`, `ux-spec`) aren't derivable from `agent_type`, so those GAPS rows may over-report while totals stay correct under the standard ids. *Mitigation:* safe-direction over-reporting of a health warning; documented in ADR-2; revisit only if full-workflow usage makes it noisy.
5. **Concurrent read-modify-write on `.metta.yaml`** — the hook is a new async writer beside any orchestrator CLI call; an interleaved write could drop one append (surfacing as a GAP, not corruption, since every write is full-metadata Zod-validated). *Mitigation:* demotion makes concurrent writers rare; hook fires once per stop; accepted as a known limitation — file locking is out of scope and pre-existing for all CLI writers.
6. **Symlinked or custom-configured worktree paths**: symlinked cwds can hide the `.metta/worktrees` segments (mitigated by best-effort `realpathSync` at the caller edge, guard-edit precedent); a custom `git.worktree.dir` is not honored (pre-existing shared limitation of `createCliContext`/`resolveChangeRoot`; falls back safely to rules 3/4).
7. **`metta` not on PATH for the hook process** (unbuilt checkout, non-global install). *Mitigation:* spec-mandated swallow — stderr note, exit 0, GAPS row; the guard-edit hook already relies on the same bare-PATH invocation, so environments where guards work also record.
8. **Hook interference with existing guards.** *Mitigation:* new event block only (`SubagentStop` — currently unregistered), no matcher edits, no stdout; the existing hook test suites plus the settings scenario assert guard entries byte-unchanged and guard decisions identical.
9. **Skill-edit regression risk** (four files × two copies). *Mitigation:* single-sentence in-place replacement preserving step numbering; byte-identity + verbatim-sentence + mandate-absence assertions in the inverted test make any drift a test failure.
