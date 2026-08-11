# fix-statusline-reports-idle-while-forked-work-running

## Problem

The Claude Code statusline rendered `[metta: idle] 297%` while a fix-issues fork (a
`metta-skill-host` subagent working in a `.metta/worktrees/` checkout) was mid-change.
Every developer running metta-managed sessions sees two compounding lies:

1. **Context percent exceeds 100%.** `resolveContextWindow` in
   `.claude/statusline/statusline.mjs` returns 1,000,000 only when the model id contains
   the literal substring `[1m]`; every other model id gets a hardcoded 200,000. Current
   model ids such as `claude-fable-5` carry a 1M-token window but do not match the
   substring, so the denominator is 5x too small — 297% renders where ~59% is correct.
   `computePercent` has no clamp, so the absurd value is displayed verbatim.

2. **Activity shows `idle` while real work runs.** The activity segment shells out to
   `metta status --json` from the project root and reads a top-level `current_artifact`
   field. That field exists only in the single-change JSON shape; the zero-change path
   emits `{ changes: [], message }` and the multi-change path emits `{ changes: [...] }`
   with no top-level `current_artifact`. Worktree-hosted changes (the normal hosting mode
   for fork-driven work) never appear in the root `listChanges()` at all. The parser
   silently falls through to `idle` exactly when forked work is running.

The same script exists byte-for-byte at `src/templates/statusline/statusline.mjs` (the
template that `metta install` distributes), so the defect ships to every project that
installs metta.

## Proposal

Fix the statusline script in both locations, keeping them byte-identical:

1. **Context window resolution.** Prefer an explicit window size carried by the
   statusline stdin payload when the harness provides one; otherwise fall back to a small
   explicit model-id lookup (prefix-based, covering current model families with their
   documented window sizes) instead of `[1m]` substring sniffing; final fallback stays
   200,000. Verify the actual stdin payload schema against Claude Code documentation
   during research rather than assuming fields.

2. **Percent clamp with overflow marker.** `computePercent` output above 100 renders as
   `>100%!` (clamped, visibly flagged) so a wrong denominator is detectable instead of
   absurd.

3. **Fork/worktree-aware activity detection.** Teach the activity resolver to see work
   that the root `metta status --json` single-change shape cannot represent:
   understand the aggregated `{ changes: [...] }` shape (pick the active change), and
   detect worktree-hosted changes under `.metta/worktrees/` so a running fork renders its
   change slug and artifact instead of `idle`. The exact mechanism (worktree scan vs.
   hook-maintained activity file vs. CLI JSON extension) is a research/design decision
   for this change; the acceptance bar is: while a fork is mid-change in a worktree, the
   statusline does not report `idle`.

4. **Spec delta.** The active `claude-statusline` spec currently codifies the buggy
   behavior (`[1m]` sniffing, 200k default, top-level `current_artifact` only). Update
   the affected requirements and scenarios to the corrected behavior.

5. **Tests.** Update `tests/statusline-resolve-context-window.test.ts`,
   `tests/statusline-compute-percent.test.ts`, and add coverage for the new activity
   resolution paths, maintaining the 1:1 test-to-source discipline.

## Impact

- `.claude/statusline/statusline.mjs` and `src/templates/statusline/statusline.mjs` —
  behavior change in window resolution, percent rendering, and activity detection.
- `spec/specs/claude-statusline/spec.md` — requirements for "Context window resolution",
  "Context utilization calculation" (percent clamp), and "Metta artifact resolution"
  change; downstream consumers of those scenarios (tests) update with them.
- Existing statusline tests that assert the `[1m]`/200k behavior will be rewritten.
- No CLI JSON contract change is assumed at intent time; if design selects the
  `metta status --json` extension route, that impact widens to `src/cli/commands/status.ts`
  and its schema/tests (flagged for design to decide).
- Transcript-usage arithmetic (`findLatestAssistantUsage`) is re-verified against how the
  harness reports usage; only corrected if research shows it is wrong.

## Out of Scope

- Any statusline redesign beyond the three defects (no new segments, no theming).
- Reporting fork activity that has not yet written any change state (a fork between
  `propose` and its first artifact may still read idle — acceptable).
- Cross-session/multi-pane session attribution (statusline shows activity for the
  project it runs in, not per-tmux-pane session mapping).
- Changes to `metta install` / build template-copy plumbing (already correct).
- Fixing the pre-existing duplicated requirement blocks inside
  `spec/specs/claude-statusline/spec.md` beyond the sections this change touches.
