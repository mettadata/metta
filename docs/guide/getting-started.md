# Getting Started with metta

A first-time, zero-to-shipping tutorial. By the end you will have installed metta into a project and walked one small change all the way through to a merge on `main` — seeing exactly what gets written, checked, and committed at each step.

metta is a spec-driven development framework. You drive it from your AI coding tool (Claude Code today) using `/metta-*` slash commands. The framework manages state, specs, and quality gates; the AI tool does the actual work through structured subagents.

> **The one rule to remember:** in an AI session, you invoke the **`/metta-*` skills**, not the `metta` CLI directly. See [The two entry points](#2-the-two-entry-points) for why.

---

## 1. Install metta into a project

### Prerequisites

- **Node.js >= 22** (metta is ESM-only and uses modern Node APIs)
- A git repository (metta requires one; it offers to `git init` if there isn't one)
- An AI coding tool — Claude Code is the supported tool today

### Step 1 — Install the CLI

```bash
npm install -g @mettadata/metta
```

Verify it's available:

```bash
metta --version
```

### Step 2 — Scaffold your project

From the root of the project you want to adopt metta in:

```bash
cd your-project
metta install
```

`metta install` sets up the framework and prints what it created:

```
Metta initialized
  Created: .metta/
  Created: spec/
  Created: spec/project.md (constitution)
  Detected stack: js
  Detected: Claude Code
  Installed: 18 slash commands
  Installed: PreToolUse guard hook (.claude/hooks/metta-guard-edit.mjs)
  Installed: PreToolUse Bash guard hook (.claude/hooks/metta-guard-bash.mjs)
  Installed: statusline (.claude/statusline/statusline.mjs)
  Committed: initial metta setup

Next: run `metta init` to discover project context
```

What landed on disk:

| Path | What it is |
|------|------------|
| `.metta/config.yaml` | Project configuration |
| `.metta/gates/` | Scaffolded quality-gate definitions (for detected non-JS stacks) |
| `spec/project.md` | Your project constitution (template — fill it in via discovery) |
| `spec/changes/`, `spec/specs/`, `spec/archive/` | Where changes, living specs, and completed work live |
| `.claude/skills/` | The `/metta-*` slash commands for Claude Code |
| `.claude/agents/` | The metta subagent personas (proposer, executor, reviewer, verifier, …) |
| `.claude/hooks/` | Guard hooks that keep AI sessions on the skill path |

metta auto-detects your stack from marker files (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`). To override, pass `--stack` (e.g. `metta install --stack rust,python`) or `--stack skip`. If you don't have a git repo yet, add `--git-init`.

### Step 3 — Discover project context

Open your AI coding tool in the project and run the discovery skill:

```
/metta-init
```

The AI agent interviews you (or scans your existing code first, for brownfield projects) about your stack, conventions, constraints, and quality bar. The result is a completed constitution at `spec/project.md` and a generated `CLAUDE.md` that gives every future AI interaction full project awareness.

You're now ready to make changes.

---

## 2. The two entry points

metta scales ceremony to complexity. There are two skills you'll reach for most:

| Skill | Use it for | What it does |
|-------|-----------|--------------|
| `/metta-quick <description>` | Small, well-understood changes — typo fixes, one-file edits, adding a small flag, tiny refactors | Skips planning. Runs intent → implementation → review → verification → finalize → merge. |
| `/metta-propose <description>` | Non-trivial work — new features, multi-file changes, anything touching an API surface or a contract | Full spec-driven flow. Adds discovery questions, a spec, research, design, and a task plan before any code is written. |

Rule of thumb: **if you can describe the change in one sentence and it has no real design decisions, use `/metta-quick`.** If you'd want to think about the approach, data shape, or scope first, use `/metta-propose`. If a quick change turns out to be bigger than expected, metta will tell you to switch to `/metta-propose`.

### The skills-not-CLI rule

When an **AI tool** is driving the session, it must invoke the `/metta-*` skills — **never** call `metta quick`, `metta propose`, `metta finalize`, etc. directly. The skills wrap each step with the correct subagent personas and quality guarantees; calling the CLI raw bypasses those and has shipped broken artifacts in the past. (A human typing `metta` commands in a terminal is fine — this rule scopes to AI-driven sessions. A guard hook enforces it.)

So everything below shows the **slash command you type in chat**. The CLI commands the skill runs under the hood are shown only to explain what's happening.

---

## 3. Worked example: ship a small change end-to-end

Let's fix a real, small problem with `/metta-quick`: a typo in an error message. Say the `doctor` command prints `Cofnig file not found:` and we want it spelled `Config`.

### Step 1 — Start the change

In your AI tool's chat, type:

```
/metta-quick fix typo in doctor error message
```

That triggers the `metta-quick` skill. Everything from here is what the skill's orchestrator does for you — you just watch and answer any questions.

Under the hood it runs `metta quick ... --json`, which:

- Loads the **quick** workflow (3 artifacts: `intent → implementation → verification`)
- Creates `spec/changes/fix-typo-in-doctor-error-message/` with a state file
- Cuts a new branch: `metta/fix-typo-in-doctor-error-message`

All work happens on that branch, never directly on `main`.

### Step 2 — Light discovery (skipped here)

Before writing anything, the orchestrator checks whether the change has real ambiguity. A single-line typo fix has no approach or scope decisions, so it prints:

```
Resolved: all questions. Proceeding to proposer subagent.
```

and skips straight to work. (For a less trivial quick change, it would ask you 2–4 questions first, each ending with an `I'm done — proceed with these answers` option so you can cut it short.)

### Step 3 — Intent

A `metta-proposer` subagent reads the source to find the offending string and writes the first artifact:

```
spec/changes/fix-typo-in-doctor-error-message/intent.md
```

It contains **Problem**, **Proposal**, **Impact**, and **Out of Scope** sections, and is committed as `docs(...): create intent`. The orchestrator then advances the workflow (`metta complete intent`), which flips the intent to done and marks `implementation` ready.

### Step 4 — Implementation

A `metta-executor` subagent does the actual fix:

- Reads `intent.md` for context
- Corrects the typo in the source file
- Runs `npm test` and confirms green
- Commits: `fix(...): correct typo in doctor error message`
- Writes a short `summary.md`

Then it advances (`metta complete implementation`).

### Step 5 — Review (3 reviewers in parallel)

The orchestrator spawns three `metta-reviewer` subagents at once — **correctness**, **security**, and **quality**. For a one-word typo fix all three return `PASS` fast. Their verdicts are merged into `review.md`, which the orchestrator commits (the reviewer subagents don't run git). (If a reviewer found a real problem, the orchestrator would fix it and re-review — up to 3 iterations.)

### Step 6 — Verification (3 verifiers in parallel)

Three `metta-verifier` subagents run concurrently:

1. `npm test` — reports pass/fail counts
2. `npx tsc --noEmit` + `npm run lint` — reports type/lint errors
3. Intent-evidence check — confirms each goal in `intent.md` is actually implemented, citing `file:line`

Results are merged into `summary.md`, which the orchestrator commits (the verifier subagents don't run git). The orchestrator advances (`metta complete verification`), which now reports `all_complete: true`.

### Step 7 — Finalize and merge with `/metta-ship`

The last leg finalizes the change and merges it to `main`. The `metta-quick` skill does this automatically at the end, but you can also drive it explicitly:

```
/metta-ship
```

`/metta-ship` is a deliberate two-step:

1. **Finalize** (on the feature branch). It always **dry-runs first**, then:
   - Merges any delta specs into the living specs under `spec/specs/` (a no-op for this typo fix — quick changes don't write a `spec.md`)
   - Runs the quick workflow's quality gates (in declaration order) — `tests`, `lint`, `typecheck`, `build` — and aborts if any fails. (Other gates like `stories-valid` belong to the standard workflow's `spec` stage and don't run here.)
   - Archives `spec/changes/fix-typo-in-doctor-error-message/` to `spec/archive/<date>-fix-typo-in-doctor-error-me/`, with a `gates.yaml` summary alongside
   - Commits: `chore(...): archive and finalize`
2. **Ship** (merge to main):
   ```bash
   git checkout main
   git merge metta/fix-typo-in-doctor-error-message --no-ff \
     -m "chore: merge fix-typo-in-doctor-error-message"
   ```

If finalize finds a spec conflict, `/metta-ship` stops and tells you — it won't force anything through.

### What you end up with

The artifacts produced on the branch:

```
spec/changes/fix-typo-in-doctor-error-message/
├── intent.md      # proposer — Problem / Proposal / Impact / Out of Scope
├── review.md      # 3 reviewers merged
└── summary.md     # implementation + verification notes (the `verification` stage generates summary.md)
```

After finalize, the same files live under `spec/archive/<date>-fix-typo-in-doctor-error-me/` plus a `gates.yaml`. A clean quick change produces roughly 7–9 commits on the branch plus the merge commit on `main` — a complete, auditable trail of the change from intent to ship.

That's the whole loop: **describe → answer any questions → review → verify → ship**, with the spec and gates keeping it honest.

---

## 4. What to do next

- **Try a bigger change.** Run `/metta-propose <description>` on a real feature and watch the discovery questions, spec, research, design, and task plan get built before any code. See the [standard-workflow walkthrough](../workflows/walkthroughs.md#walkthrough-2-new-feature-via-metta-propose-standard-workflow).
- **Check where you are anytime.** `/metta-status` (current change) and `/metta-progress` (project-wide dashboard). Not sure what's next? `/metta-next` routes you.
- **Understand the model.** Read [`concepts.md`](./concepts.md) for how workflows, artifacts, gates, and specs fit together.
- **Look up a command or skill.** See [`cli-reference.md`](./cli-reference.md) for the full CLI and skill catalog.
- **Go deep on the workflow internals.** The [`../workflows/`](../workflows/) reference covers [workflows](../workflows/workflows.md), [skills](../workflows/skills.md), [artifacts](../workflows/artifacts.md), [agents](../workflows/agents.md), [gates](../workflows/gates.md), and [state](../workflows/state.md), with four end-to-end [walkthroughs](../workflows/walkthroughs.md).

### More entry points worth knowing

| Skill | For |
|-------|-----|
| `/metta-auto <description>` | Run the full lifecycle in one shot (discover → build → verify → ship) |
| `/metta-fix-issues <slug>` | Resolve a logged issue from `spec/issues/` |
| `/metta-issue <description>` | Log an issue to fix later |
| `/metta-import` | Generate specs from an existing codebase, with a gap report |
| `/metta-refresh` | Regenerate `CLAUDE.md` after specs change |
