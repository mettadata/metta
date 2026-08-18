# Research: fix-guard-edit-worktree-write-friction-caused-cross-repo

## Decision: Three-layer defense-in-depth — template path discipline (prevent), guard-bash write-target blocking (block), main-checkout tree-clean verification (detect)

All three layers were researched in parallel and are complementary, not alternatives.
Per-approach detail lives in:

- [research-template-path-discipline.md](research-template-path-discipline.md) — layer 1 (soft prevention)
- [research-guard-bash-write-target.md](research-guard-bash-write-target.md) — layer 2 (hard blocking)
- [research-tree-clean-baseline.md](research-tree-clean-baseline.md) — layer 3 (detection/attribution)

### Approaches Considered

1. **Layer 1 — Persona-primary path discipline (Option A, selected)** — Full shell-write
   path discipline plus a new Deviation Rule 6 (STOP on silent-write anomaly, never a
   bash rewrite) in the executor and verifier personas; full spawn-contract + escalation
   text in `metta-execute/SKILL.md`; one identical escalation sentence in the six other
   executor-dispatching skills (`quick`, `auto`, `fix-issues`, `fix-gap`, `propose`,
   `verify`). Write verification piggybacks on the existing per-task
   `git -C "{change_root}" status/commit` step plus on-suspicion `grep`/`cat` — no
   mandatory per-edit re-Reads. The verifier's sanctioned heredoc fallback is scoped
   *additively* to explicit refusals only (preserving the three strings pinned by
   `tests/agents-byte-identity.test.ts:23-27`). Every `src/templates/` edit lands in its
   byte-identical `.claude/` twin (`tests/template-deploy-sync.test.ts` gate); `dist/`
   regenerates via `copy-templates`. Rejected alternatives: minimum-compliance edits to
   only 3 files (leaves quick/auto/fix-issues loops — the actual incident shape —
   uninstructed), and duplicating the full contract into every skill (wording drift, no
   marginal safety).

2. **Layer 2 — Guard-bash write-target extraction E1 + target-anchored topology T1
   (selected)** — A regex/token extractor built on guard-bash's existing
   `computeQuoteMask`/`splitCommandSegments`, gated by a confidence predicate: only
   plain-text absolute targets from `>`/`>>` (incl. fd-prefixed), `tee`, `cp`/`mv` are
   checked; heredocs need no special logic (their file write is the `>` redirection —
   the exact zeus shape). Topology resolves target-anchored via the guard-edit pattern:
   `toPhysicalPath` → `git rev-parse --show-toplevel` → `deriveProbeRoot` → one cached
   `metta status --json` probe whose `worktree` field yields both worktree root and
   hosted-status. Block iff target is inside the hosting root, outside the worktree, and
   outside the `<H>/.metta/` shared allow set; placement *before* the offender scan so
   blocked writes never act as Tier-2 credential keepalives; whole check wrapped in
   try/catch fail-open. Byte-identical mirror to `src/templates/hooks/metta-guard-bash.mjs`
   (existing byte-identity test enforces it). Tests stay black-box spawn with a
   PATH-shimmed `metta` (guard-edit fixture pattern). Rejected: a real shell-word parser
   (~300+ lines rescuing only cases the spec mandates fail-open), a third-party AST
   package (hooks are dependency-free by contract), and cwd-anchored path math (misses
   the incident shape — zeus ran with cwd = main checkout).

3. **Layer 3 — Tree-clean baseline in `.metta/scratch/` + gates at complete and ship
   (selected)** — New `src/util/git-tree-baseline.ts` (pure `parsePorcelain` with
   `--porcelain=v1 -z`, pure `diffTreeState`) + strict `MainTreeBaselineSchema`
   (`src/schemas/tree-baseline.ts`, barrel-exported), storing the baseline at
   `<mainRoot>/.metta/scratch/tree-baselines/<change>.yaml` via a `StateStore` rooted at
   the main checkout. Capture is write-once inside the existing best-effort
   `started`-stamp block in `instructions.ts:140-189`; compare runs as a pre-`markArtifact`
   gate in `complete.ts` (before line 230; `MainTreeContaminationError`, exit 4, JSON
   `type: 'main_tree_contamination'`, new-dirt-only listing, warn-and-pass when no
   baseline) and as a caller-fed `main-checkout-clean` step in `MergeSafetyPipeline`
   emitted only for worktree-hosted ships. A `resolveMainCheckoutRoot` helper (metadata
   worktree field, else path-math with `git rev-parse --git-common-dir` fallback) covers
   both invocation topologies and disengages cleanly under `git.enabled: false` or
   worktree-fallback mode. Rejected storage options: the git-tracked `.metta.yaml`
   (machine-specific paths would enter repo history — contradicts
   `artifact-store.ts:139-165` precedent), `spec/changes/<change>/` files (same), and the
   global `state.yaml` (contention, migration risk).

### Rationale

- Each layer covers the others' documented residuals: layer 2's fail-open set
  (interpreters, `$VAR` targets, relative paths) is caught by layer 3's tree diff;
  layer 3's `--untracked-files=no` blind spot (new-file creation) is caught by layer 2's
  write-target block; both hard layers backstop layer 1's soft instructions — and
  layer 1 is the only layer that addresses the root behavioral failure (the bash
  fallback habit on silent-write anomalies).
- The combined design would have blocked or flagged both zeus incident writes at three
  independent points, while every legitimate write class observed in the repo's own
  workflows (worktree writes, `.metta/scratch`, `/tmp`, non-write commands, main-hosted
  changes) passes untouched.
- Every piece rides an existing proven pattern in this codebase: guard-edit's topology
  resolution, guard-bash's quote-mask utilities and audit log, StateStore Zod
  round-trips, the pre-complete gate placement, the `MergeSafetyStep` result shape, and
  the byte-identity template gates.

### Cross-cutting facts for design/planning

- Template ↔ deployed byte-identity is a hard test gate (`template-deploy-sync.test.ts`,
  guard-bash test line 1206): every template edit must land in its `.claude/` twin in the
  same change; `dist/` needs no manual edits.
- Hooks are standalone dependency-free `.mjs` with no exports; the only test pattern is
  black-box `spawnSync` — the ~60 lines of topology code ported from guard-edit into
  guard-bash are comment-annotated duplication by design.
- `metta status --json` at the hosting checkout is the stable public contract for
  worktree facts (`worktree` field, `change-metadata.ts:117`).
- Accepted residuals (documented, compensated): shell wrappers/interpreters invisible to
  extraction; relative-path writes with a main cwd; untracked new files invisible to
  `-uno` porcelain; instructions are soft enforcement.
- Follow-up issue to log (not in scope): reviewer/specifier/uat-runner path-anchoring
  parity (`metta-reviewer.md:23` writes a relative `review.md` path — a lower-severity
  cross-checkout vector).

### Artifacts Produced

- [Research: guard-bash write-target](research-guard-bash-write-target.md)
- [Research: tree-clean baseline](research-tree-clean-baseline.md)
- [Research: template path discipline](research-template-path-discipline.md)
