# how-to-ralph-wiggum vs metta

## 1. What is how-to-ralph-wiggum?

Not a tool — an **AI-native workflow playbook** articulating Geoffrey Huntley's "Ralph" methodology for autonomous AI-driven development. A methodological guide, not a framework managing state. Documents three phases (requirements definition, planning, building), two prompt modes (PLANNING via gap analysis, BUILDING via implementation), and one outer loop: a simple bash script that restarts Claude repeatedly, with an `IMPLEMENTATION_PLAN.md` file persisting on disk as shared state between iterations.

**Philosophy:** Context is everything; subagents fan out work to keep main context "smart zone" at 100%; backpressure (tests, lints, builds) steer agent behavior; operators observe failure patterns and tune prompts reactively rather than prescribing upfront.

**Stack:** Markdown specs, bash loops, Claude CLI with subagents (Sonnet for parallelizable work, Opus for complex reasoning), git-based persistence.

## 2. Metta Context

Metta is a spec-driven framework CLI orchestrating the full change lifecycle: propose → plan → execute → verify → finalize → ship. Works with any AI tool via instruction mode. Ceremony scales with complexity (quick mode for bugs, full ceremony for complex features). Composable DAGs, delta-based spec evolution with requirement-level conflict detection, pluggable quality gates, context budgeting per phase, parallel fan-out (research, review, verification).

## 3. Strengths of Ralph

1. **Extreme context efficiency** — Ralph's loop (one task per fresh context, deterministic file-based state) optimized for token budgeting at scale. Bash loop + persistent IMPLEMENTATION_PLAN.md is a near-zero-overhead orchestration pattern.
2. **Tuning culture** — Explicitly embraces reactivity: watch Ralph fail, add guardrails (prompt tweaks, code patterns, AGENTS.md operational learnings), repeat. Iterative prompt refinement baked in.
3. **Subagent parallelization** — Explicit guidance on fan-out (up to 500 Sonnet subagents for search/read, 1 for build/test) and role-based agent selection gives operators fine-grained control.
4. **Minimal ceremony for small tasks** — Single bash loop with two prompt modes is trivial to understand and adapt. No complex state machines, no mandatory discovery gates.
5. **Backpressure as first-class control** — Tests, typechecks, lints, builds treated as steering mechanisms, not post-hoc validation. AGENTS.md wires project-specific validation commands; build prompt includes guardrails ("keep trying until tests pass").

## 4. Weaknesses of Ralph

1. **No state machine / formal lifecycle** — Ralph is a pattern, not a framework. No first-class notion of "change" ownership, concurrent change safety, collision detection, or formal transitions.
2. **Manual ceremony** — Operator must manually orchestrate phases, run plan loop, run build loop, decide when to stop. No `metta auto <description>` equivalent — just a loop.sh.
3. **Prompt tuning burden** — Effectiveness depends on hand-crafted PROMPT_plan.md, PROMPT_build.md, AGENTS.md that must be evolved through observation. High-friction for teams without deep Claude literacy.
4. **Limited spec evolution** — Static requirement documents. No delta-based merging, no requirement-level conflict detection, no version-aware reconciliation.
5. **No standardized output artifacts** — Operator must invent tracking for planning decisions, research outcomes, verification results. Metta's artifact store and archive solve this.
6. **Git safety is manual** — Relies on operator to push after each iteration. No worktree isolation, branch-per-change safety, or atomic archive.

## 5. Comparison Matrix

| Dimension | Ralph Playbook | Metta |
|---|---|---|
| Type | Methodology / playbook | Framework / CLI tool |
| State | File-based (IMPLEMENTATION_PLAN.md) | Zod-validated YAML state store |
| Lifecycle | Manual bash loop orchestration | Formal DAG workflows |
| Spec evolution | Static requirement docs | Delta-based with requirement-level conflict detection |
| Change isolation | Manual git branches | Branch-per-change, worktree isolation, atomic archive |
| Artifact tracking | None (outputs scattered) | First-class artifact store with checklist tasks |
| Quality gates | Backpressure via AGENTS.md commands | Pluggable gate registry, runs during finalize |
| Discovery | Optional LLM conversation | Mandatory orchestrator-driven questioning (iterative loop now) |
| Parallel execution | Fan-out subagents within one loop | Parallel research (2-4), review (3x), verification (3x) across phases |
| Context budgeting | One task per loop (implicit) | Explicit token-aware budgeting, per-phase strategies |
| Multi-tool support | Claude CLI (extensible) | Generic adapter interface (only Claude Code implemented) |
| Team features | None (single operator) | Change ownership, concurrent change locking |

## 6. Recommended Improvements for Metta (Inspired by Ralph)

1. **Lightweight loop mode** (`metta loop [plan|build]`) — Add a "raw loop" command implementing Ralph's simple bash pattern: feed a prompt, persist state via IMPLEMENTATION_PLAN.md, restart on completion. Minimal-ceremony execution for operators who want Ralph's simplicity without full ceremony. Under 50 lines; reuse existing prompt/spec loaders.
2. **Explicit subagent fan-out guidance** — Enhance execution-engine docs and templates to expose parallelization patterns from Ralph (e.g., "up to 500 Sonnet subagents for search, 1 for build/test"). Add helper utilities or prompt snippets.
3. **Prompt tuning / observation loop** — Add lightweight `metta tune` command (or section in `metta doctor`) that logs failure patterns (prompt rejections, gate failures, spec inconsistencies) and suggests reactive fixes.
4. **IMPLEMENTATION_PLAN.md auto-generation** — Enhance context engine to always generate this file during planning. Make it a first-class artifact with standardized format. Reuse spec-to-task derivation.
5. **Backpressure registry expansion** — Richer gate definitions with priority (critical, high, low) and loopback semantics (should we re-execute on failure, or just report?). Make custom gates easy to add without forking.
6. **Spec stability warnings** — Detect when specs change mid-flight (e.g., updated after plan phase started). Emit warning suggesting plan regeneration: "if plan feels stale, regenerate — it's cheap."
7. **Context efficiency report** — Expose token utilization per phase. `metta context stats` shows "you're at 65% of smart zone, consider fan-out" or "95%, consider splitting." Makes token budgeting visible and actionable.

---

**Summary:** Ralph is a methodology for low-ceremony, high-efficiency autonomous AI development optimized for context budgeting and iterative tuning. Metta is a framework for spec-driven development with formal lifecycle management, artifact tracking, and team-safe concurrency. Ralph excels at simplicity and prompt responsiveness; metta excels at scaling, safety, and standardization. Recommended improvements blend Ralph's lightweight orchestration, tuning culture, and backpressure discipline into metta's formal framework — giving operators flexibility between minimalist loops and full-ceremony workflows.
