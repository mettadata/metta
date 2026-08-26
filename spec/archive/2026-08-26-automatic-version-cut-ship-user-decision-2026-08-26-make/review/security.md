Verdict: PASS_WITH_WARNINGS

# Security Review: automatic-version-cut-ship-user-decision-2026-08-26-make

Scope reviewed: full `git diff main...HEAD` in this worktree — hooks (both trees), seven skill instruction files (both trees), release CLI/pipeline/schema, install scaffolding, deleted gh edge, tests.

## Authorization (mint-scope widening + guard tables)

- **SKILL_SCOPES widening is correctly scoped.** Only `metta-fix-gap` gained `release:cut` (`.claude/hooks/metta-session-mint.mjs:38`, mirrored at `src/templates/hooks/metta-session-mint.mjs:38`). No other skill's scope changed; `metta-release` keeps `['release:cut']` unchanged. Tokens are per-slug files and the slug is a static frontmatter argv (mint hook lines 98–100), so the scope cannot leak to another skill's credential.
- **Guard classification tables are byte-identical to main except a comment.** The `.claude/hooks/metta-guard-bash.mjs` diff touches only the comment at line 93; `BLOCKED_TWO_WORD`, `ALLOWED_TWO_WORD`, `ALLOWED_BARE`, `BLOCKED_SUBCOMMANDS`, and `SKILL_ENFORCED_SUBCOMMANDS` are unchanged. `release cut` remains Tier-2 blocked; `release status` remains read-only allowed.
- **Ship-path fork skills need no mint change** — the Tier-1 fork identity path (`metta-guard-bash.mjs:881–883`) already authorizes Tier-2 subcommands from a verified `agent_type`, which is why only the two main-session skills (metta-release, metta-fix-gap) appear in `SKILL_SCOPES`. Consistent, no widening beyond need.
- **Template parity verified**: all six ship-path SKILL.md files, metta-release SKILL.md, and both hooks are identical between `.claude/` and `src/templates/`.

## --github stub cannot reach the old publish path

- `src/cli/commands/release.ts:89–95`: `opts.github === true` throws `ReleaseError` before context load, config read, or `ReleasePipeline` construction — no mutation, no bypass.
- The pre-push publish code path no longer exists: `src/release/gh-release.ts` deleted, its export removed from `src/index.ts`, and `ReleasePipeline.cut()` no longer accepts a `github`/`ghExec` option (`src/release/release-pipeline.ts:79–96`). Nothing to bypass into.

## Push safety

- No `--force`, no `--no-verify`, no destructive git ops anywhere in the diff. The only push command instructed anywhere is `git push --follow-tags origin main`, and every skill file explicitly forbids `--force` and a second unconfirmed push.
- `metta-release` skill (step 4) gates its push on fresh per-run `AskUserQuestion` confirmation — good.
- The pipeline itself never pushes (`execFileAsync('git', args)` array-args only, `release-pipeline.ts:150`; tag creation at :505).

## Command injection surfaces

- CLI side is clean: all git invocations use `execFile` with argv arrays; no shell strings, no template-literal command construction.
- Skill side has two instruction-level surfaces, listed under Warnings below (heredoc terminator collision; unvalidated `tag_prefix` interpolated into shell commands).

## Secrets

- No secrets logged or committed. Session token values never appear in skill files; the mint hook writes tokens 0o600 under `.metta/scratch/`. `notes` in the cut JSON is changelog text only. `release status --json` echoes only config booleans/enums.

## Install scaffold

- `src/cli/commands/install.ts:303`: config written with `{ flag: 'wx' }` and errors swallowed — existing config is never overwritten. The new release block is static text (no interpolation), added only when `package.json` exists.

## Critical issues

(none)

## Warnings

- **Heredoc terminator collision in the instructed publish command** — `.claude/skills/metta-release/SKILL.md` step 5 and the `gh publish` bullet of the Post-merge release stage in all six ship-path SKILL.md files (plus `src/templates/` mirrors): notes are fed via `<<'NOTES'`. The quoted delimiter prevents expansion, but if the changelog-derived `notes` string contains a line that is exactly `NOTES`, the heredoc terminates early and the remaining note lines execute as shell commands in the orchestrator's Bash call. Changelog content derives from change names/summaries (semi-attacker-influenceable in a hostile-repo scenario). Recommend instructing skills to write `notes` to a file under `.metta/scratch/` and pass `--notes-file <path>`, or to choose a delimiter guaranteed absent from the notes.
- **`tag_prefix` is unvalidated and the tag is interpolated into shell commands by skills** — `src/schemas/project-config.ts:111` (`tag_prefix: z.string()`, pre-existing) places no character-set constraint; the skills interpolate `<tag>` (= `tag_prefix` + version) into `gh release view <tag>` and `gh release create <tag> --verify-tag --title <tag>`. A hostile `.metta/config.yaml` with metacharacters in `tag_prefix` becomes shell-injection text at publish time (the CLI side is immune via execFile argv). Threat model is limited — a repo writer could edit hooks directly — but a `regex` constraint on `tag_prefix` (e.g. `[A-Za-z0-9._-]*`) and a "quote the tag" instruction would close it cheaply.
- **`on_ship: auto` pushes to origin/main without a fresh per-push confirmation** — schema default (`src/schemas/project-config.ts:113`) and the scaffolded install default are both `auto`, so a merged ship auto-runs `git push --follow-tags origin main`. The skill text frames the user-approved PR merge as the authorizing decision and this is the change's recorded user decision, so it is accepted risk — noted here because the project convention says "No auto-push to remote without explicit user confirmation"; `prompt` mode remains available and fails closed when it cannot ask.
- **fix-gap credential window (informational)** — after `/metta-fix-gap` mints its token, the main session holds `release:cut` authorization for TTL+grace, usable outside the skill's post-merge stage. This is inherent to the Tier-2 model (identical exposure already exists for `finalize`/`complete`) and the widening is the minimum needed; no action required.

Verdict: PASS_WITH_WARNINGS
