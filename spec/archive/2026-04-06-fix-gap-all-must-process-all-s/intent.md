# fix-gap-all-must-process-all-s

## Problem
The fix-gap --all skill could stop after processing high severity gaps without continuing to medium and low.

## Proposal
Add explicit warning and instruction that ALL gaps must be processed. Never stop early.

## Impact
src/templates/skills/metta-fix-gap/SKILL.md only.

## Out of Scope
CLI changes.
