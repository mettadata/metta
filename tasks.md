# Metta v0.1 — Build Tasks

Scope: Core loop end-to-end (propose/plan/execute/verify/finalize/ship), ideas/issues/backlog, AI-driven discovery. Sequential execution only. Claude Code adapter only. No MCP, no plugins, no parallel execution.

---

## Phase 1: Foundation ✅
> Scaffolding, schemas, state store, config loader, AI provider

- [x] 1.1 Project scaffolding (package.json, tsconfig.json, vitest.config.ts, ESM setup, directory structure)
- [x] 1.2 Zod schemas for all state types (ChangeMetadata, SpecLock, ExecutionState, AutoState, ProjectConfig, GateResult)
- [x] 1.3 State Store (read/write/lock with Zod validation on every operation, advisory file locking)
- [x] 1.4 Config Loader (4-layer resolution: env → local.yaml → project config.yaml → global ~/.metta/config.yaml)
- [x] 1.5 AI Provider interface + Anthropic implementation (generateText, generateObject, streamText)
- [x] 1.6 Phase 1 unit tests (56 tests)

## Phase 2: Workflow Engine + Artifact/Spec Model ✅
> DAG-based workflows, artifact store, spec parsing, ideas/issues/backlog

- [x] 2.1 Workflow definition parser (YAML → typed WorkflowGraph with artifact nodes + dependency edges)
- [x] 2.2 Topological sort (Kahn's algorithm, deterministic tie-breaking, cycle detection)
- [x] 2.3 Workflow Engine (loadWorkflow, getStatus, getNext, markComplete, validate)
- [x] 2.4 Built-in workflow YAML files (quick.yaml, standard.yaml, full.yaml)
- [x] 2.5 Artifact Store (createChange, archive, listChanges, getChange, abandon)
- [x] 2.6 Spec parser (remark/unified AST — parse requirements, scenarios, delta operations)
- [x] 2.7 Spec lock file management (content hashing, version tracking, requirement-level hashes)
- [x] 2.8 Ideas store (create, list, show)
- [x] 2.9 Issues store (create, list, show, severity)
- [x] 2.10 Backlog store (add from idea, list, show, promote to change)
- [x] 2.11 Phase 2 unit tests (102 cumulative)

## Phase 3: Context Engine + Templates + Discovery ✅
> Context resolution, budget enforcement, instruction generation, discovery gate

- [x] 3.1 Token counter (4 chars ≈ 1 token character estimator)
- [x] 3.2 Context manifests (per-artifact type: required/optional sources, budgets)
- [x] 3.3 Context Engine (resolve, load, budget, truncate, extract sections)
- [x] 3.4 Loading strategies (full load, section extraction, heading skeleton, delta-only)
- [x] 3.5 Freshness markers (content hash + timestamp on loaded context)
- [x] 3.6 Artifact templates (intent.md, spec.md, research.md, design.md, tasks.md, execute.md, verify.md)
- [x] 3.7 Template engine (placeholder substitution from change metadata + project context)
- [x] 3.8 Instruction generator (`metta instructions <artifact> --json` output builder)
- [x] 3.9 Discovery gate (completeness checker — scenarios, TODO markers, RFC 2119 keywords, edge cases)
- [x] 3.10 Phase 3 unit tests (132 cumulative)

## Phase 4: Execution Engine + Gates ✅
> Sequential batch execution, backpressure gates, deviation rules, provider resilience

- [x] 4.1 Batch planner (group tasks by dependencies, detect file overlap, generate BatchPlan)
- [x] 4.2 Gate registry (load gate definitions from YAML, run gates, collect typed GateResult)
- [x] 4.3 Built-in gate definitions (tests.yaml, lint.yaml, typecheck.yaml, build.yaml)
- [x] 4.4 Gate runner (execute gate command, parse output, handle timeout, on_failure behavior)
- [x] 4.5 Execution engine — sequential mode (iterate batches → tasks → gates, update state)
- [x] 4.6 Deviation rules (auto-fix bugs, add missing pieces, fix blockers, stop for architecture)
- [x] 4.7 Deviation logging (track in task summary with rule, description, commit, files)
- [x] 4.8 Provider resilience (retry policy, rate limit handling, garbage detection)
- [x] 4.9 Execution state tracking (batch/task status, commits, gate results in state.yaml)
- [x] 4.10 Session recovery (`--resume` from last checkpoint)
- [x] 4.11 Phase 4 unit tests (156 cumulative)

## Phase 5: CLI + Command Delivery ✅
> Commander.js CLI, all commands, Claude Code adapter, interactive discovery

- [x] 5.1 CLI entry point + Commander.js setup (global options: --json, --verbose, --debug, --quiet)
- [x] 5.2 `metta init` command (greenfield detection, interactive discovery, constitution generation)
- [x] 5.3 `metta propose` command (create change, select workflow, run discovery, generate intent+spec)
- [x] 5.4 `metta quick` command (lightweight discovery, intent → execute → verify)
- [x] 5.5 `metta plan` command (build next planning artifacts: design, tasks)
- [x] 5.6 `metta execute` command (run sequential execution engine, --resume support)
- [x] 5.7 `metta verify` command (run all gates, spec-compliance check)
- [x] 5.8 `metta status` command (current change status, --json output)
- [x] 5.9 `metta instructions` command (generate AI instructions for artifact, --json)
- [x] 5.10 `metta answer` command (submit user answers to discovery questions)
- [x] 5.11 `metta specs` subcommands (list, show, diff, history, review, approve)
- [x] 5.12 `metta idea` / `metta ideas` commands (capture, list, show)
- [x] 5.13 `metta issue` / `metta issues` commands (capture, list, show, severity)
- [x] 5.14 `metta changes` subcommands (list, show, abandon)
- [x] 5.15 `metta backlog` subcommands (list, show, add, promote)
- [x] 5.16 `metta config` subcommands (get, set, edit)
- [x] 5.17 `metta gate` subcommands (run, list, show)
- [x] 5.18 `metta context` subcommands (stats, check)
- [x] 5.19 `metta doctor` command (health checks)
- [x] 5.20 `metta refresh` command (regenerate derived files)
- [x] 5.21 Tool adapter interface + Claude Code adapter (detect, formatSkill, formatCommand, formatContext)
- [x] 5.22 Command delivery (generate slash commands/skills for detected AI tools)
- [x] 5.23 Exit codes (0-5 per spec)
- [x] 5.24 Shell completion (bash, zsh, fish) — deferred to post-v0.1
- [x] 5.25 Phase 5 unit tests (174 cumulative)

## Phase 6: Finalize + Ship ✅
> Archive, spec merge, conflict detection, doc generation, context refresh, merge safety

- [x] 6.1 `metta finalize` command (archive change, merge delta specs, generate docs, refresh context)
- [x] 6.2 Spec merge algorithm (base version comparison, requirement-level conflict detection)
- [x] 6.3 Conflict resolution (interactive resolution, dry-run preview)
- [x] 6.4 Archive manager (move change to spec/archive/YYYY-MM-DD-<name>/, preserve metadata)
- [x] 6.5 Doc generator (architecture.md, api.md, changelog.md, getting-started.md from specs+designs)
- [x] 6.6 Context refresh (regenerate CLAUDE.md/.cursorrules with section markers, preserve user content)
- [x] 6.7 `metta ship` command (merge safety pipeline — 7 steps: drift check, dry-run merge, scope check, gate verify, snapshot, merge, post-merge gates)
- [x] 6.8 Git integration (worktree management, conventional commits, branch naming, protected branches)
- [x] 6.9 Rollback on post-merge gate failure (reset to snapshot tag, preserve worktree branch)
- [x] 6.10 `metta cleanup` command (orphaned worktrees, old snapshot tags, stale logs)
- [x] 6.11 `metta auto` command (outer loop: propose → plan → execute → verify → gap analysis → re-plan, stall detection, max cycles)
- [x] 6.12 Phase 6 unit tests (185 cumulative)

---

## Post-Build
- [ ] Self-host: run `metta init` inside the Metta repo
- [ ] End-to-end integration test (full propose → ship cycle)
