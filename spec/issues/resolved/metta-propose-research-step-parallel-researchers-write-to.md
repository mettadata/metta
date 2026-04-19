# metta-propose research step: parallel researchers write to /tmp/research-*.md and orchestrator forgets to synthesize spec/changes/<name>/research.md before metta complete research. Gate caught it correctly. Skill template step 3 says to merge but buried in sub-bullet 3d. Fix: make per-approach output path explicit (spec/changes/<name>/research-<slug>.md) and elevate synthesis to a numbered step with 'write spec/changes/<name>/research.md' in the imperative.

**Captured**: 2026-04-19
**Status**: logged
**Severity**: major

metta-propose research step: parallel researchers write to /tmp/research-*.md and orchestrator forgets to synthesize spec/changes/<name>/research.md before metta complete research. Gate caught it correctly. Skill template step 3 says to merge but buried in sub-bullet 3d. Fix: make per-approach output path explicit (spec/changes/<name>/research-<slug>.md) and elevate synthesis to a numbered step with 'write spec/changes/<name>/research.md' in the imperative.
