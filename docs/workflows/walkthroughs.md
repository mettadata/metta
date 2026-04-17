# Walkthroughs

End-to-end narrated examples of using metta. Each walkthrough follows the command an AI orchestrator would invoke, shows the artifact files that land on disk, and names which subagent wrote what.

For reference while reading:

- Workflow DAGs and stage tables — [`workflows.md`](./workflows.md)
- Skill orchestrator contracts — [`skills.md`](./skills.md) and `src/templates/skills/<skill-name>/SKILL.md`
- Gate definitions and order — [`gates.md`](./gates.md) and `src/templates/gates/*.yaml`
- Per-agent personas — [`agents.md`](./agents.md) and `src/templates/agents/metta-<agent>.md`

Conventions throughout:

- Commands in code fences are what the **orchestrator** runs (never what the user types in chat).
- "Spawn N agents in a single message" means the orchestrator sends one Agent tool call containing N sub-prompts — the harness runs them in parallel.
- All changes happen on a branch `metta/<change-slug>` carved off `main` by `metta propose` / `metta quick`.

---

## Walkthrough 1: Small fix via `/metta-quick`

**Scenario.** The `doctor` command emits `Cofnig file not found:` on a fresh clone — a typo in one string literal. The user wants it spelled `Config`.

### Invocation

User types in chat:

```
/metta-quick "fix typo in doctor error message"
```

That triggers the `metta-quick` skill. The rest of this walkthrough is what the skill's orchestrator (Claude, running under the skill's `SKILL.md`) does, step by step.

### Step 1 — Create the change

```bash
metta quick "fix typo in doctor error message" --json
```

The CLI loads the `quick` workflow (`src/templates/workflows/quick.yaml`), topologically sorts its three artifacts (`intent → implementation → verification`), creates `spec/changes/fix-typo-in-doctor-error-message/` with a `.metta.yaml` state file, and cuts a new branch:

```
metta/fix-typo-in-doctor-error-message
```

The JSON response names the change, the branch, and the artifact list.

### Step 2 — Light discovery (skipped, trivial)

The skill's SKILL.md requires the orchestrator to run a trivial-detection gate before asking any questions. "Fix typo in one string literal" has no approach, scope, or integration ambiguity — single-line fix, one file. The orchestrator prints:

```
Resolved: all questions. Proceeding to proposer subagent.
```

and skips the discovery loop entirely.

### Step 3 — Intent

The orchestrator fetches the persona and template for the `intent` artifact:

```bash
metta instructions intent --json --change fix-typo-in-doctor-error-message
```

It then spawns a single `metta-proposer` subagent with the returned persona and template. The proposer:

- Reads the existing `doctor` command source to find the offending string
- Writes `spec/changes/fix-typo-in-doctor-error-message/intent.md` containing **Problem**, **Proposal**, **Impact**, **Out of Scope**
- Commits: `docs(fix-typo-in-doctor-error-message): create intent`

The orchestrator then advances the workflow:

```bash
metta complete intent --json --change fix-typo-in-doctor-error-message
```

The `complete` command verifies `intent.md` exists, flips `artifacts.intent` from `in_progress` to `complete`, marks the next artifact (`implementation`) as `ready`, and auto-commits the `.metta.yaml` state update: `docs(fix-typo-in-doctor-error-message): complete intent`.

### Step 4 — Implementation

Quick is a single-file typo fix, so the orchestrator spawns **one** `metta-executor` (parallel fan-out is only beneficial when tasks touch different files). The executor:

- Reads `intent.md` for context
- Fixes the typo in the doctor command source file
- Runs `npm test` and confirms green
- Commits: `fix(fix-typo-in-doctor-error-message): correct typo in doctor error message`
- Writes a short `spec/changes/fix-typo-in-doctor-error-message/summary.md`

The orchestrator then writes a **stories sentinel** and commits it:

```
spec/changes/fix-typo-in-doctor-error-message/stories.md
```

Content is the sentinel form: "No user stories — internal/infrastructure change" plus a short justification.

Why this file exists even though the `quick` workflow has no `stories` artifact: the `stories-valid` gate lives in the gate registry, and the finalizer runs **every** registered gate regardless of which workflow ran. Without a `stories.md` carrying valid sentinel frontmatter (or real user-story blocks), `stories-valid` fails and finalize aborts. See [`gates.md`](./gates.md) for the gate's exact contract.

Then:

```bash
metta complete implementation --json --change fix-typo-in-doctor-error-message
```

### Step 5 — Review fan-out (3 reviewers in parallel)

The orchestrator spawns **three `metta-reviewer` subagents in a single Agent call**:

1. Correctness reviewer
2. Security reviewer
3. Quality reviewer

For a one-word typo fix all three will return `PASS` quickly. Their verdicts are merged into `spec/changes/fix-typo-in-doctor-error-message/review.md` and committed: `docs(fix-typo-in-doctor-error-message): reviewer verdicts`.

### Step 6 — Verification fan-out (3 verifiers in parallel)

Also in a single Agent call:

1. `npm test` runner — reports pass/fail counts
2. `npx tsc --noEmit` and `npm run lint` — reports type/lint errors
3. Intent-evidence verifier — confirms each goal in `intent.md` is implemented in the code (cites `file:line`)

Results are merged into `summary.md` and committed: `docs(fix-typo-in-doctor-error-message): verification summary`.

```bash
metta complete verification --json --change fix-typo-in-doctor-error-message
```

`complete` reports `all_complete: true` and suggests `metta finalize --change fix-typo-in-doctor-error-message`.

### Step 7 — Finalize

```bash
metta finalize --json --change fix-typo-in-doctor-error-message
```

The `Finalizer` (`src/finalize/finalizer.ts`) runs in this order:

1. **Spec merge** — no delta specs (quick never writes `spec.md`), so this is a no-op
2. **Quality gates** — runs *every* gate registered in the gate registry, not just the ones listed in the workflow's artifact stages. `GateRegistry.loadFromDirectory` reads `src/templates/gates/*.yaml` via `readdir`, which returns filenames in alphabetical order, so the runtime execution order is alphabetical by gate id:

   | Order | Gate | Purpose |
   |---|---|---|
   | 1 | `build` | `npm run build` |
   | 2 | `lint` | `npm run lint` |
   | 3 | `stories-valid` | `metta validate-stories` — reads `stories.md` (sentinel allowed) |
   | 4 | `tests` | `npm test` |
   | 5 | `typecheck` | `npx tsc --noEmit` |

   All gates pass → `gatesPassed: true`. See [`gates.md`](./gates.md) for per-gate failure modes.

3. **Archive** — `spec/changes/fix-typo-in-doctor-error-message/` is moved to `spec/archive/<YYYY-MM-DD>-fix-typo-in-doctor-error-me/` and a `gates.yaml` summary is written alongside it.
4. **Docs** — if `docs.generate_on: finalize` is configured, `DocGenerator` runs. Otherwise skipped.
5. **Auto-commit** — `chore(fix-typo-in-doctor-error-message): archive and finalize`

### Step 8 — Merge to main

```bash
git checkout main
git merge metta/fix-typo-in-doctor-error-message --no-ff \
  -m "chore: merge fix-typo-in-doctor-error-message"
```

The branch is left intact on the local clone. `metta abandon` does not delete branches automatically — operator chore.

### Artifacts produced

On the branch before finalize:

```
spec/changes/fix-typo-in-doctor-error-message/
├── .metta.yaml          # state (workflow, artifact statuses, base_versions)
├── intent.md            # proposer
├── stories.md           # sentinel
├── review.md            # 3 reviewers merged
└── summary.md           # implementation + verification notes
```

After finalize, the same contents land in `spec/archive/<date>-fix-typo-in-doctor-error-me/` plus a `gates.yaml`.

### Typical commit count

A clean quick change produces ~7–9 commits on the branch:

1. `docs(...): create intent`
2. `docs(...): complete intent`
3. `fix(...): correct typo in doctor error message`
4. `docs(...): add stories sentinel`
5. `docs(...): complete implementation`
6. `docs(...): reviewer verdicts`
7. `docs(...): verification summary`
8. `docs(...): complete verification`
9. `chore(...): archive and finalize`

Plus the merge commit on main.

---

## Walkthrough 2: New feature via `/metta-propose` (standard workflow)

**Scenario.** Add a `--json` output mode to the `metta doctor` command so it can be consumed by scripts and the statusline.

### Invocation

```
/metta-propose "add --json mode to metta doctor"
```

This hands off to the `metta-propose` skill. Default workflow is `standard`.

### Step 1 — Create the change

```bash
metta propose "add --json mode to metta doctor" --json
```

Creates `spec/changes/add-json-mode-to-metta-doctor/`, cuts branch `metta/add-json-mode-to-metta-doctor`, and returns an artifact list in the `standard` order:

```
intent → stories → spec → research → design → tasks → implementation → verification
```

### Step 2 — Discovery loop

Unlike a typo fix, this change has real ambiguity — data shape, error semantics, compatibility with the existing text output. The orchestrator reads `src/cli/commands/doctor.ts` and related helpers to ground itself, then runs 2–4 rounds of `AskUserQuestion`. Every call ends with the exit option `I'm done — proceed with these answers`.

**Round 1 — scope + architecture.**

- "What fields should `--json` emit?" → [`{status, checks[]}`, `{status, findings[]}`, mirror human output with keyed fields, `I'm done — proceed with these answers`]
- "When a check fails, how is failure represented?" → [boolean `ok:false`, severity enum `ok|warn|fail`, exception-shaped `{error:...}`, `I'm done — proceed with these answers`]
- "Stream results as they complete, or buffer and emit a single object?" → [single object, NDJSON stream, `I'm done — proceed with these answers`]

Orchestrator prints between rounds:

```
Resolved: output fields, failure shape. Open: streaming. Proceeding to Round 2.
```

**Round 2 — data model + integration** (runs because the change introduces a new external-facing schema):

- "Should we expose the schema as a `zod` object exportable from `src/schemas/`?" → [yes — new `DoctorReportSchema`, no — ad-hoc type, `I'm done — proceed with these answers`]
- "Include a `version` field for forward-compat?" → [yes with `v1`, no, `I'm done — proceed with these answers`]

**Round 3 — edge cases** (runs because this touches runtime code):

- "On `--json` with a gate error, exit code 1 like today, or exit 0 and signal via payload?" → [preserve exit 1, exit 0 payload-only, `I'm done — proceed with these answers`]

After round 3 the orchestrator prints:

```
Resolved: all questions. Proceeding to proposer subagent.
```

### Step 3 — Planning artifacts

For each planning artifact, the loop is the same: `metta instructions <artifact>` → spawn subagent → subagent writes file + commits → `metta complete <artifact>`.

| Stage | Subagent | Output file | Notes |
|---|---|---|---|
| intent | `metta-proposer` | `intent.md` | receives cumulative Q/A pairs from discovery |
| stories | `metta-product` | `stories.md` | orchestrator passes intent wrapped in `<INTENT>...</INTENT>` to prevent prompt injection |
| spec | `metta-proposer` | `spec.md` | gates: `spec-quality`, `stories-valid` |
| research | `metta-researcher` × 2–4 in parallel | `research.md` | one agent per candidate approach, then orchestrator merges |
| design | `metta-architect` | `design.md` | gate: `design-review` |
| tasks | `metta-planner` | `tasks.md` | gate: `task-quality` |

Concretely for research, the orchestrator might fan out two researchers: one investigating "print JSON via existing logger pathway" and another investigating "collect findings into a schema-validated struct and `console.log(JSON.stringify(...))`". Each writes a self-contained `research.md` snippet; the orchestrator merges them into one `research.md` with a recommendation section and commits.

After every `metta complete <artifact>`, the `.metta.yaml` state auto-commits: `docs(add-json-mode-to-metta-doctor): complete <artifact>`.

### Step 4 — Implementation (parallel per batch)

The orchestrator reads `tasks.md` itself and parses batches:

```
## Batch 1 — schema + plumbing
- T1  src/schemas/doctor-report.ts  (new)
- T2  src/cli/commands/doctor.ts    (wire --json flag)

## Batch 2 — tests
- T3  src/schemas/doctor-report.test.ts
- T4  src/cli/commands/doctor.test.ts
```

Batch 1: T1 and T2 touch different files → **two `metta-executor` subagents in a single Agent call**, parallel. Each executor prompt contains *only its own task* (Files, Action, Verify, Done) — never the entire `tasks.md`. Each executor:

- Reads the files in the **Files** field
- Implements **Action**
- Runs the command in **Verify**
- Commits: `feat(add-json-mode-to-metta-doctor): <task description>`
- Flips its own `- [ ]` to `- [x]` in `tasks.md` and stages it with the code in a single commit

Batch 2 starts only after Batch 1 finishes. Same pattern: two parallel executors.

After all batches, the orchestrator writes `summary.md` and commits:

```bash
metta complete implementation --json --change add-json-mode-to-metta-doctor
```

### Step 5 — Review (3 parallel)

Same pattern as walkthrough 1 — three `metta-reviewer` subagents (correctness, security, quality) fanned out in a single Agent call. Results merged into `review.md` and committed.

If any reviewer returns `NEEDS_CHANGES`: the orchestrator parses each issue's file path, groups by file, and spawns parallel `metta-executor` subagents to fix. After fixes, the three reviewers run again. Max 3 iterations.

### Step 6 — Verification (3 parallel)

Three `metta-verifier` subagents: `npm test`, type+lint, spec-evidence (confirms every Given/When/Then in `spec.md` has a passing test that exercises it, cites evidence).

Results merged into `summary.md` and committed.

```bash
metta complete verification --json --change add-json-mode-to-metta-doctor
```

### Step 7 — Finalize

```bash
metta finalize --json --change add-json-mode-to-metta-doctor
```

Unlike quick, this change *does* write a `spec.md` with delta specs, so `SpecMerger` runs: delta blocks in `spec/changes/<change>/spec.md` are merged into `spec/specs/doctor/spec.md` (creating the capability directory if it does not yet exist). Then gates run in alphabetical order (`build`, `lint`, `stories-valid`, `tests`, `typecheck`). Then archive. Then docs regen if configured.

### What `spec/specs/doctor/spec.md` looks like after merge

Rough shape of the merged file:

```markdown
# doctor — Specification

## Capability overview
The `metta doctor` command performs environment checks...

## Requirements
### US-DOCTOR-001 — `--json` flag emits machine-readable report
When the user invokes `metta doctor --json`, the command MUST emit a
single JSON object matching `DoctorReportSchema` v1 to stdout, with
exit code 0 on all-pass and exit code 1 when any check fails.

- Given the command is invoked with `--json`
- When all environment checks pass
- Then stdout contains a single JSON object with `status: "pass"`,
  a `version` field, and a `checks` array of per-check results
- And exit code is 0

### US-DOCTOR-002 — failure surfaces per-check severity
...
```

The key thing: requirement IDs (`US-DOCTOR-001`) are stable across changes; future deltas `modify` or `remove` by ID, not by diff.

### Step 8 — Merge to main

```bash
git checkout main
git merge metta/add-json-mode-to-metta-doctor --no-ff \
  -m "chore: merge add-json-mode-to-metta-doctor"
```

---

## Walkthrough 3: Bug fix via `/metta-fix-issues` (historical example)

**Scenario.** An issue was logged earlier: `full-workflow-references-missing-template-files-domain-resea` — the `full` workflow YAML references artifact templates (`domain-research.md`, `architecture.md`, `ux-spec.md`) that don't exist in `src/templates/artifacts/`, so `metta instructions` fails the first time a `full`-workflow change reaches those stages.

> **Note.** This issue has already been resolved — the narrative below reconstructs the fix as it would have been driven by `/metta-fix-issues`, using the actual change that shipped. The issue now lives under `spec/issues/resolved/full-workflow-references-missing-template-files-domain-resea.md`, the fix was committed as `bcc7c031f`, and the archived change is `spec/archive/2026-04-17-fix-issue-full-workflow-refere/`. Read this walkthrough as "here's exactly what `/metta-fix-issues` did for this real case", not "go run this command to reproduce it".

### Invocation

```
/metta-fix-issues full-workflow-references-missing-template-files-domain-resea
```

### Step 1 — Validate the issue exists

```bash
metta issue show full-workflow-references-missing-template-files-domain-resea --json
```

If the slug is unknown, the orchestrator stops and reports the error. Otherwise it captures the issue's title, severity, description, and any Location/Files fields.

### Step 2 — Propose a change for the fix

```bash
metta propose "fix issue: full-workflow-references-missing-template-files-domain-resea — full workflow references missing template files" --json
```

Default `standard` workflow, new branch `metta/fix-issue-full-workflow-refere`.

### Step 3 — Discovery is skipped

Per the `metta-fix-issues` SKILL.md rules: **discovery mode is always `batch`**. The issue body is the discovery — it already names the files, the symptom, and the expected behavior. The orchestrator does *not* run `AskUserQuestion`; it feeds the full issue JSON to every subagent it spawns.

### Step 4 — Planning artifacts

Identical to walkthrough 2, with one twist: every subagent's prompt contains the original issue as context so intent, spec, design, and tasks all stay anchored to the reported defect.

| Stage | Subagent | Output |
|---|---|---|
| intent | `metta-proposer` | `intent.md` (Problem section quotes the issue) |
| stories | `metta-product` | `stories.md` (often the sentinel form, since a bug fix usually has no new user stories) |
| spec | `metta-proposer` | `spec.md` (adds or modifies requirements covering the regression) |
| research | `metta-researcher` × 2–3 parallel | `research.md` |
| design | `metta-architect` | `design.md` |
| tasks | `metta-planner` | `tasks.md` |

After each planning artifact: `metta complete <artifact>`.

### Step 5 — Implementation, review, verification

Same three-phase parallel pattern as walkthrough 2 — executors per task batch, then 3 reviewers, then 3 verifiers. If reviewers surface critical issues, the review-fix loop runs (max 3 iterations).

### Step 6 — Finalize

```bash
metta finalize --json --change fix-issue-full-workflow-refere
```

Gates run in alphabetical order (`build → lint → stories-valid → tests → typecheck`). The `stories-valid` gate reads the stories-sentinel produced by the product agent and passes it as valid. Specs merge (any new/modified requirements land in `spec/specs/<capability>/spec.md`). Archive lands in `spec/archive/<date>-fix-issue-full-workflow-refere/`.

### Step 7 — Merge to main

```bash
git checkout main
git merge metta/fix-issue-full-workflow-refere --no-ff \
  -m "chore: merge fix-issue-full-workflow-refere"
```

### Step 8 — Remove the resolved issue

The last step — distinct from plain `/metta-propose` — is:

```bash
metta fix-issue --remove-issue full-workflow-references-missing-template-files-domain-resea --json
```

This:

1. Archives `spec/issues/full-workflow-references-missing-template-files-domain-resea.md` to `spec/issues/resolved/`
2. Removes the file from `spec/issues/`
3. Auto-commits on `main`: `fix(issues): remove resolved issue full-workflow-references-missing-template-files-domain-resea`

The issue now lives only in `spec/issues/resolved/` as the historical record.

---

## Walkthrough 4: Complex system via `/metta-propose --workflow full`

**Scenario.** Add a metta-observability subsystem: structured event logging, a CLI surface (`metta obs tail`), a dashboard UI sketch, and a formal architecture doc. This is a new subsystem with its own vocabulary and UX — the textbook case for the `full` workflow.

### Invocation

```
/metta-propose --workflow full "add metta-observability subsystem"
```

The `metta-propose` skill parses out `--workflow full` and runs:

```bash
metta propose "add metta-observability subsystem" --workflow full --json
```

Creates `spec/changes/add-metta-observability-subsystem/`, branch `metta/add-metta-observability-subsystem`, artifact order returned from the `full` workflow graph:

```
domain-research → intent → spec → research → design ┬─ tasks ──────┐
                                                    ├─ ux-spec     │
                                                    └─ architecture┴─→ implementation → verification
```

### Step 1 — Domain research first

Unique to `full`: before an intent is written, the orchestrator spawns 2–4 `metta-researcher` subagents in parallel, each investigating a facet of the domain (e.g. "OpenTelemetry vs custom event schema", "pull-model vs push-model collection", "on-disk vs streaming retention", "terminology survey — spans, traces, events"). Each researcher writes a partial `domain-research.md`; the orchestrator merges and commits `docs(add-metta-observability-subsystem): create domain-research`, then `metta complete domain-research`.

### Step 2 — Discovery + intent

The discovery loop runs here — same format as walkthrough 2 but grounded on the domain-research findings rather than raw user description. Then a single `metta-proposer` writes `intent.md`, `metta complete intent`.

### Step 3 — Spec

One `metta-proposer` writes `spec.md`. Gate: `spec-quality` only (full workflow omits `stories-valid` at the spec stage because there is no separate stories artifact — user stories are folded into the spec itself).

### Step 4 — Research

One or more `metta-researcher` subagents evaluate implementation approaches now that the spec is concrete. Results merged into `research.md`.

### Step 5 — Design

One `metta-architect` writes `design.md`. Gate: `design-review`.

### Step 6 — Parallel fan-out: tasks + architecture + ux-spec

This is where `full` differs structurally from `standard`. After `design` completes, `getNext` surfaces three artifacts as ready simultaneously:

- `tasks` (planner)
- `architecture` (architect, depth-mode — system boundaries, data flow, state machines)
- `ux-spec` (architect, UX contract for the dashboard UI)

The orchestrator spawns them in one Agent call:

1. `metta-planner` → `tasks.md` (gate: `task-quality`)
2. `metta-architect` with architecture persona → `architecture.md`
3. `metta-architect` with ux-spec persona → `ux-spec.md`

Each commits independently. `metta complete` is called for each once written.

### Step 7 — Implementation gate

Critical `full`-specific rule from `full.yaml`:

```yaml
- id: implementation
  requires: [tasks, architecture]
```

The engine will **not** surface `implementation` as `ready` until both `tasks` *and* `architecture` are `complete` or `skipped`. `ux-spec` is not in the `requires` list — the engine will surface `implementation` even if `ux-spec` is still pending. In practice the orchestrator finishes all three sibling artifacts before starting execution.

Implementation itself runs the same per-batch parallel pattern as walkthrough 2: read `tasks.md`, parse batches, spawn one `metta-executor` per task per batch in a single message when files don't overlap.

### Step 8 — Verification

Three `metta-verifier` subagents in parallel (tests, typecheck+lint, spec-evidence). The verification stage's gate is `uat`. For a subsystem-level change the UAT gate typically requires the orchestrator to demonstrate the new CLI surface end-to-end (`metta obs tail` emits events in the documented shape, dashboard renders the documented screens).

Results in `summary.md`, commit, `metta complete verification`.

### Step 9 — Finalize

```bash
metta finalize --json --change add-metta-observability-subsystem
```

Same gate sequence as always — alphabetical by gate id: `build`, `lint`, `stories-valid`, `tests`, `typecheck`. Because this change introduces a brand-new capability `observability`, `SpecMerger` creates `spec/specs/observability/spec.md` from the delta spec in the change. Archive lands in `spec/archive/<date>-add-metta-observability-subsystem/` with every artifact file preserved:

```
spec/archive/<date>-add-metta-observability-subsystem/
├── domain-research.md
├── intent.md
├── spec.md
├── research.md
├── design.md
├── architecture.md
├── tasks.md
├── ux-spec.md
├── review.md
├── summary.md
└── gates.yaml
```

### Step 10 — Merge

```bash
git checkout main
git merge metta/add-metta-observability-subsystem --no-ff \
  -m "chore: merge add-metta-observability-subsystem"
```

---

## Common orchestration gotchas

### Smoke-test changes leave a branch behind

`metta abandon` marks a change as abandoned in state and renames the archive dir with an `-abandoned` suffix, but **does not delete the git branch**. If you smoke-test `/metta-propose` twice, the second attempt can fail on `git checkout -b metta/<slug>` because the branch from the first run is still there. Delete stale branches by hand:

```bash
git branch -D metta/<old-slug>
```

Example currently in the archive: `spec/archive/2026-04-17-full-workflow-smoke-test-shoul-abandoned/`. The corresponding `metta/full-workflow-smoke-test-shoul` branch may still exist locally.

### Stub artifacts still fail `stories-valid` at finalize

Writing a literal string like `"intent stub"` or `"stories stub"` to satisfy `metta complete` is explicitly forbidden by the project constitution, and for good reason: the `stories-valid` gate runs at **finalize**, not at `metta complete`. A placeholder `stories.md` without a real `kind: sentinel` frontmatter + justification — or without valid user-story blocks — will fail `metta validate-stories` and block the finalize step. The correct move is to have the `metta-product` subagent author the real stories file (or a proper sentinel form) up front.

Related issue: `spec/issues/resolved/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md` (if archived) or `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md` (if still open).

### The guard hook blocks Write when no active change exists

The repo's guard hook prevents `Write` from creating files under `spec/changes/<slug>/` when `<slug>` is not the active change (per `.metta/state.yaml`). If you try to author an artifact by hand before running `metta propose` or `metta quick`, the hook rejects the write. **Always start a change first** via the appropriate skill:

```
/metta-quick "<description>"
/metta-propose "<description>"
/metta-fix-issues <slug>
```

Related issue: `spec/issues/metta-discovery-agent-cannot-write-outside-an-active-change-.md`.

---

## Cross-links

- [`workflows.md`](./workflows.md) — workflow YAML reference (quick, standard, full) and engine semantics
- [`skills.md`](./skills.md) — the full skill catalog
- [`gates.md`](./gates.md) — gate definitions and failure modes
- [`agents.md`](./agents.md) — per-agent personas and responsibilities
- `src/templates/skills/<skill-name>/SKILL.md` — authoritative skill orchestrator contracts
- `src/templates/workflows/*.yaml` — authoritative workflow DAGs
- `src/finalize/finalizer.ts` — finalize sequence (merge → gates → archive → docs)
