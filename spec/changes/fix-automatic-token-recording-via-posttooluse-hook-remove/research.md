# Research Synthesis — fix-automatic-token-recording-via-posttooluse-hook-remove

Consolidates three parallel research tracks (2026-08-08, Claude Code 2.1.226):
`research-posttooluse-payload.md`, `research-change-resolution.md`, `research-dedupe-strategy.md`.

## Track 1: Hook event and payload (`research-posttooluse-payload.md`)

**Finding: PostToolUse on the Agent tool cannot deliver token usage in this environment.**
All 408 observed Agent dispatches across local transcripts return `status: "async_launched"` —
the PostToolUse event fires at launch time with a launch receipt, never a completed result with
usage. The intent's stop-condition ("usage not exposed at all → halt") is **not** triggered,
because exact harness-measured counts ARE deterministically reachable by a hook:

- The **SubagentStop** hook event (docs-acknowledged; full schema binary-verified in 2.1.226)
  delivers `agent_id`, `agent_type`, and `agent_transcript_path` plus common fields (`cwd`, ...).
- The subagent's JSONL transcript carries exact per-request `message.usage` (input/output/cache
  components), `message.model`, and `attributionAgent`/`attributionSkill` — mapping directly to
  `--tokens`/`--model`/`--agent`/`--task` with zero model self-reporting.
- The repo already parses transcript JSONL usage this way (`.claude/statusline/statusline.mjs:36-40`).

**Options considered:** A — SubagentStop hook parsing `agent_transcript_path` (recommended);
B — PostToolUse on `Task|Agent` handling a hypothetical sync-completion shape (records nothing in
practice; acceptable only as a complement); C — undocumented `TaskCompleted` event with a
convention-derived path (rejected); D — status quo prose recording (rejected as primary).

**Consequence:** the spec delta's "Token Recording PostToolUse Hook" requirement must be amended
to a SubagentStop hook that sums usage from `agent_transcript_path`. File name
(`metta-tokens-record.mjs`), registration site, non-blocking contract, dedupe, and provenance
plan all carry over unchanged. Risks: SubagentStop schema is under-documented publicly
(re-verify on Claude Code upgrades); totals definition must decide cache-token handling at
design time (record components; do not naively sum cached context).

## Track 2: Worktree-aware change resolution (`research-change-resolution.md`)

**Finding: resolution belongs in the CLI, not the hook** — the guard-edit worktree-blindness
history (resolved issues, PR #57/#59) shows hook-side duplication of active-change semantics
drifts from CLI behavior. The hook stays dumb: spawn `metta tokens record` with
`{ cwd: payload.cwd ?? process.cwd() }`, no `--change`, no path logic.

**Recommended algorithm** (replacing `src/cli/commands/tokens.ts:35-44`, ordered):
1. Explicit `--change` wins (existing).
2. **Worktree cwd** — new pure `detectWorktreeChangeName(cwd)` in `src/util/git-worktree.ts`
   (path-segment match on `.metta/worktrees/<name>/`, last-occurrence pair, best-effort realpath).
   A candidate binds unconditionally — no fall-through; inactive candidate → typed error, no write
   (prevents misattribution).
3. Single active change → auto-select (existing, incl. main-root worktree aggregation).
4. Otherwise → existing typed exit-4 error, nothing written; the hook swallows it (exit 0) and the
   missed run surfaces in TOKENS.md GAPS as a hook coverage miss.

Risks: main-root sessions with multiple active changes still skip (accepted by spec — never
misattribute); custom `git.worktree.dir` not honored (pre-existing shared limitation); both
research tracks edit `tokens.ts` — land as one coherent edit.

## Track 3: Dedupe and prose demotion (`research-dedupe-strategy.md`)

**Finding: report-time collapse only, exactly as the spec mandates.** Write-time rejection is
lossy (legitimate re-runs of the same `(task, agent)` are common), racy (hook and orchestrator
are separate processes on the same `.metta.yaml`), and contradicts the spec's append-only rule.

- Schema: `TokenUsageRecordSchema` gains optional `source: z.enum(['hook','prose'])`; absent =
  prose-sourced; no migration; legacy fixtures round-trip.
- Report: pure filter in `generateTokensReport` — keep all hook records, drop prose records
  shadowed by a same-`(task, agent)` hook record; prose-only/legacy retained.
- GAPS mechanics unchanged; wording becomes hook-coverage-miss attribution; template header
  distinguishes hook=exact vs prose=estimate; provenance column added.
- **Prose contract inventory (complete):** one identical sentence in four skill pairs —
  metta-plan:24, metta-execute:50, metta-verify:26, metta-next:30 (template + deployed, byte-identical).
  **Demote, don't remove** — one identical fallback sentence teaching `--source prose`; keeps the
  guard's `tokens` allowlist entry meaningful and covers hook-unavailable environments.
  `tests/skill-tokens-record.test.ts` must be inverted (mandate absent, fallback present).
- Constraint on the hook: derive `--task` toward artifact/task-id vocabulary (aligning with
  `artifact_timings` keys) so dedupe keys and GAPS both work; `attributionSkill`/context-derived
  ids preferred over free-text descriptions.

## Recommendation

1. **Pivot the hook event from PostToolUse to SubagentStop** (`metta-tokens-record.mjs`,
   template + deployed, byte-identical): filter on `agent_type` (record `metta-*` at minimum),
   parse `agent_transcript_path`, sum assistant-record `message.usage` (components preserved),
   derive `--model` from `message.model`, `--agent` from `agent_type`, `--task` from
   attribution/context toward artifact-id vocabulary; invoke
   `metta tokens record ... --source hook` with `cwd: payload.cwd`; always exit 0, never emit a
   blocking decision.
2. **CLI-side worktree-aware resolution** — pure `detectWorktreeChangeName` + four-rule ordering
   in `tokens.ts`; hook passes no `--change`.
3. **Report-time dedupe** on `(task, agent)` preferring hook records; optional `source` schema
   field; GAPS reworded as hook-health; template header/provenance column updated.
4. **Demote the prose mandate** in the four skill pairs to a single verbatim fallback sentence;
   invert `tests/skill-tokens-record.test.ts`; refresh the stale guard allowlist comment.
5. **Amend spec.md** (specifier pass) to rename the hook requirement to SubagentStop and restate
   payload-shape scenarios in transcript terms before design.

Pre-design action: the spec delta amendment (item 5) is required because the current spec text
would specify a hook that records nothing in practice.
