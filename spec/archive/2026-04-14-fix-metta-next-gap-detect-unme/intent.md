# fix-metta-next-gap-detect-unme

## Problem
After a change is finalized and archived, `metta next` returns `{next: "propose"}` because `artifactStore.listChanges()` reads `spec/changes/` which is now empty — but the branch `metta/<change>` still exists with commits ahead of `main` and has not been merged. The `/metta-next` Claude Code skill therefore stops advancing the workflow at the final hop (ship).

Concrete symptom: a user walking through `propose → plan → execute → verify → finalize` with `/metta-next` loses the workflow after finalize. They have to know to run `metta ship` manually or invoke `/metta-ship`. The skill's contract ("always go to the next step") is broken here.

Affected: anyone using `/metta-next` as the primary driver; any AI harness that polls `metta next --json` to automate the workflow.

## Proposal
Extend `metta next` with a post-archive branch check. When no active changes exist in `spec/changes/`:

1. Detect the current git branch. If it matches `metta/<name>` and is ahead of the default branch (`main`), return `{next: "ship", command: "metta ship", change: "<name>", branch: "metta/<name>"}` with a human-readable "Ready to ship: <change>" line.
2. Otherwise fall back to the existing "propose a new change" response.

Update the `/metta-next` skill to run `/metta-ship` (or `metta ship`) when `next.next === "ship"`, same as it does today for `"finalize"`.

The check should tolerate a missing upstream `main` (e.g. detached HEAD, non-standard default) — in that case fall back to propose.

## Impact
- **CLI surface**: `metta next --json` gains a new possible `next: "ship"` response. Callers parsing this field must be prepared for the new value (strings, not typed enum).
- **Skill**: `/metta-next` body gains one more conditional; no new tool permissions.
- **Tests**: new unit tests for the branch-detection path in `tests/cli.test.ts` or a dedicated next test file; mock/seed a git repo with an unmerged `metta/foo` branch.
- **Docs**: update skill README / CLAUDE.md workflow description if it enumerates `next`'s possible outputs.

## Out of Scope
- Changing the shape of the `propose` response.
- Teaching `metta next` about stacked changes (multiple unmerged `metta/*` branches in history). If HEAD is on one such branch, return that one; don't recurse.
- Auto-shipping — `/metta-next` still prompts confirmation as it does for destructive actions; this change only makes `ship` the advertised next step.
- Renaming `metta ship` or changing its behavior.
- Supporting non-`main` default branches as a first-class concept (if `main` doesn't exist, fall back to propose and log nothing).
