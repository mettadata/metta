# fix-gap-all-should-group-gaps

## Problem
`metta fix-gap --all` processes gaps one at a time sequentially. When gaps touch different files (no overlap), they could run in parallel — but the skill doesn't detect this.

## Proposal
Update the fix-gap skill's --all mode to batch gaps by file overlap and spawn parallel executors per independent batch.

## Impact
src/templates/skills/metta-fix-gap/SKILL.md — --all mode section rewritten.

## Out of Scope
CLI command changes. Gap file format changes. Single-gap pipeline changes.
