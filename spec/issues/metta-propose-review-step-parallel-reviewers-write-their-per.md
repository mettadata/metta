# metta-propose review step: parallel reviewers write their per-persona output to /tmp/review-correctness.md, /tmp/review-security.md, /tmp/review-quality.md instead of spec/changes/<name>/review-<persona>.md. Same class as metta-propose-research-step-parallel-researchers-write-to but in the review fan-out section of the skill template. Orchestrator later merges into review.md but the per-persona files are lost on /tmp cleanup. Fix: skill step 5 should explicitly name spec/changes/<name>/review-<persona>.md as the agent output path.

**Captured**: 2026-04-19
**Status**: logged
**Severity**: minor

metta-propose review step: parallel reviewers write their per-persona output to /tmp/review-correctness.md, /tmp/review-security.md, /tmp/review-quality.md instead of spec/changes/<name>/review-<persona>.md. Same class as metta-propose-research-step-parallel-researchers-write-to but in the review fan-out section of the skill template. Orchestrator later merges into review.md but the per-persona files are lost on /tmp cleanup. Fix: skill step 5 should explicitly name spec/changes/<name>/review-<persona>.md as the agent output path.
