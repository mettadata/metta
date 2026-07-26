# Review: metta-uat-runner-skill-execute-change-s-generated-uat-md

Merged from review/correctness.md, review/security.md, review/quality.md (full findings in those files).

## Verdicts

| Reviewer | Verdict |
|---|---|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical findings.

## Warnings (consolidated)

1. (Correctness W1, skill pair) Named-archive glob `spec/archive/*-<name>/UAT.md` can match an unrelated slug ending in `-<name>`; use a date-anchored pattern `spec/archive/????-??-??-<name>/UAT.md` for exact resolution.
2. (Security 1, agent pair) The state-mutating `metta` subcommand blocklist omits `verify`, `roadmap add/reorder/next`, `gaps remove`; guard-bash trusts any `metta-*` agent_type, so the contract is the only barrier — rephrase as an allow-list (read-only `metta status --json` only).
3. (Security 2, agent pair) No constraint on hazardous non-metta Run: hints (network exfiltration, package installs, destructive fs operations).
4. (Security 3, skill pair) Pre/post checks scoped to the target path only; runner writes elsewhere go undetected — add a whole-tree `git status --porcelain` comparison to the post-run sanity gate.
5. (Security 4, skill pair) `git add <path> && git commit -m ...` commits the entire index; pre-staged unrelated changes bypass the diff gate — scope the commit with a pathspec.
6. (Quality 1, refresh.ts) `/metta-uat` missing from the hand-maintained skill listing in `buildWorkflowSection()` (`src/cli/commands/refresh.ts:130-156`) — regenerated CLAUDE.md would never list the skill.
7. (Quality 2) Return contract duplicated verbatim between skill and agent bodies with no pinning test — accepted as deliberate contract restatement; drift risk noted.

## Fix round

Warnings 1-6 are addressed in a fix round (three parallel executors: skill pair, agent pair, refresh.ts + its test), followed by reviewer re-run. Warning 7 and all note-level items are accepted and recorded here.
