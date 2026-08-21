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

## Round 2 (iteration #2) — after fix commit `c53dfe94c`

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

Both round-1 majors confirmed CLOSED: no remaining path from `/metta-propose` to a merge without explicit opt-in on the standard pipeline; `--ship` misparse closed at Step 1 (standalone-token constraint + mandatory announcement). Step 8.d confirmed exhaustive; all 100 targeted tests green; copies byte-identical.

### Residual warnings (accepted — all fail safe: worst case stops at open PR, never merges)

1. The reroute clause says "unless `--ship` was present in the original propose invocation" without referencing the Step 1 parse constraints/announcement — a literal prose-mention reading could authorize the quick flow's merge on reroute (Security R2 #1, Quality R2 #1). Mitigation: semantic topic-exclusion errs toward exclusion; failure mode is merge only if an orchestrator takes the loosest reading of a description that both matches quick criteria and mentions `--ship`.
2. `--stop-after ship` parse is not covered by the standalone-token/announcement constraints that `--ship` got (Security R2 #2).
3. Local vs persisted stop_after disagreement: 8.d and 8.e are not exact complements; ambiguity resolves to no-merge (Security R2 #3, Correctness R2 suggestion).
4. metta-quick's own MUST-merge language has no carve-out acknowledging the propose-reroute exception (Security R2 #4) — metta-quick is out of this change's mandated scope.
5. Round-2 additions (announcement string, carry-over clause, exhaustive-else wording) are not yet grep-assert protected (Quality R2 #4).

Follow-up recommendation: log a separate issue to tighten the reroute/`--stop-after ship` wording and add grep-asserts for the round-2 clauses, and to decide metta-quick's own default.
