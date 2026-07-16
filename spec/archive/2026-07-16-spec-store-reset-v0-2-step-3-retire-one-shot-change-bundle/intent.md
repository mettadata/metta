# spec-store-reset-v0-2-step-3-retire-one-shot-change-bundle

## Problem

`spec/specs/` has grown to 38 capability folders, but the majority are not durable capabilities — they are one-shot change bundles that were auto-created per change during earlier `metta propose`/`metta fix-issues` runs, before slug hygiene and reconciliation discipline existed. Symptoms visible today:

- **Degraded and leaked slugs as folder names**: `fix-issue-full-workflow-refere`, `fix-issue-stories-parser-multi`, `fix-metta-next-gap-detect-unme`, `t8-post-merge-gate-re-run-afte` are truncated mid-word; `spec:-metta-fix-issues-cli-command-m`, `spec:-centralize-slugify-utility-strip-non-ascii-truncate-at-word`, `spec:-fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r`, `spec:-fix-issue-metta-ship-merged-fi`, `spec:-fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i` carry a literal `spec:` prefix and colon character leaked from a change title into a directory name.
- **Pure fix ceremony masquerading as capabilities**: folders like `fix-gate-runner-process-group-kill-timeout-scope-gates`, `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill`, `spec-branch-safety-guard-metta-issue-metta-backlog-state`, `spec-remove-git-commit-prose-planning-agent-bodies-forbid` describe a single bug fix, not an ongoing capability surface, and their requirements are already subsumed by the capability they patched.
- **CLAUDE.md's "Active Specs" table is unreadable**: with 38 rows, most bearing mangled or overly specific names, the table no longer functions as a map of the system's real capability surface for either humans or AI orchestrators reading the constitution.
- **Signal-to-noise makes spec navigation slow**: an agent trying to find "where do gate warn/on_failure semantics live" or "where are user stories specified" has to search past a majority of one-off fix folders to find the 11 genuinely durable, well-named capability specs (`state-store`, `workflow-engine`, `schemas`, etc.) and the 8 capabilities that are durable but poorly named (e.g. `spec:-metta-fix-issues-cli-command-m` for what is really the fix-issues CLI command contract).

This is step 3 of the v0.2 spec store reset: reclassify the 38 folders into retire / rename / keep buckets and execute the retirement and renames so `spec/specs/` reflects the system's actual capability surface.

## Proposal

Reclassify all 38 folders in `spec/specs/` into three buckets and execute the changes as filesystem operations (no spec-content rewriting):

**RETIRE (19 folders)** — move each folder, contents intact, into a dated archive location `spec/archive/2026-07-16-spec-store-reset/`, preserving the folder's internal structure:
`fix-finalize-stage-should-auto-update-docs-changelog-md`, `fix-gate-runner-process-group-kill-timeout-scope-gates`, `fix-issue-full-workflow-refere`, `fix-issue-stories-parser-multi`, `fix-metta-next-gap-detect-unme`, `metta-issue-metta-backlog-slas`, `spec:-centralize-slugify-utility-strip-non-ascii-truncate-at-word`, `spec:-fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r`, `spec:-fix-issue-metta-ship-merged-fi`, `spec:-fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i`, `spec-metta-backlog-description-flag-whitelist-spec-issues`, `spec-remove-git-commit-prose-planning-agent-bodies-forbid`, `t8-post-merge-gate-re-run-afte`, `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill`, `skill-template-consistency-enforcement`, `spec-project-local-gate-overrides-metta-gates-language`, `spec-stack-detection-at-install-gate-scaffolding-rust-python`, `spec-branch-safety-guard-metta-issue-metta-backlog-state`, `surface-time-token-budget-review-verifier-iteration-count`.
Rationale per folder falls into one of three categories: (a) pure fix ceremony describing a single bug fix rather than an ongoing capability, (b) requirements already subsumed by a capability being kept, or (c) a truncated/leaked slug with no independent capability identity distinct from a kept folder.

**RENAME (8 folders)** — `git mv` only, spec content unchanged, to give durable capabilities readable names:
- `fix-gate-infrastructure-bundle` → `gate-runner` (this is the only durable home of gate `on_failure`/`warn` semantics; promoted from fix-bundle naming to capability naming)
- `custom-claude-statusline-conte` → `claude-statusline`
- `spec:-metta-fix-issues-cli-command-m` → `fix-issues-command`
- `upgrade-metta-issue-skill-run-short-debugging-session-before` → `issue-logging`
- `fix-metta-propose-has-no-flag-stop-after-planning-artifacts` → `propose-stop-after`
- `harden-metta-config-yaml-lifecycle-across-three-related-bugs` → `config-writer`
- `user-story-layer-for-spec-format-(t5)` → `user-stories`
- `split-metta-install-metta-init` → `install-init`

**KEEP unchanged (11 folders)** — no rename, no move: `state-store`, `workflow-engine`, `schemas`, `config-loader`, `context-engine`, `execution-engine`, `artifact-store`, `finalize-ship`, `spec-model`, `adaptive-workflow-tier-selection`, `workflow-parallelism-discipline`.

End state: `spec/specs/` contains 19 folders (8 renamed + 11 kept), all with clean, capability-scoped names.

**Implementation contract:**
1. `git mv` every folder in the RETIRE list into `spec/archive/2026-07-16-spec-store-reset/<original-name>/`, and every folder in the RENAME list to its new name in place — both preserve git history.
2. `grep` `src/`, `tests/`, `docs/`, and `.claude/` for references (by folder name or slug) to every retired or renamed folder. Update any code or config reference that resolves a path against the old name; docs under `docs/` are expected to regenerate via the refresh pipeline and do not need manual editing, but a hard reference from `src/` or `tests/` to a moved path is a build/test failure that must be fixed before this change ships.
3. Write a `README.md` inside `spec/archive/2026-07-16-spec-store-reset/` listing every retired folder and its one-line retirement rationale (fix ceremony / subsumed / leaked-slug debris), with a pointer back to this change's intent document as the source of the classification.
4. Regenerate `CLAUDE.md` via the existing refresh pipeline (`/metta-refresh`) so the "Active Specs" table reflects the clean ~19-capability list with correct requirement counts.
5. Run the full test suite and build (`npm test`, `tsc` build) after the moves and confirm both stay green before this change is marked complete.

## Impact

- `spec/specs/` shrinks from 38 folders to 19, all durable capabilities with clean names.
- `CLAUDE.md`'s "Active Specs" table is regenerated and now lists 19 rows instead of 38, restoring it as a usable map of the system for humans and AI orchestrators.
- The 19 retired folders' spec content is not deleted — it is preserved verbatim under `spec/archive/2026-07-16-spec-store-reset/` with git history intact and remains searchable/readable, just no longer presented as "active."
- The 8 renamed folders keep their spec content byte-for-byte identical; only the folder name (and therefore any path referencing it) changes.
- No runtime or `src/` behavior change is expected as an outcome of this change. The only way `src/` behavior changes is if step 2 of the implementation contract (reference grep) turns up a hardcoded path to a moved folder that must be updated — in which case that is a mechanical path fix, not a behavior change.
- Any tooling, script, or test that hardcodes one of the 27 old folder names (19 retired + 8 renamed) will break until updated; this is caught and fixed by implementation-contract step 2 and verified by step 5.
- Contributors and AI agents navigating `spec/specs/` going forward see a capability surface that matches the system's actual architecture, reducing time spent searching past fix-ceremony debris.

## Out of Scope

- Editing the spec content (Problem/Proposal/requirements/scenarios) of any of the 11 "keep unchanged" or 8 "renamed" capability specs. This change moves and renames folders only; it does not consolidate, rewrite, or merge spec bodies.
- Merging or de-duplicating requirements across specs (e.g. reconciling overlapping gate-related requirements between `gate-runner` and other kept specs). That is a separate, later spec-store-reset step if pursued.
- Any change to the metta CLI, workflow engine, or gate runner behavior in `src/`. This is a spec-store reorganization; any `src/` edit is strictly limited to fixing a hardcoded path reference uncovered by the grep in implementation-contract step 2.
- Reorganizing or reclassifying `spec/changes/`, `spec/issues/`, or `spec/backlog/`. This change touches `spec/specs/` (and creates the new `spec/archive/2026-07-16-spec-store-reset/` folder) only; other spec-store directories are out of scope except where a reference to a moved `spec/specs/` path needs updating.
- Deleting any retired spec content outright. Retirement means relocation to the archive with a rationale README, not deletion.
- Steps 1 and 2 of the broader v0.2 spec store reset (if they involve different mechanics than folder move/rename) — this intent covers step 3 only: execute the classification into retire/rename/keep.
