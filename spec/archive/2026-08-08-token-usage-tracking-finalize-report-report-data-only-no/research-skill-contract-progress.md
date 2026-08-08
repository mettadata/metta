# Research: Skill Contract Recording Instruction + Progress Aggregate

Scope: Part 2 (lifecycle-skill token-recording instruction) and Part 4 (`metta progress`
avg-tokens-per-change by tier) of the token-usage-tracking change. All paths relative to
the worktree root unless absolute.

---

## Part 1 — Skill contract: where the recording instruction goes

### 1.1 Survey of the four target skills

All four template/deployed pairs are currently byte-identical (verified with `diff -q`):

| Skill | Template | Deployed twin |
|---|---|---|
| metta-plan | `src/templates/skills/metta-plan/SKILL.md` | `.claude/skills/metta-plan/SKILL.md` |
| metta-execute | `src/templates/skills/metta-execute/SKILL.md` | `.claude/skills/metta-execute/SKILL.md` |
| metta-verify | `src/templates/skills/metta-verify/SKILL.md` | `.claude/skills/metta-verify/SKILL.md` |
| metta-next | `src/templates/skills/metta-next/SKILL.md` | `.claude/skills/metta-next/SKILL.md` |

**metta-plan** (53 lines). Subagent flow is Steps 2a–2d: `2b` spawns the planning subagent,
`2c` "Subagent writes the artifact file with real content, then git commits", `2d` runs
`metta complete`. A second spawn point exists at Step 4b (the `metta-constitution-checker`
subagent). **Insertion point:** a new sub-step between 2c and 2d (relabel `d` to `e`) —
"after the subagent returns, record its usage" — is the natural seam; a rule worded
"after each subagent returns" also covers the constitution-checker at 4b without a second
edit (design should decide whether 4b gets its own explicit line; the checker's model is
never passed explicitly, so `--model inherit` applies there).

**metta-execute** (64 lines). Batch loop at Step 4; the *only* explicit model pass-through
wording in any of the four skills is the paragraph at line 48:

> For **every** executor spawn (parallel or sequential, first run or re-run — not just the
> examples above): read `agent.model` from `metta instructions <id> --json`. If it is not
> `inherit`, pass it as `Agent(subagent_type: "metta-executor", model: "<value>", ...)`.
> If it is `inherit`, omit the `model` parameter.

**Insertion point:** a new paragraph immediately after this one. It is the ideal anchor
because the recording instruction's `--model` semantics ("the alias you passed, or
`inherit` when you omitted the parameter") are defined by exactly this paragraph. The
in-file recording precedent is the STOP-handling paragraph at line 63
(`metta model-escalation record --task <id> --from <resolved-model> --to inherit
--trigger stop_deviation --change <name>`).

**metta-verify** (34 lines). Step 2 spawns the metta-verifier; Step 3 runs
`metta complete`. The fix path (line 31) spawns a metta-executor and carries the
model-escalation record precedent (`metta model-escalation record ... --trigger
verify_fail ...`). **Insertion point:** a new step between current steps 2 and 3 (renumber
3–4). A verbatim "after each subagent returns" rule also covers the fix-executor respawn
in the "If any gate fails" section without extra wording; verifier spawns never pass a
model, so `--model inherit`.

**metta-next** (31 lines). Step 3 delegates: "spawn a subagent with the right metta agent
type … using `metta instructions` and the agent execution pattern". Note: the section
literally titled "Agent Execution Pattern" exists only in
`src/templates/skills/metta-propose/SKILL.md` (line 284) — metta-next references it by
name but does not contain it. **Insertion point:** either extend Step 3 with the recording
sentence or add a bullet under `## Rules` (which already carries per-return orchestrator
duties: "the orchestrator commits planning, review, and verification artifacts after each
subagent returns"). Recommendation: a `## Rules` bullet carrying the verbatim instruction —
it sits beside the existing "after each subagent returns" commit-ownership rule, the
closest structural sibling.

### 1.2 The precedent wording to mirror

Two recording precedents exist in skill prose:

1. **iteration-record** — terse imperative one-liner, repeated *verbatim* across skills:
   `Run `metta iteration record --phase review --change <name>``. It appears in
   metta-propose (L214, L266, L271), metta-quick (L144, L190, L196), metta-auto (L62, L67,
   L72), metta-fix-gap (L65, L76, L81), metta-fix-issues (L63, L74, L79). **It does not
   appear in any of the four target skills** — so within plan/execute/verify/next the only
   in-file precedent is:
2. **model-escalation record** — per-context tailored sentence sharing a verbatim command
   core, in metta-execute L63 (STOP handling) and metta-verify L31 (verify-FAIL handling).

Both precedents always include `--change <name>` explicitly. The tokens instruction should
too (the CLI's auto-select only works with exactly one active change; skills already never
rely on it).

Content-assertion test precedent: `tests/skill-iteration-record.test.ts` reads each
template's `SKILL.md` and asserts `content.includes('metta iteration record --phase …')`.
A sibling `tests/skill-tokens-record.test.ts` asserting `metta tokens record` appears in
each of the four templates is the direct analogue (satisfies the spec scenario "Each
spawning skill carries the recording instruction").

### 1.3 Byte-identity enforcement — yes, a test exists

`tests/template-deploy-sync.test.ts` **auto-discovers every file** under
`src/templates/{agents,skills,hooks,statusline}` and asserts each has a byte-identical
committed twin under `.claude/{agents,skills,hooks,statusline}`, plus a no-orphans check.
Any skill edit not mirrored to `.claude/skills/**` fails the suite automatically — no new
identity test is needed for the skill edits (the same test also covers the guard-hook
edit in `src/templates/hooks/` vs `.claude/hooks/`). Separately, `npm run copy-templates`
(package.json L18) ships `src/templates/skills` to `dist/templates/skills` at build time;
no drift risk there since it is a straight `cp -r`.

`tests/cli-skills.test.ts` (L115+) also reads metta-next's template and deployed copies —
worth re-running, but it asserts other content.

### 1.4 Wording options

**Option A — one verbatim instruction, byte-identical across all four skills.**
- Pros: single canonical contract; testable with one `includes()` string per file
  (mirrors `skill-iteration-record.test.ts`); zero drift between skills; matches the
  iteration-record precedent of verbatim repetition; trivially auditable against the spec
  scenario wording.
- Cons: reads slightly generically in metta-execute (where "the model passed" has a
  concrete definition one paragraph up) and in metta-plan (where subagents never take a
  model).

**Option B — per-skill tailored phrasing** (model-escalation style).
- Pros: reads naturally at each anchor; can name the exact model source per skill
  (`agent.model` in execute, always-`inherit` in plan/verify).
- Cons: four sentences to keep semantically in sync forever; content test needs per-skill
  regexes; historical evidence that tailored duplicated prose drifts (the
  `metta-verifier-deployed-agent-copy-drifted-from-template` issue cited in
  template-deploy-sync.test.ts).

**Option C — hybrid**: verbatim core sentence (the command with all flags and the
"or `inherit`" clause) plus a one-clause per-skill lead-in anchoring it to the local step
numbering.
- Pros: the testable command core is still one exact string; local fit preserved.
- Cons: marginally more editing care than A.

**Recommendation: Option A** — one verbatim instruction reused in all four skills.
Rationale: the semantics are genuinely uniform ("after each subagent returns, record what
it reported"), the parenthetical `inherit` clause already resolves the only per-skill
difference (whether a model was passed), and verbatim repetition is what makes the
single-string content test and future audits cheap. Proposed wording (final text is the
design phase's call):

> After each subagent returns, record its reported token usage:
> `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>`
> — `--task` is the artifact or task id it worked, `--agent` is the `subagent_type` you
> spawned, `--model` is the model alias you passed to `Agent(...)` (use `inherit` when you
> omitted the `model` parameter), and `--tokens` is the token count from its completion
> report. This applies to every spawn — planner, executor, reviewer, and verifier alike.

Placement per skill (Option A text inserted verbatim at each):
- metta-plan: new step 2d (before `metta complete`), old 2d becomes 2e.
- metta-execute: new paragraph directly after the `agent.model` pass-through paragraph (L48).
- metta-verify: new step between steps 2 and 3; renumber.
- metta-next: new bullet in `## Rules`, adjacent to the commit-ownership bullet.

### 1.5 Flags / risks (Part 1)

- **`cheap` is not a `ModelAliasEnum` value.** `ModelAliasEnum` =
  `['sonnet', 'opus', 'haiku', 'fable', 'inherit']` (`src/schemas/project-config.ts` L77).
  The spec's scenarios use `model: "cheap"` and a "cheap-vs-inherit split"; "cheap" exists
  only as prose in comments ("cheap-tier runs" = non-inherit `model_runs`). Design must
  interpret "cheap" as *any non-inherit alias* (and the record schema must accept the real
  enum values), or the spec's example records fail validation as written. This is the
  sharpest inconsistency found.
- **Coverage gap by design:** metta-propose, metta-quick, metta-auto, metta-fix-issues,
  and metta-fix-gap also spawn subagents but are explicitly out of scope ("no other skill
  wording changes"). Changes driven end-to-end through those skills will show every
  artifact in the TOKENS.md GAPS section. Accept for now; the GAPS section makes it
  visible, which is the point.
- metta-plan's constitution-checker spawn (Step 4b) is covered by the "after each subagent
  returns" wording, but its `--task` id is not an `artifact_timings` key — its records
  will appear in per-role/per-model rollups but never in GAPS math. Harmless; note for
  design.

---

## Part 2 — Progress aggregate: avg tokens per change by tier

### 2.1 Ceremony-metric conventions in `src/cli/commands/progress.ts`

- **Helpers never throw; `null` means no-data.** Each metric helper
  (`getCeremonyCommitRatio`, `getArtifactsPerSmallChange`, `getModelEscalationRate` in
  `src/util/ceremony-metrics.ts`) "always resolves; never throws" and returns `null` for
  no-data — explicitly distinct from a valid zero (e.g. escalation `rate: 0` with
  `total > 0` is a real result; `total === 0` is `null`).
- **JSON: null passthrough verbatim.** progress.ts L20–21: "null must pass through
  verbatim, never coerced to 0". Metrics land as top-level snake_case keys in the `--json`
  payload: `ceremony_commit_ratio`, `ceremony_commit_ratio_windowed`,
  `artifacts_per_small_change`, `model_escalation_rate` (L116–119).
- **Human: explicit "no data" wording, never a bare 0.** L191–224: each metric prints
  either a formatted line or `  <Metric>: no data`.
- Token display convention: `formatThousandsK` (L255) renders sums as `${round(n/1000)}k`
  in the 📊 secondary line.

### 2.2 How progress reads archived change metadata (the precedent)

`getModelEscalationRate(specDir, artifactStore)` is the exact structural precedent for a
metric spanning active + archived changes:

- **Active:** `artifactStore.listChanges()` → `artifactStore.getChange(name)` per change
  (reads `spec/changes/<name>/.metta.yaml` through the Zod-validated store path); per-change
  try/catch skips missing/invalid metadata.
- **Archived:** `readdir(join(specDir, 'archive'), { withFileTypes: true })`, then for each
  directory entry `new StateStore(specDir).read(join('archive', entry.name, '.metta.yaml'),
  ChangeMetadataSchema)`; catch-skip per entry; missing archive dir → treated as empty.

Test precedent: `tests/progress-ceremony-metrics.test.ts` hand-writes archive
`.metta.yaml` fixtures (`writeArchiveMetadata` builds the YAML lines including optional
`model_runs`/`model_escalations` arrays) and asserts the `--json` payload; unit-level
coverage of the helper lives in `tests/ceremony-metrics.test.ts`.

### 2.3 Recommended computation

New helper in `src/util/ceremony-metrics.ts` (keeps 1:1 test mapping and reuses the file's
conventions):

```
getAvgTokensPerChangeByTier(specDir, artifactStore)
  → Promise<Record<'trivial'|'quick'|'standard'|'full', { mean: number; sample_size: number } | null>>
```

- Iterate active changes via `artifactStore.listChanges()`/`getChange()` and archives via
  `StateStore.read(join('archive', entry, '.metta.yaml'), ChangeMetadataSchema)`, both with
  catch-skip — byte-for-byte the `getModelEscalationRate` iteration shape.
- Per change: if `token_usage` is `undefined`, **exclude** (spec: "not counted as zero";
  covers pre-feature archives). Recommend also excluding a present-but-empty array — it
  contributes no observations and counting it as a 0-token change would deflate averages;
  flag as a design-phase confirmation since the spec only mandates the absent-field case.
- Otherwise per-change total = sum of `entry.tokens`; group by `metadata.workflow`.
- **Tier key set:** fixed four — `trivial | quick | standard | full` (the
  `recommended_workflow` enum in `src/schemas/change-metadata.ts` L29). Note
  `ChangeMetadataSchema.workflow` is `z.string()`, so unknown workflow names are possible;
  recommend ignoring changes whose `workflow` is outside the four for this metric (stable
  JSON shape beats dynamic keys; an unknown tier has nowhere sane to render in human
  output). Always emit all four keys, each `{ mean, sample_size }` or `null`.
- Never throws; a wholly empty result is `{ trivial: null, quick: null, standard: null,
  full: null }` (per-tier null is what the spec's JSON scenario requires — there is no
  whole-metric null).

**JSON:** add `avg_tokens_per_change_by_tier` to the payload (snake_case, sibling of
`model_escalation_rate`), null-per-tier passed through verbatim.

**Human:** one summary line rendering all four tiers, each as a formatted average or
explicit `no data`, e.g.
`  Avg tokens per change: trivial no data · quick 20k · standard 50k · full no data`.
Display format: `formatThousandsK` matches the existing 📊 token convention; the spec
scenario phrases the expectation as "shows average tokens per change of 20000", which
`20k` satisfies in spirit but not literally — design should pick one and the test should
assert that choice (minor; either is defensible, lean `k`-format for consistency).

**Tests:** extend `writeArchiveMetadata` in `tests/progress-ceremony-metrics.test.ts` with
an optional `token_usage` block (entries: task/agent/model/tokens/timestamp) plus new
cases: tier-grouped averages across active+archived, per-tier null vs 0 in JSON, human
no-data wording, pre-feature archive skipped. Unit tests for the helper go in
`tests/ceremony-metrics.test.ts`. Near-1:1 ratio is preserved (helper + tests in existing
paired files).

### 2.4 Alternatives considered (Part 2)

1. **Inline computation inside progress.ts** — rejected: every existing cross-change
   metric lives in `ceremony-metrics.ts` as a never-throwing helper; inlining breaks the
   functional-core convention and the 1:1 test mapping.
2. **Single overall average (no tier grouping) with tier breakdown in JSON only** —
   rejected: spec mandates tier grouping in both output modes.
3. **Dynamic tier keys (emit whatever `workflow` strings appear)** — rejected in favor of
   the fixed four: `workflow` is an open string, but the human line and the JSON contract
   want a stable shape; unknown tiers are a non-goal.

---

## Recommendation (one line)

Insert one byte-identical verbatim recording instruction (Option A) at the four anchors
identified above — metta-plan step 2d, metta-execute after the `agent.model` paragraph,
metta-verify between steps 2 and 3, metta-next `## Rules` — relying on
`tests/template-deploy-sync.test.ts` for template/deployed identity plus a new
`skill-tokens-record` content test; compute the progress aggregate as a
`getAvgTokensPerChangeByTier` helper in `src/util/ceremony-metrics.ts` cloned from the
`getModelEscalationRate` active+archive iteration, fixed four-tier keys, per-tier
`{ mean, sample_size } | null` with null passthrough.

No web grounding was required: every question in scope (skill wording, test enforcement,
progress conventions, schema shapes) had a deterministic in-repo answer.
