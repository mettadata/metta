# Research: Deferred-Publish Record (`release sync-github` reconciliation)

## Approach

`metta release cut` stops calling `gh release create` inline. When `release.github_release: true`, the cut instead records a pending GitHub-release marker on the new entry in the releases record (`spec/releases.yaml`, `src/release/releases-record-store.ts`, `src/schemas/releases-record.ts`). A new idempotent command, `metta release sync-github`, later scans the record for entries whose tag exists on the remote but which have no GitHub release, creates the missing releases via the existing `createGithubRelease` edge (`src/release/gh-release.ts`), and marks them done. Ship skills run: cut → push `--follow-tags` (riding the authorized main push) → `metta release sync-github`.

## How It Would Work (concrete)

1. **Schema change** — `ReleaseEntrySchema` (strict) gains an optional field, e.g. `github: z.enum(['pending', 'created', 'skipped']).optional()`. Optionality keeps existing `releases.yaml` files parsing without migration; strict mode is preserved.
2. **Cut change** — in `ReleasePipeline.cut()` the `gh` step (release-pipeline.ts:509–528) is replaced: when `release.github_release === true`, the entry written at the `write-releases-record` step carries `github: 'pending'`; otherwise `'skipped'` (or the field is omitted). `createGithubRelease` is no longer invoked from `cut()`; the `--github` flag on `release cut` (src/cli/commands/release.ts:81) is retired or repurposed.
3. **New command** — `metta release sync-github` on a new `ReleasePipeline.syncGithub()` method (still one pipeline — not a second cut path):
   - Load the record; select entries with `github: 'pending'`.
   - For each, verify the tag is on the remote (`git ls-remote --tags origin <tag>`). Not pushed → leave pending, report.
   - Probe `gh release view <tag>` first (idempotency — `gh release create` fails on an existing release), then create via `createGithubRelease`, reusing the changelog-section extraction currently private in `extractChangelogSection()` for notes.
   - Update the entry to `'created'` and `saveReleasesRecord()`.
4. **Skill sequence** — ship-path skills append `metta release sync-github` after the `--follow-tags` push; `/metta-release` (on-demand) does the same, satisfying the "on-demand keeps working with fixed sequencing" scenario.
5. **Guard/mint** — `sync-github` is added to `BLOCKED_TWO_WORD` under `release` in `.claude/hooks/metta-guard-bash.mjs` (Tier-2 scope key `release:sync-github`), minted alongside `release:cut` for `metta-release` and the ship-path skills in `metta-session-mint.mjs`, plus the `workflow-primer.ts` SYNC lists and their seam tests. Fork-tier ship skills get it free via the existing trusted-caller acceptance for Tier-2 subs (guard lines 881–883).

## Pros

- **Structurally impossible race** — `cut()` contains no gh call at all, so "gh before tag push" cannot recur by construction; strongest possible satisfaction of the sequencing requirement's "structurally impossible" scenario.
- **Idempotent, single reconciliation point** — `sync-github` can be re-run safely after any partial failure (push succeeded but gh was down, gh unauthenticated, network blip). The warn-and-continue posture gets a real remedy: "run `metta release sync-github`" instead of a hand-typed `gh release create`.
- **Self-healing** — a release whose gh step failed on one ship is picked up on the next ship's sync automatically; no releases silently stay unpublished.
- **Clean cut semantics** — `cut()` becomes purely local (commit + tag), which matches its documented "never pushes" contract better than the current embedded gh call.
- **Record as ledger** — the releases record already exists and is the natural source of truth for "what was released"; the approach reuses it rather than inventing a new state file.

## Cons

- **The pending→created write fights the release commit.** This is the structural flaw. `releases.yaml` is committed inside `cut()` (`chore(release): X`, release-pipeline.ts:474–490) and pushed with the authorized main push. `sync-github` then mutates `releases.yaml` *after* that push. Every resolution is bad:
  - Leave it uncommitted → dirty tracked file on main, which **fails the next cut's `clean-tree` step** (release-pipeline.ts:273–287) — the mechanism breaks its own pipeline.
  - Commit it → a stray `chore` commit on main needing a **second push**, which the spec forbids ("no additional push is issued without user confirmation").
  - Move status to a `.metta/` side file → the record is no longer the ledger; the approach's core premise (record store as reconciliation source) evaporates, and a new state file + schema appears anyway.
- **The pending flag is derived state.** Whether a GitHub release is missing is already fully determined by `releases.yaml` entries + `git ls-remote` + `gh release view`. Persisting it duplicates a truth two systems already hold, with the usual drift risk (flag says pending, release exists; flag says created, release was deleted).
- **Self-healing crosses the change's explicit scope boundary.** intent.md Out of Scope: "Retroactively repairing v0.5.0/v0.6.0 GitHub releases — historical release records are not modified." A full-record scan would (a) try to publish every backfilled historical entry and (b) rewrite historical entries' status — both sides of that boundary. Constraining the scan to "the entry just cut" salvages scope compliance but deletes the reconciliation/self-healing pros, leaving only the machinery.
- **More machinery than the requirement needs.** The spec asks only that the gh step run after the push. A stateless post-push publish step (skill-side `gh release create`, or a tag-scoped command) meets every scenario with zero schema/state changes.
- **Guard/mint surface** — a new Tier-2 subcommand touches the guard block map, the mint scope map, the `workflow-primer.ts` SYNC lists, and their seam tests. Not hard, but it is the third hook-surface delta this change already carries for `release:cut`.
- **`--github` flag semantics change** for direct human CLI users — the documented immediate-publish behavior of `release cut --github` silently becomes record-only.

## Complexity

**Medium-high — the largest of the candidate approaches.** Touched: `src/schemas/releases-record.ts` (schema field), `src/release/release-pipeline.ts` (gh step removal + new `syncGithub()` + notes-extraction exposure + a remote-tag check helper), `src/cli/commands/release.ts` (new subcommand, `--github` retirement), both guard/mint hooks + `workflow-primer.ts` SYNC lists, six-plus skill templates. Test surface (1:1 ratio convention): `schemas-releases-record.test.ts` (field + old-record compat), `release-pipeline.test.ts` (cut no longer calls gh; pending written), a new sync suite (tag-not-pushed, gh absent/unauthenticated/exists-already/create-fails, record update, idempotent re-run — each needing injected `GhExec` and a git-remote seam that does not exist today), `cli-release.test.ts`, guard/mint seam tests, grep-assert skill tests. The dirty-tree interaction (con #1) additionally forces a design decision that no amount of tests makes clean.

## Fit

- **"No second cut path"** — technically satisfied: `syncGithub()` lives on `ReleasePipeline` and cutting still goes only through `cut()`. The gh step is relocated, not duplicated.
- **"Out of scope: retroactive repair"** — **violated as specified.** The approach's advertised self-healing is precisely the retroactive repair the intent excludes, and status stamping "modifies historical release records," which the intent names verbatim as out of scope. A latest-entry-only restriction restores fit but guts the approach's differentiator.
- **Sequencing requirement** — fully satisfied, strongest of the options.
- **Push discipline** — the status-update write pressures a second push (see Cons); the stateless variants have no such pressure.
- **Existing patterns** — record-store round-trips and Zod-validated writes match house style; a post-push mutation of a file the release commit just froze does not match anything in the codebase.

## Verdict

Not recommended in this form. The approach's two selling points cancel against the change's own constraints: the pending-status write lands after the release commit is pushed, so it either dirties main (breaking the next cut's clean-tree gate), demands a second unconfirmed push (spec-forbidden), or retreats into a side state file that abandons the record-as-ledger premise; and the self-healing full-record scan is exactly the retroactive repair the intent declares out of scope. The pending flag itself is redundant derived state — git tags plus the GitHub API already answer "what is unpublished" — so the schema change and record semantics buy nothing a stateless check does not. What is worth keeping from this exploration: moving the gh call out of `cut()` entirely (making the race structurally impossible) and giving the post-push publish step an idempotent, re-runnable form. Both are achievable with a stateless, tag-scoped publish step (skill-side `gh release create` against the just-pushed tag, or a minimal `release publish-github <tag>` that probes-then-creates) with no schema change, no record mutation, and a far smaller guard and test surface — that direction should be preferred over the deferred-publish record.
