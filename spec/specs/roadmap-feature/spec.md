# roadmap-feature

## Requirement: Roadmap persists as a single ordered markdown file managed by RoadmapStore

The roadmap MUST be persisted in exactly one markdown file, `spec/roadmap.md`, with no additional YAML state file. Each roadmap entry MUST consist of a backlog slug reference plus an optional free-text note, and the order of entries in the file MUST be the authoritative execution order. A `RoadmapStore` class in `src/roadmap/roadmap-store.ts` MUST own all access to this file: its constructor MUST take `specDir`, all file reads and writes MUST go through `StateStore.readRaw`/`StateStore.writeRaw`, and every slug crossing the store boundary MUST be validated with `assertSafeSlug` from `src/util/slug.js`. Formatting and parsing of the file content MUST be pure functions within the module (functional core), with file I/O confined to the store edge (imperative shell). The parsed entry list MUST be validated with a Zod schema (slug matching the safe-slug shape, note optional string) before any parsed data is returned to callers, and `RoadmapStore` writes MUST only serialize data that has passed that schema. Reading a missing `spec/roadmap.md` MUST be treated as an empty roadmap, not an error. A matching test file `tests/roadmap-store.test.ts` MUST exist to maintain the 1:1 test-to-source ratio.

### Scenario: Entries round-trip through format and parse in order
- GIVEN a roadmap containing entries `auth-refactor` (note "after schema freeze") and `dark-mode` (no note) in that order
- WHEN the store writes `spec/roadmap.md` and then reads it back
- THEN the parsed result is an ordered list of two entries with `auth-refactor` first (carrying its note verbatim) and `dark-mode` second, and the parsed data validates against the roadmap Zod schema

### Scenario: Missing roadmap file reads as an empty roadmap
- GIVEN `spec/roadmap.md` does not exist in the project
- WHEN `RoadmapStore` lists the roadmap
- THEN it returns an empty ordered list without throwing and without creating the file

### Scenario: Unsafe slug is rejected at the store boundary
- GIVEN a caller passes the slug `../etc/passwd` to a `RoadmapStore` method
- WHEN the method executes
- THEN `assertSafeSlug` throws before any file read or write occurs, and `spec/roadmap.md` is untouched


## Requirement: Default roadmap command is a read-only ordered status view

Running `metta roadmap` with no subcommand MUST print the ordered feature list: for each entry, its position, backlog slug, title resolved via `IssuesStore.show` from the referenced issue file `spec/issues/<slug>.md` (backlog items are issues carrying `backlog: true` frontmatter), and note (when present). The command MUST support the global `--json` flag consistently with other commands, emitting the same ordered data as JSON (an ordered array of entry objects each carrying `position`, `slug`, `title`, and `note`). The view MUST perform no writes, MUST NOT call `assertOnMainBranch`, and MUST exit 0 on success. An empty roadmap MUST render an informative empty-state message in text mode and an empty ordered list in JSON mode, exit code 0. The command group MUST be registered via `registerRoadmapCommand(program)` in `src/cli/commands/roadmap.ts`, following the structure of `src/cli/commands/backlog.ts`.

### Scenario: Populated roadmap listed in order
- GIVEN `spec/roadmap.md` contains three entries referencing existing backlog items
- WHEN I run `metta roadmap`
- THEN all three entries print in roadmap order with position, slug, title resolved from the referenced issue, and note, no file is modified, and the exit code is 0

### Scenario: JSON view mirrors the text view
- GIVEN the same three-entry roadmap
- WHEN I run `metta roadmap --json`
- THEN the output is a JSON document containing the same three entries in the same order, each with `position`, `slug`, `title`, and `note` fields, consistent with the global `--json` flag behavior of other commands

### Scenario: Read-only view runs on any branch without a guard
- GIVEN I am on a branch other than the configured main branch
- WHEN I run `metta roadmap`
- THEN no branch guard fires, no write occurs, and the command exits 0

### Scenario: Empty roadmap renders a friendly empty state
- GIVEN `spec/roadmap.md` is absent or contains no entries
- WHEN I run `metta roadmap` and `metta roadmap --json`
- THEN text mode prints an informative empty-roadmap message, JSON mode emits an empty ordered list, and both exit 0


## Requirement: Dangling entries are surfaced, never fatal

When a roadmap entry references a slug with no issue file in `spec/issues/` (surfaced as a failed `IssuesStore.show` resolution), the status view MUST NOT crash. The entry MUST still be listed at its position, marked as dangling — in text mode with a visible dangling indicator in place of the resolved title, and in JSON mode with a `dangling: true` field on the entry. Dangling entries MUST NOT be silently dropped from the view, and their presence MUST NOT change the exit code from 0.

### Scenario: Deleted backlog item shows as dangling
- GIVEN a roadmap entry `old-idea` whose issue file `spec/issues/old-idea.md` was deleted after the entry was added
- WHEN I run `metta roadmap`
- THEN the view lists `old-idea` at its position marked as dangling instead of crashing, the remaining entries render normally with resolved titles, and the exit code is 0

### Scenario: Dangling flag present in JSON output
- GIVEN the same roadmap with the dangling `old-idea` entry
- WHEN I run `metta roadmap --json`
- THEN the `old-idea` entry object carries `dangling: true` while entries with resolvable backlog items do not report themselves as dangling


## Requirement: roadmap add appends an existing backlog item to the end of the queue

`metta roadmap add <backlog-slug>` MUST append a reference to an existing backlog item at the end of the roadmap, with an optional `--note <text>` stored on the entry. Before writing, the command MUST verify the slug exists via `IssuesStore.exists`; a slug with no issue file `spec/issues/<slug>.md` MUST be rejected with the JSON error envelope `{error: {code, type, message}}` with `type: 'not_found'` and exit code 4, leaving `spec/roadmap.md` unchanged. A slug already present on the roadmap MUST be rejected with `type: 'duplicate_entry'` and exit code 4, leaving the file unchanged. On success the command MUST auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper and, in JSON mode, MUST report the slug, its assigned position, and the commit outcome (`committed`, `commit_sha`). `IssuesStore` MUST be consumed read-only; `roadmap add` MUST NOT modify any file under `spec/issues/`.

### Scenario: Valid slug appended with a note and auto-committed
- GIVEN a backlog item `spec/issues/foo.md` exists and `foo` is not on the roadmap
- WHEN I run `metta roadmap add foo --note "after auth"` on the main branch
- THEN the entry is appended at the last position of `spec/roadmap.md` with the note "after auth", the file is auto-committed via `autoCommitFile`, and the command exits 0

### Scenario: Unknown backlog slug is rejected as not_found
- GIVEN no issue file `spec/issues/nope.md` exists
- WHEN I run `metta roadmap add nope --json`
- THEN the command emits `{error: {code, type, message}}` with `type: 'not_found'` and exits with code 4, and `spec/roadmap.md` is byte-for-byte unchanged

### Scenario: Duplicate roadmap entry is rejected
- GIVEN slug `foo` is already on the roadmap
- WHEN I run `metta roadmap add foo --json`
- THEN the command emits the error envelope with `type: 'duplicate_entry'` and exits with code 4, and the roadmap is unchanged


## Requirement: roadmap reorder accepts only a complete non-interactive permutation

`metta roadmap reorder <slug...>` MUST be non-interactive: the caller passes the complete new order as explicit positional arguments, and the command MUST NOT prompt. The arguments MUST be validated as an exact permutation of the current roadmap slugs — the same set with no omissions, no additions, and no duplicated arguments. Any violation MUST be rejected with the JSON error envelope with `type: 'invalid_reorder'` and exit code 4, and the command MUST NOT perform a partial write: `spec/roadmap.md` MUST only be rewritten after permutation validation passes, so a rejected invocation leaves the file byte-for-byte untouched. Each entry MUST retain its note across a reorder. On success the command MUST rewrite the file in the given order and auto-commit it via `autoCommitFile`.

### Scenario: Full permutation rewrites the order
- GIVEN the roadmap contains slugs `a`, `b`, `c` in that order
- WHEN I run `metta roadmap reorder c a b` on the main branch
- THEN `spec/roadmap.md` is rewritten with `c` first, `a` second, `b` third, each entry keeps its existing note, the file is auto-committed, and the command exits 0

### Scenario: Omission, addition, and duplicate are each rejected with no partial write
- GIVEN the roadmap contains `a`, `b`, `c`
- WHEN I run `metta roadmap reorder c a` (omission), then `metta roadmap reorder c a b d` (addition), then `metta roadmap reorder a a b` (duplicate), each with `--json`
- THEN each invocation emits the error envelope with `type: 'invalid_reorder'` and exits with code 4, and after all three invocations `spec/roadmap.md` is byte-for-byte identical to its state before the first invocation


## Requirement: roadmap next activates the top entry with a propose handoff and pops it

`metta roadmap next` MUST walk the roadmap from the first entry, resolve each entry's backlog item via `IssuesStore.show`, and activate the first entry whose issue resolves, emitting the `metta propose "<title>"` activation handoff built by the `buildPromoteHandoff` helper in `src/cli/promote-handoff.ts`, of which `roadmap next` is the sole consumer. This activation path is deliberately decoupled from `backlog promote`, which performs zero writes and independently emits a `/metta-fix-issues <slug>` handoff.
Dangling entries — entries whose `IssuesStore.show` resolution fails because `spec/issues/<slug>.md` does not exist — MUST be skipped, not fatal. This formally supersedes ADR-4's fail-stop mandate: the command MUST NOT fail with `type: 'not_found'` and exit code 4 when it encounters a dangling entry, and the previous fail-stop behavior MUST NOT remain in any code path. For each dangling entry skipped, the command MUST emit a warning naming that entry's slug and the available remedies (`metta roadmap remove <slug>`, or restoring `spec/issues/<slug>.md`) — one warning per skipped entry.
The skip MUST be non-destructive by default: skipped dangling entries MUST remain in `spec/roadmap.md` at their positions, and only the activated entry MUST be removed from the roadmap on success. When the opt-in `--prune` flag is passed, the command MUST additionally remove the skipped dangling entries in the same write and the same auto-commit of `spec/roadmap.md` as the activated entry's removal — never as a separate write or commit. Successful activation MUST auto-commit the updated `spec/roadmap.md` via `autoCommitFile`, and in JSON mode the success output MUST identify the activated slug and include the `metta propose "<title>"` handoff message.
When the roadmap is empty, or when every entry is dangling, the command MUST be a non-error no-op: exit code 0, no write, no commit, and clear guidance in the output — the empty case MUST emit `{"next": null}` in JSON mode and an informative message in text mode; the all-dangling case MUST emit the per-entry warnings plus guidance on how to proceed (remove or restore the dangling entries) and MUST NOT mutate the roadmap even when `--prune` is passed, since no activation write occurs.
(Traces: US-1, US-4; supersedes ADR-4.)

### Scenario: Dangling head is skipped and the first healthy entry activates
- GIVEN the top roadmap entry `ghost` has no issue file `spec/issues/ghost.md` and the second entry `foo` references an existing backlog item titled "Foo feature"
- WHEN I run `metta roadmap next` on the main branch
- THEN the command warns about `ghost`, naming the slug and the remedies (`metta roadmap remove ghost` or restoring `spec/issues/ghost.md`), emits the `metta propose "Foo feature"` handoff, removes only the `foo` entry, leaves `ghost` in place at the top of `spec/roadmap.md`, auto-commits, and exits 0

### Scenario: Multiple consecutive dangling entries each warn and all remain
- GIVEN the roadmap's first two entries `ghost-a` and `ghost-b` are both dangling and the third entry `foo` is healthy
- WHEN I run `metta roadmap next` on the main branch
- THEN the output contains one warning for `ghost-a` and one for `ghost-b`, each naming its slug, `foo` is activated and removed, and both `ghost-a` and `ghost-b` remain in `spec/roadmap.md`

### Scenario: --prune removes skipped dangling entries in the same write and commit
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- WHEN I run `metta roadmap next --prune` on the main branch
- THEN `foo` is activated and `ghost-a`, `ghost-b`, and `foo` are all removed from `spec/roadmap.md` in a single write, the file is auto-committed exactly once for the operation, and the command exits 0

### Scenario: All-dangling roadmap is a non-error no-op with guidance
- GIVEN every entry on the roadmap is dangling
- WHEN I run `metta roadmap next --json`
- THEN the command exits 0 with no error envelope, emits the per-entry warnings and clear guidance to remove or restore the dangling entries, and `spec/roadmap.md` is byte-for-byte unchanged with no commit

### Scenario: Empty roadmap is a friendly no-op
- GIVEN the roadmap has no entries
- WHEN I run `metta roadmap next --json`, and again without `--json`
- THEN JSON mode emits `{"next": null}`, text mode prints an informative empty-roadmap message, both exit 0, and no write or commit occurs

## Requirement: Mutating roadmap operations enforce main-branch and auto-commit discipline

The mutating operations `roadmap add`, `roadmap reorder`, `roadmap remove`, and `roadmap next` MUST each call `assertOnMainBranch` from `src/cli/helpers.ts` against the configured main branch (`config.git.pr_base`, default `main`) before any validation of arguments against roadmap state and before any write, supporting the `--on-branch <name>` escape hatch exactly as `backlog add`/`backlog done` do. A rejected branch check MUST produce the JSON error envelope with `type: 'branch_guard'` and exit code 4, leaving `spec/roadmap.md` unchanged. Successful mutations MUST auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper and report the commit outcome; when git is unavailable or there is nothing to commit, the mutation MUST still succeed and report the not-committed reason, matching `autoCommitFile` semantics. The read-only default view MUST remain exempt from the branch check.
(Traces: US-2.)

### Scenario: Non-main branch blocks each mutation
- GIVEN I am on branch `feature-x` and do not pass `--on-branch`
- WHEN I run `metta roadmap add foo --json`, `metta roadmap reorder ... --json`, `metta roadmap remove foo --json`, and `metta roadmap next --json`
- THEN each command fails with the error envelope with `type: 'branch_guard'` and exit code 4, and `spec/roadmap.md` is unchanged; for `reorder` and `remove`, the guard rejection occurs before target validation

### Scenario: Escape hatch permits a deliberate off-main mutation
- GIVEN I am on branch `feature-x` and backlog item `foo` exists off-roadmap
- WHEN I run `metta roadmap add foo --on-branch feature-x`
- THEN the branch guard passes, the entry is appended, and `spec/roadmap.md` is auto-committed on the current branch

## Requirement: Roadmap failures use the standard error contract

All roadmap command failures MUST use the existing JSON error envelope `{error: {code, type, message}}` in JSON mode and a human-readable message on stderr in text mode, with exit code 4 for not-found, validation, and branch-guard failures — matching the backlog command group's behavior. The `type` field MUST be one of the established discriminators: `'not_found'` for unknown backlog slugs on `roadmap add` and for a `roadmap remove` target (position or slug) that matches no roadmap entry, `'branch_guard'` for main-branch rejections, and the roadmap-specific `'invalid_reorder'` and `'duplicate_entry'` for reorder and add validation failures. A dangling entry encountered by `roadmap next` is no longer a failure and MUST NOT produce the error envelope (see the modified `roadmap next` requirement). Failures that do not map to one of those four discriminators MUST fall back to the defensive `'roadmap_error'` type rather than escaping the envelope. A failing invocation MUST NOT leave a partially written `spec/roadmap.md`.
(Traces: US-1, US-2, US-4.)

### Scenario: Envelope shape is consistent across failure types
- GIVEN a project with a populated roadmap
- WHEN I trigger a not-found `add`, a duplicate `add`, an invalid `reorder`, a not-found `remove`, and an off-main mutation, each with `--json`
- THEN every failure output parses as JSON with a single top-level `error` object containing numeric `code: 4`, one of the `type` values `'not_found'`, `'duplicate_entry'`, `'invalid_reorder'`, or `'branch_guard'`, and a non-empty `message`, and every process exits with code 4

### Scenario: Text mode reports the same failures on stderr
- GIVEN no issue file `spec/issues/nope.md` exists
- WHEN I run `metta roadmap add nope` without `--json`
- THEN a human-readable not-found message is written to stderr and the process exits with code 4

### Scenario: Dangling entries no longer surface through the error contract on next
- GIVEN the top roadmap entry is dangling and a healthy entry sits below it
- WHEN I run `metta roadmap next --json`
- THEN the output contains no `error` envelope and the exit code is 0 — the dangling condition is reported via warnings and the skip signal instead

## Requirement: Roadmap wiring is additive to the CLI context and barrel exports

The roadmap command group MUST be registered in the CLI entry point via `registerRoadmapCommand(program)` alongside the other `register*Command` calls. `RoadmapStore` MUST be added to the barrel export at `src/index.ts` and exposed as an additive field on `CliContext` via `createCliContext` in `src/cli/helpers.ts`. Existing modules MUST NOT change behavior: `IssuesStore` is consumed read-only (`exists`, `show`) by the roadmap commands and MUST NOT be modified, and all existing `metta backlog` subcommands MUST keep their current behavior verbatim.

### Scenario: Command group and store are reachable through standard wiring
- GIVEN the project is built
- WHEN `metta roadmap --help` is invoked and `createCliContext()` is called in a test
- THEN the help output lists the `roadmap` command group with its `add`, `reorder`, and `next` subcommands, the context object exposes a `roadmapStore` instance, and `RoadmapStore` is importable from the package root barrel

### Scenario: Backlog behavior is untouched
- GIVEN the roadmap feature is installed
- WHEN the existing `metta backlog add/list/show/promote/done` test suite runs
- THEN all backlog commands behave exactly as before, with `backlog promote` keeping its zero-write `/metta-fix-issues <slug>` handoff semantics


## Requirement: Guard hook tiers roadmap forms — mutations Tier 2, status view unguarded

The `.claude/hooks/metta-guard-bash.mjs` hook MUST add the two-word mutating forms `roadmap add`, `roadmap reorder`, and `roadmap next` to the Tier 2 session-tier blocked-forms allowlist (the `BLOCKED_TWO_WORD` table alongside the existing `backlog add/done/promote` entries, with matching `"<sub>:<third>"` scope-key handling), so that from an AI session these Bash calls are blocked unless a valid per-skill session credential under `.metta/scratch/skill-session/` covers them. The bare read-only `metta roadmap` view MUST join the unguarded read-only pattern like `backlog list/show`, requiring no credential. Existing backlog and changes guard entries MUST remain untouched. Inline command text MUST never contribute authorization; only the minted session credential authorizes a Tier 2 roadmap mutation.

### Scenario: Uncredentialed AI session is blocked from roadmap mutations
- GIVEN an AI orchestrator session with no valid per-skill credential under `.metta/scratch/skill-session/`
- WHEN it issues direct Bash calls `metta roadmap add foo`, `metta roadmap reorder a b`, and `metta roadmap next`
- THEN the `metta-guard-bash` hook blocks each call via the Tier 2 `roadmap` allowlist entries with a rejection pointing at the skill path

### Scenario: Read-only view passes the guard without a credential
- GIVEN the same uncredentialed AI session
- WHEN it runs the bare `metta roadmap` (with or without `--json`)
- THEN the guard permits the call under the unguarded read-only pattern, matching how `backlog list` and `backlog show` are treated

### Scenario: Existing guard entries are unchanged
- GIVEN the guard hook with the new roadmap entries
- WHEN the existing guard test suite exercises `backlog add/done/promote` and `changes abandon` without a credential
- THEN those forms are still blocked exactly as before the roadmap entries were added


## Requirement: The /metta-roadmap skill wraps all mutating roadmap operations

A new skill directory `.claude/skills/metta-roadmap/` MUST provide the `/metta-roadmap` skill, mirroring the existing `metta-backlog` skill: its frontmatter MUST register the `metta-session-mint.mjs` PreToolUse hook so invoking the skill mints the Tier 2 session credential, and its body MUST route the user (via `AskUserQuestion`) to the roadmap operations — the read-only status view plus the wrapped mutating forms `add`, `reorder`, and `next`. AI orchestrators MUST perform roadmap mutations only through this skill, never by calling the mutating CLI forms directly. The skill MUST use only slugs emitted by the CLI (e.g. parsed from `metta roadmap --json` or `metta backlog list --json`) rather than inventing them, and MUST echo back the CLI's output — including the `metta propose "<title>"` handoff emitted by `roadmap next`. The skill files MUST be copied to `dist/` at build time per the existing template convention, never inlined as string literals.

### Scenario: Skill invocation mints the credential and the guard authorizes the mutation
- GIVEN an AI session invokes `/metta-roadmap` and chooses to activate the next feature
- WHEN the skill's mint hook writes the session credential and the skill issues the wrapped `metta roadmap next` Bash call
- THEN the guard authorizes the call via the Tier 2 credential check, mirroring the existing `metta-backlog` skill flow, and the skill echoes the emitted `metta propose "<title>"` handoff to the user

### Scenario: Skill offers add and reorder against CLI-emitted slugs
- GIVEN a user invokes `/metta-roadmap` and chooses `add`
- WHEN the skill gathers the backlog slug (from `metta backlog list --json` output) and optional note, then runs the wrapped `metta roadmap add <slug> [--note <text>]`
- THEN the mutation succeeds through the credentialed path using only slugs emitted by the CLI, and the skill reports the new roadmap position back to the user


## Requirement: Orchestrators answer "what next?" from the roadmap top entry

When no change is active in `spec/changes/` and the roadmap has entries, an AI orchestrator session (e.g. routing via `/metta-next`) MUST be able to determine the next planned feature from the roadmap's top entry using the unguarded read-only `metta roadmap` view, without asking the user to pick from the unordered backlog. To activate that entry, the orchestrator MUST proceed through the `/metta-roadmap` skill rather than calling `metta roadmap next` directly. When the roadmap is empty and no change is active, the orchestrator MUST receive a clean empty signal — an empty ordered list from the view and `{"next": null}` from a skill-wrapped `roadmap next` — with exit code 0, so it can fall back to other routing (backlog or user input) without treating the state as an error.

### Scenario: Populated roadmap answers routing without user re-litigation
- GIVEN no change is active in `spec/changes/` and the roadmap lists `foo` at position 1
- WHEN the orchestrator routes via `/metta-next` and reads `metta roadmap --json` under the unguarded read-only pattern
- THEN it identifies `foo` as the next feature from the top entry and proceeds to activation through the `/metta-roadmap` skill, never invoking a mutating roadmap CLI form directly

### Scenario: Empty roadmap yields a clean fallback signal
- GIVEN the roadmap is empty and no change is active
- WHEN the orchestrator checks the roadmap via the read-only view and, through the skill, `roadmap next`
- THEN it receives an empty ordered list and `{"next": null}` respectively, both with exit code 0, and cleanly falls back to other routing such as the backlog or user input


## Requirement: roadmap remove deletes a targeted entry by position or slug

`metta roadmap remove <position|slug>` MUST delete a single roadmap entry addressed either by its 1-based position or by its slug, backed by a new `RoadmapStore.remove(target)` primitive — closing the lifecycle gap where retiring an entry required hand-editing the CLI-owned `spec/roadmap.md`. When the target matches no entry — a position outside `1..length` or a slug not on the roadmap — the command MUST fail with the JSON error envelope with `type: 'not_found'` and exit code 4 (via a typed discriminator on `RoadmapValidationError` mapped through `mapRoadmapError`), leaving `spec/roadmap.md` byte-for-byte unchanged. On success the store MUST splice the entry and persist through the existing canonical save path (`save` → `RoadmapSchema.parse` → `formatRoadmap`) so remaining entries are renumbered canonically, and the command MUST auto-commit `spec/roadmap.md` via `autoCommitFile`, reporting the removed slug and the commit outcome (`committed`, `commit_sha`) in JSON mode. `roadmap remove` MUST work identically for dangling and healthy entries and MUST NOT read or modify any file under `spec/issues/`.
(Traces: US-2; intent proposal §1.)

### Scenario: Remove by position renumbers through the canonical writer
- GIVEN the roadmap contains entries `a`, `foo`, `c` at positions 1–3
- WHEN I run `metta roadmap remove 2` on the main branch
- THEN the `foo` entry is removed, `spec/roadmap.md` lists `a` at position 1 and `c` at position 2 via the canonical format path, the file is auto-committed, and the command exits 0

### Scenario: Remove by slug deletes the matching entry
- GIVEN the roadmap contains a dangling entry with slug `ghost` (no `spec/issues/ghost.md`)
- WHEN I run `metta roadmap remove ghost` on the main branch
- THEN the `ghost` entry is removed and the file auto-committed even though the referenced issue file does not exist, and nothing under `spec/issues/` is touched

### Scenario: Missing target fails not_found with no write
- GIVEN the roadmap has 3 entries and none has slug `nope`
- WHEN I run `metta roadmap remove nope --json`, and then `metta roadmap remove 9 --json`
- THEN each invocation emits the error envelope with `type: 'not_found'` and exits with code 4, and `spec/roadmap.md` is byte-for-byte unchanged after both


## Requirement: Issue resolution auto-retires referencing roadmap entries

After `metta backlog done <slug>` or `metta fix-issue --remove-issue <slug>` successfully archives an issue to `spec/issues/resolved/<slug>.md`, any roadmap entry referencing that slug MUST be removed from `spec/roadmap.md`, and the roadmap write MUST be included in the same commit as the issue archival (by extending the existing commit path lists — `commitPaths` for `backlog done`, the `git add` list for `fix-issue --remove-issue`), so the archive and the roadmap retirement land atomically and resolving a roadmapped item can never manufacture a dangling entry. When no roadmap entry references the resolved slug, both commands MUST behave exactly as before: no roadmap read side effects on the output, no roadmap write, and no additional commit content. The retirement MUST occur only after the archival itself succeeds — a failed resolution MUST NOT touch the roadmap. Any reporting of the retired roadmap entry in the commands' JSON output MUST be additive only: existing fields MUST be unchanged in name, shape, and meaning so current consumers are unaffected.
Cross-capability note: this narrows the issue-logging requirement "Backlog done resolves through the issue store archive" (which states the auto-commit stages exactly the two archive paths) and extends the fix-issues-command `--remove-issue` commit behavior — in the roadmapped case the commit additionally contains `spec/roadmap.md`; in the non-roadmapped case those specs' scenarios hold verbatim. The exact-two-paths discipline otherwise stands: unrelated dirty files are still never swept in.
(Traces: US-3; intent proposal §3.)

### Scenario: backlog done retires the roadmap entry atomically
- GIVEN an issue `foo` exists at `spec/issues/foo.md` and appears as a roadmap entry
- WHEN I run `metta backlog done foo`
- THEN `spec/issues/resolved/foo.md` exists, `spec/issues/foo.md` is gone, the `foo` roadmap entry is removed, and a single commit contains the archive pair and `spec/roadmap.md`

### Scenario: fix-issue --remove-issue retires the roadmap entry atomically
- GIVEN an issue `bar` exists and appears as a roadmap entry
- WHEN `metta fix-issue --remove-issue bar` runs
- THEN the issue is archived, the `bar` roadmap entry is removed, and `spec/roadmap.md` lands in the same commit as the issue archival

### Scenario: Non-roadmapped resolution is byte-for-byte unchanged behavior
- GIVEN an issue `baz` exists with no referencing roadmap entry
- WHEN I resolve it via `metta backlog done baz`, and (for a second such issue) via `fix-issue --remove-issue`
- THEN `spec/roadmap.md` is not written, the commit contains only the paths those commands commit today, and the command output matches today's contract

### Scenario: JSON reporting of the retirement is additive
- GIVEN a roadmapped issue is resolved via `metta backlog done <slug> --json`
- WHEN the command emits its JSON success output
- THEN every field present in today's output is still present with unchanged name, shape, and meaning, and any retired-roadmap-entry reporting appears only as new additional fields


## Requirement: Skipped dangling entries are machine-detectable from roadmap next output

Because this change removes the exit-4 `not_found` fail-stop that automation could previously use to detect a dangling roadmap head (ADR-4), `metta roadmap next` MUST provide an explicit replacement signal in both output modes. In text mode, the per-entry warnings MUST name each skipped dangling slug on the command's output so scripts can detect dangling state by matching on the slug. In JSON mode, the success output MUST include a field enumerating the skipped dangling slugs in roadmap order (empty when nothing was skipped) and, when `--prune` is used, MUST distinguish which of the skipped entries were pruned. These JSON additions MUST be additive to the existing `roadmap next` success output — existing fields keep their name, shape, and meaning.
(Traces: US-4; intent Impact — replacement signal for automation relying on exit 4.)

### Scenario: JSON output enumerates skipped slugs in order
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above the healthy entry `foo`
- WHEN I run `metta roadmap next --json` on the main branch
- THEN the JSON success output identifies `foo` as activated and contains a field listing exactly `ghost-a` and `ghost-b` in roadmap order as skipped, and the existing activated-slug and handoff fields are unchanged in shape

### Scenario: Nothing skipped yields an empty skip signal
- GIVEN the top roadmap entry is healthy
- WHEN I run `metta roadmap next --json` on the main branch
- THEN the skipped-slugs field is present and empty, and the rest of the success output matches the pre-change contract

### Scenario: Text warnings name every skipped slug for script consumption
- GIVEN dangling entries `ghost-a` and `ghost-b` sit above a healthy entry
- WHEN I run `metta roadmap next` without `--json`
- THEN the command's output contains the literal slugs `ghost-a` and `ghost-b`, one warning line per skipped entry, each including a remedy
