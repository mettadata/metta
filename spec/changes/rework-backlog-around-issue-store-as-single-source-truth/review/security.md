Verdict: PASS_WITH_WARNINGS

Security review of `git diff merge-base(HEAD, main)..HEAD` — scope: path construction from slugs/filenames, YAML parsing of untrusted spec files, guard/mint hook tier assignments, execFile auto-commit paths, fs-rename targets in the migration, and Zod `.strict()` coverage.

## Critical issues

None found.

## Warnings

- `src/cli/commands/backlog.ts:27-43` (`commitPaths`) — auto-commit stages entire directories (`git add spec/issues`, and for migrate also `spec/backlog` + `spec/archive/backlog-legacy`). Any unrelated dirty files under those paths are silently swept into the auto-commit (e.g. a hand-edited issue file gets committed under `chore: add backlog item <slug>`). Not exploitable, but it can commit content the user never intended to record. Fix: stage the specific file(s) the command wrote (`spec/issues/<slug>.md`), as `issue.ts` already does via `autoCommitFile`.
- `src/cli/commands/milestone.ts:79` — same pattern: `git add spec/milestones` stages the whole directory for `milestone create`. Fix: `git add spec/milestones/<slug>.md` (slug is already validated at this point).
- `src/cli/commands/milestone.ts:163-171` and `src/cli/commands/backlog.ts:102-109` — issue/milestone titles and description bodies from spec files are echoed to the terminal verbatim. A malicious spec file (attacker-influenced consumer data per the threat model) can embed ANSI escape sequences to spoof terminal output. This extends a pre-existing pattern rather than introducing it; consider stripping C0/escape bytes at the print edge in a follow-up.

## Notes

- **Guard hook tier assignments verified against the code** (`.claude/hooks/metta-guard-bash.mjs`, byte-identical to `src/templates/hooks/metta-guard-bash.mjs`):
  - `milestone list` / `milestone show` allow-listed (line 44); read-only confirmed in `milestone.ts` — no writes on either path.
  - `milestone create` in `BLOCKED_TWO_WORD` (line 65) with Tier-2 scope key `milestone:create`; `backlog migrate` in `BLOCKED_TWO_WORD` (line 61) with key `backlog:migrate`. Both minted only by `metta-backlog` in `metta-session-mint.mjs:30`.
  - Bare `metta milestone` is NOT in `ALLOWED_BARE` (line 77) and classifies as `unknown` → fail-closed (classify at lines 131-141: no bare-allow, no single-word block match, no third word → `unknown`). Same for any unlisted third word (`milestone close`, etc.).
  - The scope-key derivation at lines 262-265 yields `milestone:create` / `backlog:migrate` for the blocked two-word forms, matching the minted scopes exactly — no over-broad `milestone` or `backlog` key is honored.
- **YAML parsing** (`yaml` 2.8.3, verified empirically against the installed package):
  - Alias-bomb input is rejected by the package's default `maxAliasCount` ("Excessive alias count indicates a resource exhaustion attack") — no override disables it anywhere in the diff.
  - `__proto__:` in frontmatter materializes as an own key (no prototype assignment, no global `Object.prototype` pollution), and the strict schemas then reject it as an unrecognized key. Default core schema — no custom tags, no code execution.
  - Non-mapping frontmatter (scalar/sequence) is rejected before Zod in both `issue-frontmatter.ts:130-136` and `milestones-store.ts:50-52`.
- **Zod `.strict()` coverage**: `IssueFrontmatterSchema` (`src/schemas/issue-frontmatter.ts:14`) and `MilestoneFrontmatterSchema` (`src/schemas/milestone-frontmatter.ts:27`) are both `.strict()`. Every read path validates (`parseIssueFrontmatter` → `validateFields`; `parseMilestone` → `validateFrontmatter`); every write path validates before writing (`applyFrontmatterPatch` validates pre-existing fields AND the post-patch field set, `issue-frontmatter.ts:218,223`; `MilestonesStore.create` validates at `milestones-store.ts:97-103`). The `milestone` frontmatter value itself is constrained to `SLUG_RE`, so a hostile value can never reach a path or shell.
- **Slug validation on path construction**: `MilestonesStore.create/show/exists` and `IssuesStore.show/exists/updateFrontmatter/archive/remove` all call `assertSafeSlug` (shared `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` — no `/`, `.`, or uppercase possible) before any `join()`. CLI-side pre-checks (`issue.ts:37-41` for `--milestone`, `backlog.ts:238-242` for `--change`, `backlog.ts:163/248` before exists) are defense in depth on top of the store asserts. `toSlug`-derived slugs (create/createIdea) are structurally within the safe charset and length.
- **Migration filenames** (`src/backlog/backlog-migrate.ts`): filenames come exclusively from `readdir()` basenames filtered to `.md` — a basename cannot contain a path separator, so `join(issuesDir, file)` / `join(archiveDir, file)` cannot escape `spec/`. Rename targets are fixed at `spec/archive/backlog-legacy/{,done/}` inside `specDir`. Overwrite protection is two-layer: `findCollision` pre-check plus `writeFile(..., { flag: 'wx' })` (`backlog-migrate.ts:165`) — the narrow TOCTOU window between check and write is closed by `wx`. Originals are renamed, never deleted.
- **execFile usage**: all git auto-commit paths (`backlog.ts:31-37`, `milestone.ts:79-81`) use `execFile` with argument vectors — no shell, no interpolation into a command string. Slugs embedded in commit messages are validated before use and are inert as argv elements regardless.
- **Migration partial-failure behavior**: a malformed legacy file (opening `---` with no closing fence) throws mid-loop (`backlog-migrate.ts:78` via `splitFrontmatter`) — already-migrated items are left uncommitted and the command exits 4. Fail-closed and re-runnable (idempotency is derived from the filesystem), so acceptable; noting for operator awareness.
- **`release-pipeline.ts:165-168`** — `isArchivedChangeDir` filter correctly prevents the new non-change `spec/archive/backlog-legacy/` dir from being claimed by `release cut`.
- No secrets, credentials, or token material appear anywhere in the diff; the mint-hook change is scope-list only.
