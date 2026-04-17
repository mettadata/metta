# Review: current-artifact-sticks-just-c

## Verdict: PASS (after spec sync + negative test added)

3-reviewer parallel pass:

- **Correctness:** PASS — status-value coverage correct, terminal case (after `metta complete verification`) holds, live smoke test confirmed `current_artifact` advances `intent → stories` after completing intent.
- **Quality:** PASS_WITH_WARNINGS → resolved. WARNING: `spec/specs/artifact-store/spec.md:64` still described the pre-fix semantics. Fixed by updating the Requirement text and adding a "Mark next artifact ready advances current_artifact" Scenario. Also added a negative test case (`pending` / `failed` / `skipped` transitions do NOT move the pointer).
- **Verifier:** PASS — `tsc --noEmit` clean, 527/527 tests pass (after this commit's 2 new test cases: 528/528), live smoke test exits 0 at every step with the observed advance.

## Live smoke-test evidence (from verifier agent)

| Step | `current_artifact` |
|------|-------------------|
| After `metta propose` | `intent` |
| After `metta complete intent` | `stories` ✅ |

## Fix shape

One-line conditional expansion in `src/artifacts/artifact-store.ts` — added `'ready'` to the status list that triggers `current_artifact` update. Because `metta complete` always writes `markArtifact(next, 'ready')` AFTER `markArtifact(current, 'complete')`, "last write wins" delivers the correct advance.
