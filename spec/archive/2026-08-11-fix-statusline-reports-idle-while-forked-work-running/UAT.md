# UAT: fix-statusline-reports-idle-while-forked-work-running

- **Change**: fix-statusline-reports-idle-while-forked-work-running
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Context window resolution. Prefer an explicit window size carried by the statusline stdin payload when the harness provides one; otherwise fall back to a small explicit model-id lookup (prefix-based, covering current model families with their documented window sizes) instead of `[1m]` substring sniffing; final fallback stays 200,000. Verify the actual stdin payload schema against Claude Code documentation during research rather than assuming fields.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Percent clamp with overflow marker. `computePercent` output above 100 renders as `>100%!` (clamped, visibly flagged) so a wrong denominator is detectable instead of absurd.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Fork/worktree-aware activity detection. Teach the activity resolver to see work that the root `metta status --json` single-change shape cannot represent: understand the aggregated `{ changes: [...] }` shape (pick the active change), and detect worktree-hosted changes under `.metta/worktrees/` so a running fork renders its change slug and artifact instead of `idle`. The exact mechanism (worktree scan vs. hook-maintained activity file vs. CLI JSON extension) is a research/design decision for this change; the acceptance bar is: while a fork is mid-change in a worktree, the statusline does not report `idle`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Spec delta. The active `claude-statusline` spec currently codifies the buggy behavior (`[1m]` sniffing, 200k default, top-level `current_artifact` only). Update the affected requirements and scenarios to the corrected behavior.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Tests. Update `tests/statusline-resolve-context-window.test.ts`, `tests/statusline-compute-percent.test.ts`, and add coverage for the new activity resolution paths, maintaining the 1:1 test-to-source discipline.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Requirement: Context window resolution

#### Step 2.1
- **Do**: Confirm: [x] Payload declares the window size — tests/statusline-resolve-context-window.test.ts ("prefers context_window.context_window_size from the stdin payload")
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] 1M-family model id resolves to 1M without payload window — ("returns 1_000_000 for current 1M-window model families by prefix")
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] Haiku model id resolves to 200k — ("returns 200_000 for haiku model ids")
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] Model id contains [1m] substring — ("returns 1_000_000 when model.id contains [1m]")
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: [x] Unrecognized model id falls back to 200k — ("returns 200_000 for unrecognized model ids")
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: [x] Model field absent / wrong type — three existing scenarios retained and passing
- **Observe**: behaves as described
- [ ] Pass
