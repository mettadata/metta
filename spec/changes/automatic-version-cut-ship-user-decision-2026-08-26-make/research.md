# Research: automatic-version-cut-ship-user-decision-2026-08-26-make

## Decision: Local-only cut + skill-side verified GitHub publish

### Approaches Considered

1. **Skill-side publish** (selected) — `ReleasePipeline.cut()` becomes purely local (the `'gh'` step and `--github` flag are removed); ship-path skills run the settled sequence themselves: `release status` → derive bump → `release cut --bump <level> --yes` → main push with `--follow-tags` (riding the single authorized push) → `gh release create <tag> --verify-tag --notes-file -` only when `release.github_release: true`, warn-and-continue on any gh failure. See `research-skill-side-publish.md`.
2. **ReleasePipeline phase split** — same local-only `cut()`, plus a new Tier-2 CLI subcommand `metta release publish-github [tag]` wrapping `createGithubRelease` with `tag-on-remote` pre-flight. Rejected as the primary shape: the skills would still have to invoke it at exactly the same post-push point (the CLI is constitutionally barred from pushing, so no CLI-resident step can follow the push in one invocation), giving the same instruction-drift surface **plus** ~60 lines of new CLI, a new mutating guard word, a second mint scope key, primer/seam-test sync across four hook locations, and a breaking `--github` removal error path. Its distinctive benefits (typed degradation, independent retryability) are substantially matched by `--verify-tag` + an idempotent `gh release view` probe in the skill block. See `research-pipeline-split.md`.
3. **Deferred-publish record (`release sync-github`)** — record a `pending` GitHub-release marker in `releases.yaml`, reconcile later. Rejected: the pending→created status write lands after the release commit is pushed, so it either dirties main (breaking the next cut's `clean-tree` gate), demands a second unconfirmed push (spec-forbidden), or retreats to a side state file that abandons its own premise; the self-healing full-record scan is exactly the retroactive repair the intent declares out of scope; and the flag is redundant derived state (`releases.yaml` + `git ls-remote` + `gh release view` already answer "what is unpublished"). See `research-deferred-publish-record.md`.

### Rationale

- **The post-push step can only live with the post-push actor.** The constitution forbids the CLI from pushing, and the push is already skill-side in every ship path. All seven existing remote operations (`git push`, `gh pr create/checks/merge/comment`) are skill-side; `gh release create` is the eighth in an established pattern, not a new category.
- **The structural guarantee is stronger skill-side than the status quo.** Per the gh manual (https://cli.github.com/manual/gh_release_create, accessed 2026-08-26), `gh release create` on a tag missing from the remote does not fail — it **silently creates a wrong tag from default-branch HEAD** (the actual v0.5.0/v0.6.0 corruption mode). `--verify-tag` makes gh abort instead. Removing the `'gh'` step from `cut()` (all three researchers converge on this) makes the in-cut race impossible by construction; `--verify-tag` in the grep-asserted canonical skill sentence closes the mis-ordering case.
- **Smallest TypeScript delta on the one code path that mutates version state.** Pipeline change is a deletion (drop `'gh'` from `MUTATION_STEPS`, lines 509–528, `github`/`ghExec` options) plus one optional additive field: emit the extracted changelog notes in `cut --json` so skills need not re-parse `docs/changelog.md` (kills the only real logic duplication).
- **Guard surface is near zero.** The guard classifies only `metta` invocations; `gh`/`git` pass unguarded. Five of six ship paths are fork-tier and already authorized for Tier-2 `release cut` via the trusted-caller branch; only `metta-fix-gap`'s mint scope needs `release:cut` appended — a delta shared by every approach.
- **Drift risk is mostly sunk cost.** The spec already mandates the 6-skill × 2-tree instruction surface and grep-assert tests for any approach; `tests/skill-uat-ship-gate.test.ts` (canonical byte-identical sentence + ordering asserts) is the direct template.

### Adopted riders (binding for design)

1. `--github` is removed from `release cut` (not silently left intact); the CLI errors with a pointer to the fixed sequence so the broken ordering is unreachable without notice.
2. `--verify-tag` appears in the canonical, grep-asserted skill sentence.
3. `cut --json` gains the extracted release-notes string (reuses the private `extractChangelogSection`; ~5 lines).
4. `/metta-release` (on-demand) gets the same fix in this change: drop `--github`; when `release.github_release: true`, ask for explicit push confirmation, run `git push --follow-tags origin main`, then the same gh block. Its "never pushes" rule relaxes to "pushes only with explicit per-run user confirmation" (this is what the constitution actually requires).
5. The change spec needs two additional MODIFIED deltas for base requirements that currently describe gh as an in-cut step: "Opt-In GitHub Release Publication" and "Graceful Degradation When gh Unavailable".
6. The skill gh block probes `gh release view <tag>` before creating (idempotent re-run; salvaged from approach 3).

### Artifacts Produced

- [Research: skill-side publish](research-skill-side-publish.md)
- [Research: pipeline phase split](research-pipeline-split.md)
- [Research: deferred-publish record](research-deferred-publish-record.md)
