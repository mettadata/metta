# metta

## Response style
* Default to brief. Lead with the answer or the outcome, not the reasoning.
* No preamble, no restating my question, no narrating steps as you go.
* Summarize completed work in 1–3 lines. Skip file-by-file recaps unless a change is non-obvious.
* Expand only when I ask ("explain", "why", "walk me through", "in detail").
* Exception: always surface risks, breaking changes, or assumptions you made — one line each, never dropped for brevity.

<!-- metta:project-start source:spec/project.md -->
## Project

**metta** -- **metta** is a composable, spec-driven development framework for AI-native software engineering. It is a CLI / developer tool that orchestrates the full change lifecycle — propose → plan → execute → verify → finalize → ship — for internal developers adopting metta on their own projects. The framework works with any AI coding tool via instruction mode: metta manages state and specs while the AI tool executes the work.

Stack: **Language:** TypeScript (strict mode, ES2022 target), **Runtime:** Node.js >= 22 (ESM only), **Frameworks & libraries:**, - Commander.js — CLI argument parsing, - Zod — schema validation on every state read/write, - Vitest — unit testing, - remark-parse + unified — markdown spec parsing, **Persistence:** Filesystem-based — `.metta/` YAML state files, `spec/` spec store, git as the transaction log, **Toolchain:** `tsc` for build, `npm` for package management (tsx is a declared devDependency used by the CLI test harness), **AI execution model:** All AI-driven work runs inside the Claude Code session via skills and subagents (instruction mode); no direct hosted-model provider API calls anywhere in the codebase.
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

- Classes for stateful modules; interfaces for contracts
- `camelCase` for functions/variables, `PascalCase` for classes/types, `kebab-case` for filenames
- Always include `.js` extensions in TypeScript import paths (Node16 ESM)
- Validate all state and config with Zod schemas
- Custom error classes with typed hierarchies
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Barrel exports via `index.ts` at the `src/` root
- Template files (YAML workflows, gates, artifacts, skills, agents) are copied to `dist/` at build time — never inlined as string literals
- Functional core, imperative shell: pure logic in modules, I/O at the edges
- Maintain near 1:1 test-to-source file ratio
- No CommonJS
- No singletons
- No unvalidated state writes
- No auto-push to remote without explicit user confirmation
- No `--force` pushes, no `--no-verify`, no destructive git ops without user request
- No string literal templates in TypeScript code
<!-- metta:conventions-end -->

<!-- metta:workflow-start -->
## Metta Workflow

### How to work

**State-mutating metta commands MUST go through the matching metta skill — never as direct CLI calls from an AI orchestrator session.** Enforcement authority is the `metta-guard-bash` PreToolUse hook: it blocks mutating and unrecognized commands (fail-closed) but permits a read-only query surface directly. (Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.) The skills wrap artifact authoring, review, and verification with the correct subagent personas; calling the CLI directly bypasses those guarantees and has shipped broken artifacts (see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`).

Primary entry points:
- `/metta-quick <description>` — small, scoped fixes (bug fixes, one-file edits, tiny refactors)
- `/metta-propose <description>` — anything non-trivial (new features, multi-file changes, API surface changes)
- `/metta-fix-issues <slug>` — resolve a logged issue from `spec/issues/`

Skill authorization is enforced by the `metta-guard-bash` PreToolUse hook via a two-tier trust model:
- **Tier 1 (fork-tier)** — `propose`, `quick`, `auto`, `ship`, `issue`, `fix-issue`: authorized by the caller identity (`agent_type`) the Claude Code runtime attaches when a forked `metta-skill-host` subagent issues the Bash call. The runtime sets this field itself, so it cannot be forged from command text.
- **Tier 2 (session-tier)** — `complete`, `finalize`, `refresh`, `import`, `init`, `fix-gap`, plus the scoped two-word forms `backlog add/done/promote` and `changes abandon`: authorized by per-skill session credentials at `.metta/scratch/skill-session/<slug>.token`. Each credential is minted by `.claude/hooks/metta-session-mint.mjs` when the matching skill is invoked, slide-rotated on active use (re-minted once it passes 80% of its TTL), and stamped with the runtime-supplied session id. During delegation windows where the mint hook cannot fire, the guard itself re-primes a session-bound credential on authorized use, so a live lifecycle keeps working across subagent turns; the effective lifetime is bounded — a credential dies TTL + GRACE after the last mint or re-prime. The credential value is a random server-minted string that never appears in any skill file, so it cannot be derived from reading skill instructions.
- **Emergency bypass (humans/CI)** — disable the guard hook in `.claude/settings.local.json`.

Quick mode is the default routing decision for small, bounded changes (single-file edits, typo/text fixes, small self-contained utilities, bug fixes with an obvious localized cause). Choosing or keeping `--workflow standard` or `--workflow full` above the scored recommendation requires a recorded justification — the escalation record written to the change's `.metta.yaml`.

Doc-only fixes and edits to this workflow section itself are the exceptions.

### Forbidden

- Invoking any state-mutating metta command directly from an AI orchestrator session: `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify`, `backlog add/done/promote/migrate`, `changes abandon`, `milestone create/close/update`, `roadmap add/reorder/next/remove`, `release cut`. Use the matching skill.
- Writing placeholder content like `"intent stub"` or `"summary stub"` to any artifact file to satisfy `metta complete`. Artifacts must carry real content authored by the matching `metta-*` subagent.

### Read-only queries (permitted directly)

The `metta-guard-bash` hook allows these directly — no skill needed. This list mirrors the hook's allow-lists at generation time; the hook, not this text, is authoritative:
- Single-word: `status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install` (`iteration`/`model-escalation`/`tokens` append instrumentation records and `install` writes scaffolding — guard-allowed, though not strictly read-only)
- Two-word: `issues list`, `gate list`, `changes list`, `backlog list|show`, `gaps list|show`, `milestone list|show`, `release status`
- Bare (flags only): `roadmap`, `release`, `backlog` (e.g. `metta roadmap --json`)

Run bare `metta` for the full current command listing. When in doubt about a command not listed here, attempt it — the guard fails closed and blocks anything unrecognized, so an attempt is always safe and never mutates state.

### Research discipline

When a research-phase or design-phase question has a deterministic answer in public documentation — framework API docs, library reference, CLI tool manual, language spec, SDK changelog — the orchestrator MUST use `WebFetch` (for a known authoritative URL) or `WebSearch` (to discover the authoritative source) to resolve it **before** asking the user. This specifically covers questions about external framework / API / tool documented behavior (e.g. "does Claude Code support `context: fork` in skill frontmatter?", "what fields does the Anthropic Messages API accept?", "is the `--legacy-peer-deps` flag deprecated in npm 10?").

Only escalate to the user for **subjective judgments** — scope boundaries, cost tradeoffs, product direction, approach choice between acceptable alternatives, risk acceptance. Never escalate a documented fact.

Cite the source URL when presenting findings so the user can verify the answer.

### Lifecycle skills
- `/metta-propose <description>` — start a new change (standard workflow); ends at an open PR — merge via `--ship` or `/metta-ship`
- `/metta-quick <description>` — quick mode, skip planning
- `/metta-auto <description>` — full lifecycle loop (discover → build → verify → ship)
- `/metta-plan` — build planning artifacts for the active change
- `/metta-execute` — run implementation for the active change
- `/metta-verify` — verify implementation against spec
- `/metta-uat` — execute a change's generated UAT.md acceptance script
- `/metta-ship` — finalize, merge specs, merge branch to main

### Status skills
- `/metta-status` — current change status
- `/metta-progress` — project-level dashboard across all changes
- `/metta-next` — route to the next logical step in the workflow

### Organization skills
- `/metta-issue <description>` — log an issue
- `/metta-fix-issues <slug>` — resolve one or more logged issues
- `/metta-backlog` — manage backlog items

### Spec management skills
- `/metta-import` — analyze existing code and generate specs with gap reports
- `/metta-fix-gap` — resolve reconciliation gaps through the change lifecycle
- `/metta-check-constitution` — check a change against the project constitution

### Setup skills
- `/metta-init` — initialize Metta in a project (interactive discovery)
- `/metta-refresh` — regenerate CLAUDE.md from constitution and specs
<!-- metta:workflow-end -->

<!-- metta:specs-start source:spec/specs/ -->
## Active Specs

| Capability | Requirements |
|------------|-------------|
| adaptive-workflow-tier-selection | 109 |
| artifact-store | 19 |
| ci-test-infrastructure | 12 |
| claude-statusline | 49 |
| config-loader | 59 |
| config-writer | 38 |
| constitution-check | 17 |
| context-engine | 78 |
| finalize-ship | 181 |
| fix-issues-command | 26 |
| gate-runner | 10 |
| install-init | 39 |
| instruction-contracts | 44 |
| issue-logging | 40 |
| orchestration-guard | 46 |
| propose-stop-after | 71 |
| release-versioning | 47 |
| roadmap-feature | 73 |
| schemas | 126 |
| spec-model | 26 |
| state-store | 73 |
| uat-execution | 46 |
| user-stories | 42 |
| workflow-engine | 46 |
| workflow-parallelism-discipline | 37 |
<!-- metta:specs-end -->

<!-- metta:reference-start -->
## Table of Contents

| Resource | Path | Description |
|----------|------|-------------|
| [Constitution](spec/project.md) | `spec/project.md` | Project principles, stack, conventions, constraints |
| [Active Specs](spec/specs/) | `spec/specs/` | Living specifications per capability |
| [Active Changes](spec/changes/) | `spec/changes/` | Work in flight |
| [Archive](spec/archive/) | `spec/archive/` | Completed changes with artifacts |
| [Gaps](spec/gaps/) | `spec/gaps/` | Reconciliation gaps (spec vs code) |
| [Issues](spec/issues/) | `spec/issues/` | Logged issues and backlog items (backlog is a frontmatter view) |
| [Milestones](spec/milestones/) | `spec/milestones/` | Milestone groupings for backlog items |
| [Architecture](docs/architecture.md) | `docs/architecture.md` | System design and components |
| [API Reference](docs/api.md) | `docs/api.md` | Capabilities and scenarios |
| [Changelog](docs/changelog.md) | `docs/changelog.md` | What changed and when |
| [Getting Started](docs/getting-started.md) | `docs/getting-started.md` | Setup and quick start |
<!-- metta:reference-end -->
