# Summary: fix-metta-guard-edit-still-false-positive-blocks-subagent

## What was implemented

Fixed the metta-guard-edit PreToolUse hook false-positively blocking subagent Write/Edit calls into `.metta/worktrees/<change>/` under the inverted-hosting topology (change state in the main checkout, edit target in the worktree) — the production defect reported by the zeus consumer on 2026-08-18.

Approach: research-selected **V1c host-derived probe root** (design ADR-1..5). Three parallel research tracks scored: two-root probe 8/10 (V1c variant selected), bidirectional CLI discovery 7/10 (durable but disproportionate blast radius — backlog candidate), canonical state hosting 3/10 (cannot satisfy the GIVEN-inverted acceptance scenarios).

## Changes by task

- **Task 1.1** (`6f01e7f23`): ADR-4 spec wording — R1/R3 now state the guarantee in terms of the *hosting checkout root* (the checkout whose `.metta/worktrees/` contains the target's checkout), the precise session-cwd-independent formulation.
- **Task 1.2** (`419ce3131`): `deriveProbeRoot(checkoutRoot)` added to `src/templates/hooks/metta-guard-edit.mjs` (+ byte-identical `.claude/hooks` mirror): pure path math — if the target's git toplevel sits at `<H>/.metta/worktrees/<name>`, the `metta status --json` probe runs with `cwd: H` (whose answer is a verified strict superset of the worktree's); otherwise behavior is unchanged. All decision-path logic (outside-root allow, allow-lists, block message, single try/catch fail-open) untouched and still keyed on the target's own root.
- **Task 2.1** (`61694d426`): real-CLI topology regression suite (R6) — delegating PATH shim exec'ing `npx tsx src/cli/index.ts`, 18 new cases across both hook copies: inverted topology (incl. subdirectory-cwd), canonical topology, no-change block, containment bound (unrelated checkout still blocks), and four probe-failure fail-open modes. Red-run demonstrated against the pre-fix hook (inverted cases exit 2 where 0 expected). ADR-5 shim update applied with a recorded Rule-1 deviation: the "active" answer moved into the single test needing it rather than the shared shim (the literal design text broke 3 tests because both worktrees derive the same probe root).
- **Task 3.1**: gates — lint/tests/build all exit 0 (127 files, 2407 tests), template/dist/.claude hook copies byte-identical, tree clean.

## Consumer impact

Consumers heal via hook refresh alone — no CLI upgrade required. Subagent edits inside `.metta/worktrees/<change>/` during an active change are allowed regardless of which checkout hosts the change state; the heredoc fallback workaround is obsolete.

## Verification

### Spec Scenarios

All 6 requirements / 10 scenarios verified with test or commit-documented evidence (`tests/metta-guard-edit.test.ts`, both hook copies):

- [x] R1 inverted topology allows (465-475) + V1c cwd-independence (477-489); empty target-root answer never decides (hook host-probe superset)
- [x] R2 canonical topology still allows (491-501) + legacy case (283-316)
- [x] R3 no state anywhere blocks with `metta-guard` stderr (503-512); ADR-2 containment bound — unrelated checkout still blocks (514-531)
- [x] R4 all four probe-failure modes fail open: non-zero exit, garbage JSON, >5s timeout, metta absent (533-582)
- [x] R5 allow-lists unchanged and pinned (64-115, 142-154, 338-346)
- [x] R6 real-CLI delegating shim (execs `npx tsx src/cli/index.ts`, no cwd conditional); red-run against pre-fix hook documented in commit 61694d426 and independently reproduced by two reviewers

### Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 127 files, 2407/2407 (49 guard-edit tests) |
| typecheck / lint | PASS |
| build | PASS |
| hook byte-identity (template = .claude = dist) | PASS |

Review: 3 reviewers, 1 iteration — correctness PASS, security and quality PASS_WITH_WARNINGS; all warnings doc-level, resolved in commit 6448def52; ADR-3 residual logged as issue `guard-edit-worktree-name-match-hardening-follow-up`.
