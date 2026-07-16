# Verification Summary — spec-store-reset-v0-2-step-3-retire-one-shot-change-bundle

**Verdict: PASS**

Quick change verified against `intent.md` (RETIRE 19 / RENAME 8 / KEEP 11, 5-step implementation contract). This document is both the verification record and the implementation summary for this quick change.

## What was implemented

Step 3 of the v0.2 spec store reset: `spec/specs/` was reduced from 38 folders to 19 by retiring 19 one-shot change bundles into `spec/archive/2026-07-16-spec-store-reset/` (with rationale README) and renaming 8 durable-but-poorly-named capabilities via `git mv`. No spec body content was edited; no `src/` behavior changed. `CLAUDE.md`'s Active Specs table was regenerated to the 19 clean names.

## Verification evidence

### 1. `spec/specs/` contains exactly the 19 expected folders

Scripted `diff` of `find spec/specs -maxdepth 1 -type d` output against the intent's KEEP + RENAME(new-name) lists: **exact match, 19 folders, no stragglers, no losses, no stray files.**

- 11 kept: `adaptive-workflow-tier-selection`, `artifact-store`, `config-loader`, `context-engine`, `execution-engine`, `finalize-ship`, `schemas`, `spec-model`, `state-store`, `workflow-engine`, `workflow-parallelism-discipline`
- 8 renamed: `gate-runner`, `claude-statusline`, `fix-issues-command`, `issue-logging`, `propose-stop-after`, `config-writer`, `user-stories`, `install-init`

### 2. Archive contains exactly the 19 retired folders + README.md

`spec/archive/2026-07-16-spec-store-reset/` — scripted `diff` against the intent's RETIRE list: **exact match, 19 directories**, plus `README.md` (4,311 bytes) as the only file. README name-checks all 19 retired folders with rationale and points back to this change's intent.

Spot-check of 3 retired folders' `spec.md` (content intact, byte-identical to pre-move blob at `1ccfed3d7`, `git log --follow` reaches original creation commit):

| Retired folder | Size | `--follow` reaches | Byte-identical |
|---|---|---|---|
| `skill-template-consistency-enforcement` | 12,903 B | `61eb816a6` (create delta spec) | yes |
| `surface-time-token-budget-review-verifier-iteration-count` | 10,298 B | `3d937fcf0` (create spec) | yes |
| `spec:-centralize-slugify-utility-strip-non-ascii-truncate-at-word` | 8,177 B | `8b21abf17` (create spec) | yes |

### 3. Renames preserved content and git history

Spot-check of 3 renamed folders — `git log --follow` crosses the rename to pre-rename history, and content is byte-identical to the pre-rename blob at `1ccfed3d7`:

| New name | Old name | Oldest `--follow` commit | Byte-identical |
|---|---|---|---|
| `gate-runner` | `fix-gate-infrastructure-bundle` | `3d62ed7e2` docs(fix-gate-infrastructure-bundle): create spec | yes |
| `user-stories` | `user-story-layer-for-spec-format-(t5)` | `63e252d10` chore(t5-user-story-layer-spec-forma): archive and finalize | yes |
| `config-writer` | `harden-metta-config-yaml-lifecycle-across-three-related-bugs` | `2dddd86ce` docs(harden-config-yaml): create spec | yes |

### 4. CLAUDE.md Active Specs table

Scripted extraction of the Active Specs table rows: **exactly 19 rows, exact match** against the expected new names. Grep for all 8 old renamed names in `CLAUDE.md`: zero hits.

### 5. Reference integrity (implementation-contract step 2)

`grep -rnF` across `src/`, `tests/`, `.claude/` for each of the **27 old names** (19 retired + 8 old renamed names): **zero hits.** (`docs/`, `spec/archive/`, `spec/issues/` are historical and excluded per verification scope.)

### 6. CLI functions against the reset store

- `node dist/cli/index.js specs list` (freshly built dist) — exit 0, lists **exactly the 19 capabilities**.
- `node dist/cli/index.js status --json` — exit 0, valid JSON, shows this change active at `verification`.
- Note: several imported-era specs (`state-store`, `schemas`, etc.) display `v? / unknown` in `specs list` — this is pre-existing (imported spec format lacks version frontmatter, content byte-identical to before this change), not caused by the move.

## Gates

| Gate | Command | Result |
|---|---|---|
| Tests | `npx vitest run` | **82 files passed, 1096 tests passed, 0 failed** (246.9s) |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` (tsc --noEmit) | exit 0 |
| Build | `npm run build` | exit 0 (templates copied to dist) |

## Notes / known follow-ups (non-blocking)

- Renamed folders' `spec.md` still carry their old H1 titles (e.g. `spec/specs/gate-runner/spec.md` opens with `# fix-gate-infrastructure-bundle`). This is expected — the intent explicitly scopes renames to `git mv` only with spec content unchanged, and content rewriting is listed Out of Scope. A later spec-store-reset step may retitle bodies.
- `docs/` (architecture/api/changelog) still contain old-name mentions; per the intent these regenerate via the refresh pipeline and are acceptable as historical references.
