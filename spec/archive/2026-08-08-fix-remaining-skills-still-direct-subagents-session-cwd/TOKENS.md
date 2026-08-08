# Token usage: fix-remaining-skills-still-direct-subagents-session-cwd

- **Change**: fix-remaining-skills-still-direct-subagents-session-cwd
- **Generated**: 2026-08-08

> Figures below are approximate, orchestrator-reported token counts collected
> during the change lifecycle. They are indicative of relative effort only —
> not billing-grade accounting — and may under- or over-count actual provider
> usage.

## Total

**~399,201 tokens** across 10 record(s).

## Per artifact

| Artifact/task | Agent | Model | Tokens |
|---|---|---|---|
| implementation-fix-issues-fix-gap | metta-executor | sonnet | 39,823 |
| implementation-quick-auto | metta-executor | sonnet | 45,345 |
| implementation-execute-uat | metta-executor | sonnet | 43,774 |
| review-security | metta-reviewer | inherit | 39,365 |
| review-quality | metta-reviewer | inherit | 61,435 |
| review-correctness | metta-reviewer | inherit | 56,046 |
| review-fixes | metta-executor | sonnet | 50,018 |
| verify-typecheck-lint-build | metta-verifier | inherit | 12,541 |
| verify-intent-coverage | metta-verifier | inherit | 36,081 |
| verify-tests | metta-verifier | inherit | 14,773 |

## Per role

| Agent | Tokens |
|---|---|
| metta-executor | 178,960 |
| metta-reviewer | 156,846 |
| metta-verifier | 63,395 |

## Per model

| Model | Tokens |
|---|---|
| inherit | 220,241 |
| sonnet | 178,960 |

## Cheap/pinned (non-inherit) vs inherit

- **Cheap/pinned (non-inherit)**: ~178,960 tokens
- **Inherit**: ~220,241 tokens

## Gaps

- `implementation` — timed artifact with no reported token usage
- `intent` — timed artifact with no reported token usage
- `verification` — timed artifact with no reported token usage
