# Research Synthesis: fix-metta-guard-edit-still-false-positive-blocks-subagent

Three approaches evaluated in parallel (see `research-two-root-probe.md`, `research-bidirectional-discovery.md`, `research-canonical-state-hosting.md`). All three researchers reproduced or traced the defect against the consumer-shaped fixture; findings below are empirically grounded, not speculative.

## Option 1 — Hook-level two-root probe (score 8/10)

Prototype validated against the real CLI. Three formulations:
- **V1a (unbounded either-allows)** — rejected: would newly allow edits into unrelated metta checkouts.
- **V1b (containment-bounded two-probe)** — second probe of the session root only when the target lies under `<sessionRoot>/.metta/worktrees/`; fixes inverted topology, preserves blocks, ~500ms added latency on the would-block path.
- **V1c (host-derived single probe)** — derive the hosting root from the target path (the checkout whose `.metta/worktrees/` contains the target) and probe that root once. Load-bearing verified fact: a main root's `metta status` aggregates worktree-hosted change state, so the hosting root's answer is a strict superset of the worktree root's. Covers both topologies, zero added latency, no dependence on `process.cwd()`.

Rollout: template + `.claude` mirror (byte-identity test enforces sync), `copy-templates` handles dist. Effort ~0.5-1 day. Note: V1c decides on the *hosting* root rather than literally "the session's checkout root" — spec wording accommodates this since visibility from the hosting root implies visibility from the session root in the reproduced topology.

## Option 2 — Bidirectional CLI discovery (score 7/10)

The durable root-cause fix: a sync `resolveWorktreeParent` (gitdir-pointer parse, containment-guarded, no subprocess) feeding a `parentSpecDir` option on `ArtifactStore`; requires a symmetric `resolveChangeRoot` companion change. Zero hook changes; also fixes `metta instructions`/`tokens record` from worktree cwds. Risks: write-side blast radius across all 37 CLI commands (state writes from worktree processes, git-commit-cwd sites need auditing), 2-3 days effort. Safest allow-surface but disproportionate for the hotfix.

## Option 3 — Canonical state hosting (score 3/10 standalone)

Decisively rejected as the primary fix: state is *already* worktree-hosted at creation on current code (since 2026-07-25); the inverted topology arises from legacy/older-CLI changes, a quick-fallback re-run edge, or worktree loss during the untracked window. Option 3 can only prevent or heal the topology — it cannot allow within it, so the spec's GIVEN-inverted acceptance scenarios are unsatisfiable under this option alone, and healing consumers requires a CLI upgrade rather than a hook refresh. Its "Part A" (creation-time scoped commit of change state, ~0.5 day) is cheap hardening worth considering as a follow-up, not part of this change.

## Test strategy (all options, mandated by spec R6)

PATH shim that `exec`s the real CLI (`npx tsx src/cli/index.ts "$@"`, pattern already in `tests/helpers/cli.ts`) replacing the cwd-answering shim for the inverted-topology suite; the inverted-topology test demonstrably fails against the pre-fix hook. No `.metta/config.yaml` needed in fixtures.

## Recommendation

**Option 1, V1c formulation** (host-derived probe root, containment-bounded), with V1b as the literal-spec fallback if design review prefers the two-probe reading of the requirement. Rationale: fixes the reproduced production defect with a hook-only change, zero added latency, no CLI blast radius, consumers heal via hook refresh alone, and the widened allow-surface is bounded to metta-managed worktrees of the probed checkout. Pair with the real-CLI regression suite closing the shim blind spot. Option 2 remains the right long-term direction if worktree-cwd CLI ergonomics become a goal; log it as a backlog candidate rather than folding it in here.
