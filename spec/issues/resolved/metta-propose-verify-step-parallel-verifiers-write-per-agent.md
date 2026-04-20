# metta-propose verify step: parallel verifiers write per-agent output to /tmp/verify-*.md (tests, build+lint, scenario coverage) instead of spec/changes/<name>/verify-<aspect>.md. Third instance of same root cause as metta-propose-research-step-* and metta-propose-review-step-*. All three skill fan-outs share the same drift: /tmp used as default output path instead of the change directory. Recommend consolidating fix into a single skill-template change that mandates spec/changes/<name>/<stage>/<slug>.md as the output path convention across ALL fan-outs (research, review, verify) and any future fan-out sections.

**Captured**: 2026-04-19
**Status**: logged
**Severity**: minor

metta-propose verify step: parallel verifiers write per-agent output to /tmp/verify-*.md (tests, build+lint, scenario coverage) instead of spec/changes/<name>/verify-<aspect>.md. Third instance of same root cause as metta-propose-research-step-* and metta-propose-review-step-*. All three skill fan-outs share the same drift: /tmp used as default output path instead of the change directory. Recommend consolidating fix into a single skill-template change that mandates spec/changes/<name>/<stage>/<slug>.md as the output path convention across ALL fan-outs (research, review, verify) and any future fan-out sections.
