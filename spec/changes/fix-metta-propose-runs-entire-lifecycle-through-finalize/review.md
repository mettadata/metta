# Review: fix-metta-propose-runs-entire-lifecycle-through-finalize

## Round 1 (iteration #1)

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical issues. Convergent findings:

### Major (fixed in round 1 fix commit)

1. **Quick-reroute bypasses the PR-open default** (Security #1, Quality #1) — `.claude/skills/metta-propose/SKILL.md` routing pre-step reroutes small descriptions into the metta-quick flow, which still runs `gh pr merge` by default. `/metta-propose <small change>` could therefore still merge unattended, contradicting the new CLAUDE.md wording. Fix: routing pre-step now carries the PR-open default over to the quick reroute — the quick flow's merge steps are skipped unless `--ship` was present.
2. **`--ship` misparse turns prose into merge authorization** (Security #2) — token parsing had no position/context constraint, so a description mentioning `--ship` could trigger run-to-merge. Fix: parsing constrained (not inside quotes / not the subject of the description) + orchestrator must announce "Ship opt-in detected: this run will merge to main after CI passes" at Step 1 so misparses surface immediately.

### Minor (fixed)

3. **Step 8.d third-state gap** (all three reviewers) — default clause covered only "no persisted stop_after"; a persisted planning-artifact value reaching Step 8 matched neither branch. Fix: default condition now "anything other than `ship`" — the no-merge default is the exhaustive else-branch of the ship gate.
4. **Stale label** (Quality #2) — Step 3 text said "Step 8 (finalize/merge)"; now "Step 8 (finalize/PR)".

### Minor (accepted, not fixed)

5. `ship` as a reserved stop-after value collides with a hypothetical custom workflow artifact named `ship` (Security #4) — accepted; no such workflow exists; documented behavior.
6. Scope-guard tests read template copies only (Correctness #2, Quality #4) — accepted; deployed copies covered transitively by byte-identity tests.
7. Constitution tension: default path still pushes branch + opens PR without a prompt (Security #5) — pre-existing, not worsened; skill text is explicit about it.
8. `--stop-after ship` CLI test exercises standard workflow only (Correctness #3) — accepted; code-inspection confirms workflow independence.

## Round 2 (iteration #2) — after fixes

| Reviewer | Verdict |
|----------|---------|
| Correctness | (see round 2 note) |
| Security | (see round 2 note) |
| Quality | (see round 2 note) |

Round 2 note: re-review scoped to the round-1 fix diff; results recorded in the finalize record / summary.md.
