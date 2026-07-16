# 2026-07-16 Spec Store Reset — Retired Capability Folders

This directory holds 19 folders retired from `spec/specs/` as step 3 of the v0.2
spec store reset. Content is preserved **verbatim** — every folder was moved here
with `git mv`, so full git history is intact and the specs remain searchable and
readable. They are simply no longer presented as active capabilities.

Source of the classification: the intent document at
`spec/changes/spec-store-reset-v0-2-step-3-retire-one-shot-change-bundle/intent.md`
(archived alongside that change after ship).

## Classification criteria

Each retired folder matched one or more of three criteria:

1. **Fix ceremony** — the folder describes a single one-shot bug fix, not an
   ongoing capability surface. It was auto-created per change during earlier
   `metta propose` / `metta fix-issues` runs before slug hygiene existed.
2. **Subsumed** — its requirements are already covered by a durable capability
   that remains in `spec/specs/`.
3. **Truncated / leaked slug** — the folder name is degraded slug debris
   (truncated mid-word, or carrying a literal `spec:` prefix leaked from a
   change title) with no capability identity distinct from a kept folder.

## Retired folders

| Folder | Rationale |
|--------|-----------|
| `fix-finalize-stage-should-auto-update-docs-changelog-md` | Fix ceremony; behavior subsumed by `finalize-ship` |
| `fix-gate-runner-process-group-kill-timeout-scope-gates` | Fix ceremony; behavior subsumed by `gate-runner` |
| `fix-issue-full-workflow-refere` | Truncated slug; fix ceremony |
| `fix-issue-stories-parser-multi` | Truncated slug; fix ceremony, subsumed by `user-stories` |
| `fix-metta-next-gap-detect-unme` | Truncated slug; fix ceremony |
| `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill` | Fix ceremony describing a single guard bug fix |
| `metta-issue-metta-backlog-slas` | Truncated slug; subsumed by `issue-logging` |
| `skill-template-consistency-enforcement` | One-shot enforcement pass, not an ongoing capability |
| `spec-branch-safety-guard-metta-issue-metta-backlog-state` | Fix ceremony; single branch-safety bug fix |
| `spec-metta-backlog-description-flag-whitelist-spec-issues` | Fix ceremony; single flag-whitelist fix |
| `spec-project-local-gate-overrides-metta-gates-language` | One-shot spec tweak, subsumed by `gate-runner` |
| `spec-remove-git-commit-prose-planning-agent-bodies-forbid` | Fix ceremony; single prose-removal fix |
| `spec-stack-detection-at-install-gate-scaffolding-rust-python` | One-shot install tweak, subsumed by `install-init` |
| `spec:-centralize-slugify-utility-strip-non-ascii-truncate-at-word` | Leaked `spec:` slug; one-shot utility fix |
| `spec:-fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r` | Leaked `spec:` slug; truncated; fix ceremony |
| `spec:-fix-issue-metta-ship-merged-fi` | Leaked `spec:` slug; truncated; fix ceremony |
| `spec:-fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i` | Leaked `spec:` slug; truncated; fix ceremony, subsumed by `fix-issues-command` |
| `surface-time-token-budget-review-verifier-iteration-count` | One-shot surfacing change, not a durable capability |
| `t8-post-merge-gate-re-run-afte` | Truncated slug; fix ceremony, subsumed by `gate-runner` / `finalize-ship` |

## Rename map (executed in the same reset, folders stayed in `spec/specs/`)

| Old name | New name |
|----------|----------|
| `fix-gate-infrastructure-bundle` | `gate-runner` |
| `custom-claude-statusline-conte` | `claude-statusline` |
| `spec:-metta-fix-issues-cli-command-m` | `fix-issues-command` |
| `upgrade-metta-issue-skill-run-short-debugging-session-before` | `issue-logging` |
| `fix-metta-propose-has-no-flag-stop-after-planning-artifacts` | `propose-stop-after` |
| `harden-metta-config-yaml-lifecycle-across-three-related-bugs` | `config-writer` |
| `user-story-layer-for-spec-format-(t5)` | `user-stories` |
| `split-metta-install-metta-init` | `install-init` |

The 11 remaining folders (`state-store`, `workflow-engine`, `schemas`,
`config-loader`, `context-engine`, `execution-engine`, `artifact-store`,
`finalize-ship`, `spec-model`, `adaptive-workflow-tier-selection`,
`workflow-parallelism-discipline`) were kept unchanged, leaving `spec/specs/`
with 19 clean, capability-scoped folders.
