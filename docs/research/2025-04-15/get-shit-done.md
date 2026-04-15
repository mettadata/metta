# get-shit-done (GSD) vs metta

## 1. What is get-shit-done?

GSD is a lightweight meta-prompting framework solving "context rot" — quality degradation as Claude fills its context window. Markdown-based workflows + Node.js CLI utilities spanning 10+ runtimes (Claude Code, OpenCode, Kilo, Gemini, Codex, Copilot, Cursor, Windsurf). Core model: fresh context per agent, file-based state in `.planning/`, 69 slash commands bootstrapping 68 workflows orchestrating 24 specialized agents. Architecture: Commands → Workflows (spawn agents) → CLI tools (`gsd-tools.cjs`) → 35 reference documents + templates. The `gsd-*` slash commands visible in metta's skill list (gsd-executor, gsd-planner, etc.) confirm GSD is the source of that family.

**Philosophy:** No enterprise theater — specs as context engineering, fresh agents for isolation, state as living memory. Phases (01-phase, 02-phase, …) form a roadmap; execution happens wave-by-wave with atomic commits per task.

**Stack:** Markdown + Node.js CommonJS, YAML state, 68 phase workflows, defense-in-depth gates (plan-checker, verifier, UAT).

## 2. Metta Context

Metta is TypeScript-only, spec-driven. Core innovation: **composable, DAG-based workflows** replacing GSD's rigid phase pipeline. State validated on every read/write (Zod). Specs are living documents with delta operations (ADDED/MODIFIED/REMOVED) and requirement-level conflict detection. Key safety: **git worktree isolation with `HeadAdvancedError` detection** (`src/execution/worktree-manager.ts:9-22, 85-105`). When HEAD advances during parallel execution, rebase is attempted; if it fails, merge is aborted rather than silently overwriting changes. Metta tracks `baseCommit` per worktree and verifies before merge.

User migrated from GSD to metta because GSD's merge strategy caused lost work — this is the motivating history.

## 3. Strengths of GSD

- **Multi-runtime abstraction** — 10+ AI coding tools supported through installer-time file transformation. No vendor lock-in.
- **Fresh context isolation** — Every spawned agent gets a clean 200K window (1M for opus); eliminates context degradation.
- **Comprehensive reference docs** — 35 refs cover model-profiles, verification patterns, thinking models, gates, user profiling, TDD. Modular planner decomposition keeps files under 50K for constrained runtimes.
- **Parallel commit safety** — STATE.md locking via `O_EXCL` atomic creation with stale-lock detection (10s timeout) prevents read-modify-write races in parallel executors.
- **Defense-in-depth verification** — 4-tier gates (Confirm, Quality, Safety, Transition) with post-execution loop (max 3 iterations) and UAT as human gate.

## 4. Weaknesses of GSD

- **Merge safety gap (critical)** — Post-merge gate re-run is stubbed ("basic verification works"). No `HeadAdvancedError` equivalent. When HEAD advances during phase execution, GSD has no detect/rebase mechanism. This is the bug that caused the user to lose work and motivated the metta migration.
- **Rigid phase model** — Hardcoded decimal numbering (01-01-PLAN.md). Phases must complete sequentially; parallel workstream support requires external `.planning/threads/` coordination. No dynamic DAG composition.
- **Spec merging undefined** — No requirement-level conflict detection. When multiple phases modify the same REQUIREMENTS.md section, merge resolution is manual.
- **Lost work on minor updates** — Since v1.17, locally modified GSD files backed up to `gsd-local-patches/`, requiring manual `/gsd-reapply-patches` post-update. Verification exists but conflicts still need manual resolution.
- **File-based context, no budgeting** — No per-phase token budgeting. All agents read full PROJECT.md, STATE.md, REQUIREMENTS.md. Long-lived projects bloat context.

## 5. Comparison: Phase Model vs Change Model

| Aspect | GSD (Phase-based) | Metta (Change-based) |
|---|---|---|
| Entry | `/gsd-new-project` creates ROADMAP with phases | `metta propose <desc>` creates Change |
| Planning | Phases (01-research, 02-architecture, 03-implement) | Workflows (quick/standard/full) with DAG nodes |
| Parallelism | Sequential phases; waves within execute; workstreams ad-hoc | Full DAG composition; custom workflows define parallelism |
| State | STATE.md (project-wide) + per-phase CONTEXT.md | `spec/changes/*/state.yaml` per-change + specs store (requirement-level versioning) |
| Spec evolution | Manual merge on multi-phase edits | Delta operations with requirement-level conflict detection |
| Merge safety | File locking only; no HEAD-advance detection | Worktree per task, `baseCommit` verification, automatic rebase + abort on conflict |
| Context | Fresh 200K window per agent | Token budget calculated per phase; context engine loads only needed sections |

## 6. Recommended Improvements for Metta

1. **Merge safety gates (PR/finalize)** — Before finalizing, `git diff --stat main HEAD` in worktree. If any file modified by this change was also modified by a parallel change merged to main, require explicit conflict resolution (3-way merge review). Hardens against silent data loss.
2. **Per-phase context budgeting formalized** — Discovery (max 50K), research (80K), planning (100K), execution (150K per executor), verification (120K). Implement context-engine section filtering (skeleton/section/full) per phase. Profile actual consumption and surface warnings.
3. **Multi-tool delivery adapter pattern** — Generalize Claude Code skill delivery. Create `ToolAdapter` interface: `adapt(skillDef, toolName) → transformedDef`. Implement OpenCode, Cursor, Copilot adapters (tool name mapping, hook event names, path conventions). Leverage GSD's installer pattern.
4. **Thinking-model integration gateway** — Expose provider config with thinking cost thresholds. Let agents opt-in to thinking models for complex phases (research, verification). GSD's `thinking-models-*.md` refs show this is valuable.
5. **Plan-level conflict detection** — When parallel plans touch the same files, detect and surface via execution-engine. Add `conflictsWith` field to Plan schema. Fail planning if unresolved conflicts exist.
6. **State reconciliation loop (metta fix-gap)** — Systematize the gap-fixing workflow. When a spec is modified out-of-band, capture the delta and offer auto-reconciliation: merge-base 3-way (spec v0, spec v1, live code).
7. **Finalize gate: post-merge re-run** — After ship merges to main, re-run lint/test/typecheck gates against merged state. Store post-merge gate results in archive for post-mortem.

---

**Conclusion:** Metta's explicit `HeadAdvancedError` detection and rebase-on-merge logic directly address GSD's merge safety gap. The change-based model and spec versioning enable concurrent safety that GSD's phase model lacks. Recommended improvements focus on hardening finalize gates, multi-tool delivery, and thinking-model awareness — borrowing GSD's best patterns for production-grade safety.
