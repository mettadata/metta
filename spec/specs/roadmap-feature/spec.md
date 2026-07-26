# roadmap-feature

## Requirement: Roadmap persists as a single ordered markdown file managed by RoadmapStore

The roadmap MUST be persisted in exactly one markdown file, `spec/roadmap.md`, with no additional YAML state file. Each roadmap entry MUST consist of a backlog slug reference plus an optional free-text note, and the order of entries in the file MUST be the authoritative execution order. A new `RoadmapStore` class in `src/roadmap/roadmap-store.ts` MUST own all access to this file, modeled on `src/backlog/backlog-store.ts`: its constructor MUST take `specDir`, all file reads and writes MUST go through `StateStore.readRaw`/`StateStore.writeRaw`, and every slug crossing the store boundary MUST be validated with `assertSafeSlug` from `src/util/slug.js`. Formatting and parsing of the file content MUST be pure functions within the module (functional core), with file I/O confined to the store edge (imperative shell). The parsed entry list MUST be validated with a Zod schema (slug matching the safe-slug shape, note optional string) before any parsed data is returned to callers, and `RoadmapStore` writes MUST only serialize data that has passed that schema. Reading a missing `spec/roadmap.md` MUST be treated as an empty roadmap, not an error. A matching test file `test/roadmap/roadmap-store.test.ts` MUST exist to maintain the 1:1 test-to-source ratio.

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

Running `metta roadmap` with no subcommand MUST print the ordered feature list: for each entry, its position, backlog slug, title resolved from the referenced `spec/backlog/<slug>.md` item, and note (when present). The command MUST support the global `--json` flag consistently with other commands, emitting the same ordered data as JSON (an ordered array of entry objects each carrying `position`, `slug`, `title`, and `note`). The view MUST perform no writes, MUST NOT call `assertOnMainBranch`, and MUST exit 0 on success. An empty roadmap MUST render an informative empty-state message in text mode and an empty ordered list in JSON mode, exit code 0. The command group MUST be registered via `registerRoadmapCommand(program)` in `src/cli/commands/roadmap.ts`, following the structure of `src/cli/commands/backlog.ts`.

### Scenario: Populated roadmap listed in order
- GIVEN `spec/roadmap.md` contains three entries referencing existing backlog items
- WHEN I run `metta roadmap`
- THEN all three entries print in roadmap order with position, slug, title resolved from the backlog item, and note, no file is modified, and the exit code is 0

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

When a roadmap entry references a backlog slug that no longer exists in `spec/backlog/` (checked via `BacklogStore.exists` or an equivalent failed `BacklogStore.show` resolution), the status view MUST NOT crash. The entry MUST still be listed at its position, marked as dangling — in text mode with a visible dangling indicator in place of the resolved title, and in JSON mode with a `dangling: true` field on the entry. Dangling entries MUST NOT be silently dropped from the view, and their presence MUST NOT change the exit code from 0.

### Scenario: Deleted backlog item shows as dangling
- GIVEN a roadmap entry `old-idea` whose backlog file `spec/backlog/old-idea.md` was deleted after the entry was added
- WHEN I run `metta roadmap`
- THEN the view lists `old-idea` at its position marked as dangling instead of crashing, the remaining entries render normally with resolved titles, and the exit code is 0

### Scenario: Dangling flag present in JSON output
- GIVEN the same roadmap with the dangling `old-idea` entry
- WHEN I run `metta roadmap --json`
- THEN the `old-idea` entry object carries `dangling: true` while entries with resolvable backlog items do not report themselves as dangling


## Requirement: roadmap add appends an existing backlog item to the end of the queue

`metta roadmap add <backlog-slug>` MUST append a reference to an existing backlog item at the end of the roadmap, with an optional `--note <text>` stored on the entry. Before writing, the command MUST verify the slug exists via `BacklogStore.exists`; a slug not present in `spec/backlog/` MUST be rejected with the JSON error envelope `{error: {code, type, message}}` with `type: 'not_found'` and exit code 4, leaving `spec/roadmap.md` unchanged. A slug already present on the roadmap MUST be rejected with `type: 'duplicate_entry'` and exit code 4, leaving the file unchanged. On success the command MUST auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper and, in JSON mode, MUST report the slug, its assigned position, and the commit outcome (`committed`, `commit_sha`). `BacklogStore` MUST be consumed read-only; `roadmap add` MUST NOT modify any file under `spec/backlog/`.

### Scenario: Valid slug appended with a note and auto-committed
- GIVEN a backlog item `spec/backlog/foo.md` exists and `foo` is not on the roadmap
- WHEN I run `metta roadmap add foo --note "after auth"` on the main branch
- THEN the entry is appended at the last position of `spec/roadmap.md` with the note "after auth", the file is auto-committed via `autoCommitFile`, and the command exits 0

### Scenario: Unknown backlog slug is rejected as not_found
- GIVEN the slug `nope` does not exist in `spec/backlog/`
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


## Requirement: roadmap next activates the top entry through the backlog promote path and pops it

`metta roadmap next` MUST take the first roadmap entry, resolve its backlog item, and hand off to activation via the exact same path `backlog promote` uses — resolving the item with `BacklogStore.show` and emitting the `metta propose "<title>"` handoff — such that any future change to promote's activation semantics automatically applies to `roadmap next`. After a successful handoff, the command MUST remove the top entry from the roadmap so the second entry becomes the new top, and MUST auto-commit the updated `spec/roadmap.md` via `autoCommitFile`. In JSON mode the success output MUST identify the activated slug and include the promote-style handoff message. On an empty roadmap the command MUST be a friendly no-op: it MUST emit `{"next": null}` in JSON mode, an informative message in text mode, exit code 0, and MUST perform no write and no commit.

### Scenario: Top entry activated and removed from the queue
- GIVEN a roadmap whose top entry `foo` references an existing backlog item titled "Foo feature", with `bar` second
- WHEN I run `metta roadmap next` on the main branch
- THEN the backlog item is resolved via the same activation path as `backlog promote foo` (emitting the `metta propose "Foo feature"` handoff), the `foo` entry is removed so `bar` becomes the top of the roadmap, `spec/roadmap.md` is auto-committed, and the command exits 0

### Scenario: Empty roadmap is a friendly no-op
- GIVEN the roadmap has no entries
- WHEN I run `metta roadmap next --json`, and again without `--json`
- THEN JSON mode emits `{"next": null}`, text mode prints an informative empty-roadmap message, both exit 0, and no write or commit occurs


## Requirement: Mutating roadmap operations enforce main-branch and auto-commit discipline

The mutating operations `roadmap add`, `roadmap reorder`, and `roadmap next` MUST each call `assertOnMainBranch` from `src/cli/helpers.ts` against the configured main branch (`config.git.pr_base`, default `main`) before any validation of arguments against roadmap state and before any write, supporting the `--on-branch <name>` escape hatch exactly as `backlog add`/`backlog done` do. A rejected branch check MUST produce the JSON error envelope with `type: 'branch_guard'` and exit code 4, leaving `spec/roadmap.md` unchanged. Successful mutations MUST auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper and report the commit outcome; when git is unavailable or there is nothing to commit, the mutation MUST still succeed and report the not-committed reason, matching `autoCommitFile` semantics. The read-only default view MUST remain exempt from the branch check.

### Scenario: Non-main branch blocks each mutation
- GIVEN I am on branch `feature-x` and do not pass `--on-branch`
- WHEN I run `metta roadmap add foo --json`, `metta roadmap reorder ... --json`, and `metta roadmap next --json`
- THEN each command fails with the error envelope with `type: 'branch_guard'` and exit code 4, and `spec/roadmap.md` is unchanged; for `reorder`, the guard rejection occurs before permutation validation

### Scenario: Escape hatch permits a deliberate off-main mutation
- GIVEN I am on branch `feature-x` and backlog item `foo` exists off-roadmap
- WHEN I run `metta roadmap add foo --on-branch feature-x`
- THEN the branch guard passes, the entry is appended, and `spec/roadmap.md` is auto-committed on the current branch


## Requirement: Roadmap failures use the standard error contract

All roadmap command failures MUST use the existing JSON error envelope `{error: {code, type, message}}` in JSON mode and a human-readable message on stderr in text mode, with exit code 4 for not-found, validation, and branch-guard failures — matching the backlog command group's behavior. The `type` field MUST be one of the established discriminators: `'not_found'` for unknown backlog slugs, `'branch_guard'` for main-branch rejections, and the roadmap-specific `'invalid_reorder'` and `'duplicate_entry'` for reorder and add validation failures. A failing invocation MUST NOT leave a partially written `spec/roadmap.md`.

### Scenario: Envelope shape is consistent across failure types
- GIVEN a project with a populated roadmap
- WHEN I trigger a not-found `add`, a duplicate `add`, an invalid `reorder`, and an off-main mutation, each with `--json`
- THEN every failure output parses as JSON with a single top-level `error` object containing numeric `code: 4`, one of the `type` values `'not_found'`, `'duplicate_entry'`, `'invalid_reorder'`, or `'branch_guard'`, and a non-empty `message`, and every process exits with code 4

### Scenario: Text mode reports the same failures on stderr
- GIVEN the slug `nope` does not exist in `spec/backlog/`
- WHEN I run `metta roadmap add nope` without `--json`
- THEN a human-readable not-found message is written to stderr and the process exits with code 4


## Requirement: Roadmap wiring is additive to the CLI context and barrel exports

The roadmap command group MUST be registered in the CLI entry point via `registerRoadmapCommand(program)` alongside the other `register*Command` calls. `RoadmapStore` MUST be added to the barrel export at `src/index.ts` and exposed as an additive field on `CliContext` via `createCliContext` in `src/cli/helpers.ts`. Existing modules MUST NOT change behavior: `BacklogStore` is consumed read-only (`exists`, `show`) and MUST NOT be modified, and all existing `metta backlog` subcommands MUST keep their current behavior verbatim.

### Scenario: Command group and store are reachable through standard wiring
- GIVEN the project is built
- WHEN `metta roadmap --help` is invoked and `createCliContext()` is called in a test
- THEN the help output lists the `roadmap` command group with its `add`, `reorder`, and `next` subcommands, the context object exposes a `roadmapStore` instance, and `RoadmapStore` is importable from the package root barrel

### Scenario: Backlog behavior is untouched
- GIVEN the roadmap feature is installed
- WHEN the existing `metta backlog add/list/show/promote/done` test suite runs
- THEN all backlog commands behave exactly as before, with no change to promote's propose-handoff activation semantics


## Requirement: Guard hook tiers roadmap forms — mutations Tier 2, status view unguarded

The `.claude/hooks/metta-guard-bash.mjs` hook MUST add the two-word mutating forms `roadmap add`, `roadmap reorder`, and `roadmap next` to the Tier 2 session-tier blocked-forms allowlist (the `BLOCKED_TWO_WORD` table alongside the existing `backlog add/done/promote` entries, with matching `"<sub>:<third>"` scope-key handling), so that from an AI session these Bash calls are blocked unless a valid session credential exists at `.metta/scratch/skill-session.token`. The bare read-only `metta roadmap` view MUST join the unguarded read-only pattern like `backlog list/show`, requiring no credential. Existing backlog and changes guard entries MUST remain untouched. Inline command text MUST never contribute authorization; only the minted session credential authorizes a Tier 2 roadmap mutation.

### Scenario: Uncredentialed AI session is blocked from roadmap mutations
- GIVEN an AI orchestrator session with no valid credential at `.metta/scratch/skill-session.token`
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
