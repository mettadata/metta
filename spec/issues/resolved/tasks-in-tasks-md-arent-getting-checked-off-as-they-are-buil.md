# tasks in tasks.md arent getting checked off as they are built or even after. We are at the verification step and they are all still unchecked.

**Captured**: 2026-04-14
**Resolved**: 2026-04-14
**Status**: resolved
**Severity**: minor
**Fixed by**: change `executor-agent-must-check-off`, merged to main at `f8edccc`

## Symptom
tasks in tasks.md arent getting checked off as they are built or even after. We are at the verification step and they are all still unchecked.

## Resolution
Added a rule to the metta-executor agent prompt (`src/templates/agents/metta-executor.md` + `.claude/agents/metta-executor.md`, byte-identical) requiring the executor to flip `- [ ]` → `- [x]` in `spec/changes/<change>/tasks.md` and stage that edit with each task's commit. See commit `b73541c` (initial rule) and `becf2d3` (wording tweak per quality review).

## Caveat
Shipped but not observed in a live executor run yet — first `/metta-propose` after 2026-04-14 will be the end-to-end confirmation.
