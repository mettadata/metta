# Review: executor-agent-must-check-off

Three reviewers ran in parallel: correctness, security, quality.

## Correctness — PASS
- Files byte-identical (`diff` empty).
- Rule wording clear, path correct, edge case covered.
- Consistent with existing conventional-commit rule.
- Minor observation (no change needed): doesn't explicitly address a fully-missing tasks.md, but "can't be located" covers it.

## Security — PASS
- Prompt-only edit, no code.
- No path traversal, command injection, or prompt injection surface introduced.
- Security surface effectively nil.

## Quality — PASS_WITH_WARNINGS → addressed
Two non-blocking suggestions, both applied in a follow-up edit:
1. Tightened wording to imperative voice, removed parenthetical.
2. Explicit reference to the Deviation Rules section to prevent agents inventing a new deviation format.

Final rule reads: *"As part of each task's commit, flip that task's `- [ ]` to `- [x]` in `spec/changes/<change>/tasks.md` and stage it with your code. Never a separate commit. If the task can't be located in tasks.md, log a deviation per the Deviation Rules above and continue."*

## Verdict
All three reviewers PASS after quality tweaks applied. No further review iterations needed.
