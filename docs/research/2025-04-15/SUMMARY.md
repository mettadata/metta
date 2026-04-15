# Reference Research Summary — 2025-04-15

Six reference projects compared against metta (v0.1). Individual deep-dives in this directory:
- `bmad-method.md` — BMAD-METHOD v6.3
- `openspec.md` — OpenSpec
- `claude-task-master.md` — claude-task-master (multi-provider task mgmt)
- `get-shit-done.md` — GSD (the tool metta's maintainer migrated from)
- `how-to-ralph-wiggum.md` — Ralph playbook (methodology, not tool)
- `spec-kit.md` — spec-kit (Python SDD toolkit)

## Where metta already leads

| Dimension | vs GSD | vs spec-kit | vs Ralph | vs task-master | vs BMAD | vs OpenSpec |
|---|---|---|---|---|---|---|
| Type-safe state (Zod) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delta-spec + content hash | ✓ | ✓ | ✓ | ✓ | ✓ | ~ |
| Git worktree isolation + HEAD-advance detection | ✓ (fix for GSD bug) | ✓ | ✓ | ✓ | ~ | ✓ |
| Composable DAG workflows | ✓ | ✓ | ✓ | ✓ | ~ | ~ |
| Parallel review/verify fan-out | ✓ | ✓ | ~ | ✓ | ~ | ✓ |
| Discovery gate (now iterative) | ✓ | ~ | ✓ | ✓ | ~ | ✓ |
| Pluggable quality gates | ✓ | ~ | ✓ | ✓ | ~ | ~ |

## Where metta trails — cross-cutting improvement themes

These appear across 2+ reference projects and represent the highest-leverage additions:

### T1. Multi-provider / multi-tool support
**Sources:** claude-task-master (15+ providers), spec-kit (multi-agent integrations), GSD (10+ runtimes), BMAD (modular ecosystem).
**Current metta:** Anthropic SDK only; Claude Code adapter only.
**Recommendation:** Provider registry + ToolAdapter pattern. Pluggable factory for OpenAI, Gemini, Perplexity, Ollama. Tool adapters for OpenCode, Cursor, Copilot, Windsurf with installer-time file transformation (GSD pattern).
**Impact:** Unblocks users on different AI budgets/regions; doubles addressable audience.

### T2. MCP server with tiered tool loading
**Sources:** claude-task-master (42+ tools, 3 tiers), spec-kit (multi-agent via extensions).
**Current metta:** CLI + skill markdown only.
**Recommendation:** `mcp-server.ts` exposing core (propose/plan/execute/ship), standard (+ verify/finalize), all (+ gates/research/backlog). Enables native VS Code / Cursor integration without CLI bridging.
**Impact:** Reduces context window bloat via lazy tool schemas; enables editor-native UX.

### T3. Constitutional gates in planning
**Sources:** spec-kit (9 constitutional articles enforced via templates), BMAD (checkpoint preview, adversarial review).
**Current metta:** `spec/project.md` exists but is advisory; no gate verifies specs comply during planning.
**Recommendation:** Zod schema checks in plan phase; fail fast when complexity/architectural principles violated; require justification in "Complexity Tracking" section.
**Impact:** Architectural discipline becomes enforceable, not aspirational.

### T4. Research-model tier
**Sources:** claude-task-master (Perplexity integration), Ralph (backpressure discipline).
**Current metta:** Single model family (Anthropic) per phase.
**Recommendation:** Split providers into main (reasoning) vs. research (grounding). Use research model during discovery/architecture to fact-check stack choices, best practices, API breaking changes. Auto-fetch into research artifacts.
**Impact:** Grounds specs in current reality, reduces guess-driven design.

### T5. User-story layer on top of requirements
**Sources:** spec-kit (user stories with P1-P3), BMAD (PRFAQ, Product Brief paths).
**Current metta:** RFC 2119 requirement→scenario hierarchy is technical, not product-oriented.
**Recommendation:** Optional user-story format (Given/When/Then, P1-P3, independent test criteria) with `[REQUIREMENT: name]` markers for system-level must-haves. Trace code to business value.
**Impact:** Better product/engineering alignment; non-technical stakeholders can read specs.

### T6. Per-phase context budgeting (formalized + adaptive)
**Sources:** Ralph (context efficiency as core discipline), GSD (fresh context per agent).
**Current metta:** Context engine exists but budgets aren't enforced per phase.
**Recommendation:** Discovery 50K, research 80K, planning 100K, execution 150K per executor, verification 120K. Section filtering strategies (skeleton/section/full). `metta context stats` showing "65% of smart zone, consider fan-out."
**Impact:** Prevents context rot; surfaces when to fan-out or split phases.

### T7. Lightweight loop mode
**Sources:** Ralph (bash + IMPLEMENTATION_PLAN.md), GSD (fresh agent per task).
**Current metta:** Full workflow always; no bare-bones loop.
**Recommendation:** `metta loop [plan|build]` — minimal ceremony: feed prompt, persist state via IMPLEMENTATION_PLAN.md, restart on completion. Under 50 lines.
**Impact:** Operators can trade ceremony for speed on trivial fixes.

### T8. Post-merge gate re-run
**Sources:** GSD (post-merge verification stubbed — the bug that cost the user work).
**Current metta:** Finalize runs gates before archive; ship verifies base drift.
**Recommendation:** After `metta ship` merges to main, re-run lint/test/typecheck against merged state. Catch "resolved" merge conflicts that broke the build. Store post-merge gate results in archive for post-mortem.
**Impact:** Hardens against silent regressions from mid-ship state drift.

### T9. Multi-agent extension / plugin system
**Sources:** BMAD (modular ecosystem), spec-kit (integration subpackages), OpenSpec (schema-driven workflows).
**Current metta:** Agents + skills hardcoded in `src/templates/`.
**Recommendation:** Plugin manifest format + registry; allow third-party tool-specific commands/agents to ship as separate packages.
**Impact:** Community can extend without forking.

## Prioritization

Ranked by impact × effort:

1. **T2 (MCP server)** — high impact, medium effort, well-defined surface area (task-master has a template to copy).
2. **T8 (post-merge gate re-run)** — hardens the critical path that originally motivated metta's existence. Low effort.
3. **T4 (research-model tier)** — huge quality win, medium effort. Perplexity integration is localized.
4. **T1 (multi-provider)** — unblocks audience; medium effort. Starts with provider interface, add 1-2 providers.
5. **T6 (context budgeting)** — existing infrastructure partial; formalize + surface via `metta context stats`.
6. **T3 (constitutional gates)** — principled but requires designing the enforcement language.
7. **T5 (user-story layer)** — spec format evolution; requires migration path for existing specs.
8. **T7 (loop mode)** — small cute feature; tertiary.
9. **T9 (plugin system)** — major architectural surface; defer until v0.3+.

## Non-improvements

Things reference projects do that metta explicitly should NOT adopt:
- GSD's rigid phase model (we already have composable DAGs)
- spec-kit's linear phase dependency (we have parallelism)
- claude-task-master's JSON-file state with no transactions (we have Zod + git)
- Ralph's manual ceremony (we have automation)
- BMAD's enterprise ceremony overhead on small changes (we have quick-mode)

## Next step

Recommend starting with **T2 (MCP server)** and **T8 (post-merge gate)** as independent metta changes. Both have tight scope and high leverage. After shipping, reassess remaining themes based on observed usage.
