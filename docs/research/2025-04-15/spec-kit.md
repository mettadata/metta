# spec-kit vs metta

## 1. What is spec-kit?

Spec-Kit (GitHub) is a comprehensive Spec-Driven Development (SDD) toolkit in Python that inverts traditional development: specifications become executable sources of truth that directly generate working code. Iterative refinement through slash commands (`/speckit.specify`, `/speckit.plan`, `/speckit.tasks`) guides users from vague ideas through PRDs, technical plans, and actionable tasks. Enforces architectural principles via a "constitution" of immutable articles (Library-First, Test-First, Integration-First), templates with quality gates, and an extension system supporting multiple AI agents (Claude, Gemini, Copilot, Windsurf). Manages per-feature Git branches with auto-numbering, supports research agents, and uses `[NEEDS CLARIFICATION]` markers to surface ambiguities.

**Stack:** Python (Specify CLI), Markdown templates, YAML config, Git-based versioning, multi-agent integrations.

## 2. Spec Model Comparison

| Aspect | Spec-Kit | Metta |
|---|---|---|
| Format | User stories (Given/When/Then) with priority (P1-P3), independent test criteria | Requirements (RFC 2119: MUST/SHOULD/MAY) + Scenarios (Given/When/Then) |
| Requirement language | Implicit priority in user story value | Explicit RFC 2119 keywords |
| Structuring | Feature spec → plan.md → research.md → data-model.md → tasks.md (5-step expansion) | Spec.md parsed into requirements → spec.lock (versioned snapshot) |
| Versioning | Git branch per feature (auto-numbered 001-name) | Content-hash versioning (sha256:12-hex) + lock files with monotonic version ints |
| Change evolution | New spec/plan files per iteration | Delta specs (ADDED/MODIFIED/REMOVED/RENAMED) with requirement-level conflict detection |
| Templates | LLM constraint enforcement: clarity gates, complexity tracking, assumptions | Type-safe Zod schemas on all state transitions |
| Execution | Phase-based (Phase -1 gates → 0 research → 1 design → 2 tasks) | Composable DAG workflows with topological sort |

## 3. Strengths of Spec-Kit

1. **Constitutional architecture** — Nine immutable articles (Library-First, Test-First, Simplicity, Anti-Abstraction, Integration-First) embedded into plan templates as enforcing gates. Makes principles code-enforceable, not aspirational.
2. **Template-driven LLM guidance** — Templates are sophisticated prompts that constrain LLM output (`[NEEDS CLARIFICATION]` markers, checklist validation, phase gates). Prevents premature implementation, forces explicit uncertainty, enables test-first thinking.
3. **Multi-agent extensibility** — Clean Python integration subpackage architecture; registry-based discovery means new agents plug in without core changes.
4. **Phase-gated workflow** — Sequential phases (research → design → implementation) with constitutional gates at each boundary. Clear progression from ambiguity → research → architecture → testable implementation.
5. **Dynamic feature numbering** — Auto-scans existing specs, derives next feature number (001, 002, …), creates branch and directory structure in one step.

## 4. Weaknesses of Spec-Kit

1. **Linear phase dependency** — Inherent to the methodology; no parallel research streams, independent design alternatives, or non-sequential workflows. Research blocks design blocks implementation.
2. **No delta/conflict detection** — Spec changes rewrite entire docs. No requirement-level versioning; conflicts when agents modify overlapping requirements are manual.
3. **Git branch isolation** — Per-feature branch means long-lived specs during design; no intermediate checkpoint safety for parallel changes.
4. **Loose schema validation** — YAML/TOML with manual validation in extension templates. No runtime Zod-like enforcement; state drift possible. Lock files optional.
5. **Extension coupling** — Extensions tightly coupled to hook events (`after_specify`, `after_tasks`); workflow changes may require rewriting hooks. Opt-in hooks mean extensions can silently skip validation.

## 5. Metta Strengths (vs Spec-Kit)

1. **Composable DAG workflows** — Not locked into linear phases. Three built-ins (quick/standard/full) + custom workflows. Supports parallel research, review (3x), verification (3x).
2. **Delta-based spec evolution** — Content-hash versioning + spec.lock + requirement-level ADDED/MODIFIED/REMOVED enable non-destructive updates with fine-grained conflict detection.
3. **Type-safe state management** — Every read/write validated against Zod schemas; fail-fast on drift. Atomic writes, advisory file locking, stale lock removal.
4. **Context budgeting** — Token-aware context loading per phase and agent. Per-phase strategies (full/section/skeleton) prevent context overflow. Staleness detection on cached context.
5. **Git worktree isolation** — Per-change worktrees (not per-feature branches) enable parallel change safety. Atomic archive on finalize. Auto-commit and merge safety pipeline.

## 6. Metta Weaknesses (vs Spec-Kit)

1. **RFC 2119 overhead** — Explicit MUST/SHOULD/MAY on every requirement adds ceremony. Spec-Kit's implicit priority (P1-P3 per user story) is lighter.
2. **No constitutional enforcement** — While metta has project.md as a constitution, no gates verify specs comply with principles during planning. Architectural discipline is advisory, not enforced.
3. **Limited multi-agent support** — Only Anthropic SDK integrated; no extension system for Gemini, Copilot, Windsurf, Cursor. Designed for multi-tool delivery but only Claude Code adapter exists.
4. **Scenario-centric, not story-centric** — Requirement→scenario hierarchy is technical, not user-story→acceptance-criteria. Harder to trace code back to business value.
5. **Loose template validation** — Artifact templates (YAML) aren't schema-validated at creation time. Tasks, plans, design artifacts can drift from expected structure.

## 7. Recommended Improvements for Metta

1. **Constitutional gates in planning** — Embed Zod schema checks in the planning phase that verify specs comply with project constitution. Fail fast on complexity or architectural violations; require justification in "Complexity Tracking" sections.
2. **User story / value mapping** — Layer user stories with acceptance criteria alongside requirement/scenario structure. Each requirement maps to user-story ID (P1/P2/P3 + value justification). Trace implementation back to business value.
3. **Multi-agent extension system** — Mirror spec-kit's integration architecture: plugin system for any AI tool (Gemini, Copilot, Windsurf, Cursor). TypeScript base class + registry. Tool-specific commands registered via manifest files.
4. **Hybrid spec format: RFC 2119 + user stories** — Reduce RFC 2119 overhead by making it optional. Default to user-story format (Given/When/Then, P1-P3, independent test criteria) with optional `[REQUIREMENT: name]` markers for system-level must-haves.
5. **Automatic lock file + conflict detection** — Enhance spec.lock to track requirement origins (`origin: "user-story-auth-001"`, `modified_by: "executor"`, `modified_at: timestamp`). On delta apply, compute requirement-level conflicts and surface as reconciliation gaps requiring human resolution.
6. **Template schema validation at creation** — Validate artifact templates against Zod schemas when created, not just read. Fail early if `/metta:plan` output doesn't match expected structure. Extend artifact store with schema metadata.
7. **Constitutional justification in archive** — When finalizing, require explicit justification in archive metadata for any deviations from constitutional principles (more than 3 projects, complex abstractions, manual testing where integration was expected). Make architectural decisions auditable.

---

**Verdict:** Spec-kit excels at enforcing architectural discipline through templates and constitutional gates; metta excels at safe, composable workflows with type-safe state and delta evolution. Borrowing spec-kit's constraint-based design philosophy and multi-agent extensibility would make metta more robust for large teams and complex projects.
