# UAT: roadmap-feature

- **Change**: roadmap-feature
- **Generated**: 2026-07-26
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
Do not edit this document to make a step pass.

## Acceptance steps

### US-1: View the ordered roadmap

*Independent test:* Running `metta roadmap` (with and without `--json`) against a populated `spec/roadmap.md` prints every entry in order with position, slug, resolved backlog title, and note, performs no writes, and exits 0.

#### Step 1.1
- **Setup**: a `spec/roadmap.md` with three entries referencing existing backlog items
- **Do**: I run `metta roadmap` (Run: `metta roadmap`)
- **Observe**: the entries are listed in roadmap order with position, slug, title resolved from the backlog item, and note, and no file is modified.
- [ ] Pass

#### Step 1.2
- **Setup**: the same roadmap
- **Do**: I run `metta roadmap --json` (Run: `metta roadmap --json`)
- **Observe**: the same ordered data is emitted as JSON, consistent with the global `--json` flag behavior of other commands.
- [ ] Pass

#### Step 1.3
- **Setup**: a roadmap entry whose backlog item was deleted from `spec/backlog/` after being added
- **Do**: I run `metta roadmap` (Run: `metta roadmap`)
- **Observe**: the entry is surfaced as dangling in the view and the command does not crash.
- [ ] Pass

#### Step 1.4
- **Setup**: I am on a non-main branch
- **Do**: I run the read-only `metta roadmap` view (Run: `metta roadmap`)
- **Observe**: no branch guard fires and no write occurs.
- [ ] Pass

### US-2: Add a backlog item to the roadmap

*Independent test:* `metta roadmap add` appends a valid backlog slug (with optional note) to the end of `spec/roadmap.md` and auto-commits it, while unknown slugs and duplicates are rejected with the standard JSON error envelope and exit code 4.

#### Step 2.1
- **Setup**: a backlog item `spec/backlog/foo.md` exists and is not on the roadmap
- **Do**: I run `metta roadmap add foo --note "after auth"` (Run: `metta roadmap add foo --note "after auth"`)
- **Observe**: the entry is appended at the end of the roadmap with its note, and `spec/roadmap.md` is auto-committed.
- [ ] Pass

#### Step 2.2
- **Setup**: the slug `nope` does not exist in `spec/backlog/` (checked via `BacklogStore.exists`)
- **Do**: I run `metta roadmap add nope` (Run: `metta roadmap add nope`)
- **Observe**: the command fails with the JSON envelope `{error: {code, type, message}}` with `type: 'not_found'` and exit code 4, and the roadmap file is unchanged.
- [ ] Pass

#### Step 2.3
- **Setup**: slug `foo` is already on the roadmap
- **Do**: I run `metta roadmap add foo` (Run: `metta roadmap add foo`)
- **Observe**: the command is rejected as a duplicate (`type: 'duplicate_entry'`, exit code 4) and the roadmap is unchanged.
- [ ] Pass

#### Step 2.4
- **Setup**: I am on a branch other than main and do not pass `--on-branch`
- **Do**: I run `metta roadmap add foo` (Run: `metta roadmap add foo`, `backlog add`)
- **Observe**: the branch guard rejects the operation (`type: 'branch_guard'`), matching `backlog add` behavior.
- [ ] Pass

### US-3: Reorder the roadmap non-interactively

*Independent test:* `metta roadmap reorder` rewrites `spec/roadmap.md` only when the arguments are an exact permutation of the current roadmap slugs; any missing, extra, or duplicated slug is rejected with exit code 4 and the file is left byte-for-byte untouched.

#### Step 3.1
- **Setup**: the roadmap contains slugs `a`, `b`, `c` in that order
- **Do**: I run `metta roadmap reorder c a b` (Run: `metta roadmap reorder c a b`)
- **Observe**: the roadmap is rewritten in the new order and auto-committed.
- [ ] Pass

#### Step 3.2
- **Setup**: the roadmap contains `a`, `b`, `c`
- **Do**: I run `metta roadmap reorder c a` (an omission) or `metta roadmap reorder c a b d` (an addition) or `metta roadmap reorder a a b` (a duplicate) (Run: `metta roadmap reorder c a`, `metta roadmap reorder c a b d`)
- **Observe**: each invocation fails with the JSON error envelope (`type: 'invalid_reorder'`) and exit code 4, and no partial write occurs — `spec/roadmap.md` is unchanged.
- [ ] Pass

#### Step 3.3
- **Setup**: I am on a non-main branch without `--on-branch`
- **Do**: I run `metta roadmap reorder ...` (Run: `metta roadmap reorder ...`)
- **Observe**: the branch guard rejects the mutation before any validation or write.
- [ ] Pass

### US-4: Activate the next roadmap item into a change

*Independent test:* `metta roadmap next` resolves the top entry's backlog item, hands off through the same activation path as `backlog promote` (the `metta propose "<title>"` handoff), removes the entry from the roadmap, and auto-commits the updated `spec/roadmap.md`.

#### Step 4.1
- **Setup**: a roadmap whose top entry references an existing backlog item
- **Do**: I run `metta roadmap next` (Run: `metta roadmap next`, `backlog promote`)
- **Observe**: the backlog item is resolved and activated via the exact same path `backlog promote` uses, and the entry is removed from the roadmap so the second entry becomes the new top.
- [ ] Pass

#### Step 4.2
- **Setup**: the roadmap is empty
- **Do**: I run `metta roadmap next` (Run: `metta roadmap next`)
- **Observe**: the command is a friendly no-op: `{"next": null}` in JSON mode, an informative message in text mode, and exit code 0.
- [ ] Pass

#### Step 4.3
- **Setup**: I am on a non-main branch without `--on-branch`
- **Do**: I run `metta roadmap next` (Run: `metta roadmap next`)
- **Observe**: the branch guard rejects the mutation and the roadmap is unchanged.
- [ ] Pass

### US-5: AI orchestrator answers "what next?" from the roadmap

*Independent test:* With no active change and a populated roadmap, an orchestrator session can read the ordered queue via the unguarded `metta roadmap` view and drive activation of the top entry through the `/metta-roadmap` skill without ever invoking a mutating CLI form directly.

#### Step 5.1
- **Setup**: no change is active in `spec/changes/` and the roadmap has entries
- **Do**: the orchestrator routes via `/metta-next` (Run: `metta roadmap`)
- **Observe**: it can determine the next feature from the roadmap's top entry (via the read-only `metta roadmap` view, which is on the unguarded read-only pattern) rather than asking the user to pick from the unordered backlog.
- [ ] Pass

#### Step 5.2
- **Setup**: the orchestrator decides to activate the top entry
- **Do**: it proceeds (Run: `metta roadmap next`)
- **Observe**: it does so through the `/metta-roadmap` skill (which mints the session credential), never by calling `metta roadmap next` directly.
- [ ] Pass

#### Step 5.3
- **Setup**: the roadmap is empty and no change is active
- **Do**: the orchestrator checks the roadmap
- **Observe**: it receives `{"next": null}` / an empty ordered list and can cleanly fall back to other routing (e.g. backlog or user input) with exit code 0.
- [ ] Pass

### US-6: Mutating roadmap operations are guard-protected for AI sessions

*Independent test:* From an AI session without a valid session credential, the guard hook blocks `metta roadmap add/reorder/next` Bash calls, while bare `metta roadmap` passes the unguarded read-only pattern; invoking `/metta-roadmap` mints the credential and permits the wrapped mutation.

#### Step 6.1
- **Setup**: an AI orchestrator session with no valid credential at `.metta/scratch/skill-session.token`
- **Do**: it attempts a direct Bash call to `metta roadmap add`, `metta roadmap reorder`, or `metta roadmap next` (Run: `metta roadmap add`, `metta roadmap reorder`)
- **Observe**: the `metta-guard-bash` hook blocks the call via the Tier 2 allowlist entries.
- [ ] Pass

#### Step 6.2
- **Setup**: the same session
- **Do**: it runs the bare read-only `metta roadmap` view (Run: `metta roadmap`, `backlog list/show`)
- **Observe**: the call is permitted under the unguarded read-only pattern (like `backlog list/show`).
- [ ] Pass

#### Step 6.3
- **Setup**: the `/metta-roadmap` skill is invoked
- **Do**: the skill mints the session credential and issues the wrapped mutating command
- **Observe**: the guard authorizes it, mirroring the existing `metta-backlog` skill flow, and existing backlog/changes guard entries remain untouched.
- [ ] Pass

## Additional scenarios

#### Step 7.1: Entries round-trip through format and parse in order
- **Setup**: a roadmap containing entries `auth-refactor` (note "after schema freeze") and `dark-mode` (no note) in that order
- **Do**: the store writes `spec/roadmap.md` and then reads it back
- **Observe**: the parsed result is an ordered list of two entries with `auth-refactor` first (carrying its note verbatim) and `dark-mode` second, and the parsed data validates against the roadmap Zod schema
- **Machine-verified** — summary.md references "Entries round-trip through format and parse in order"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.2: Missing roadmap file reads as an empty roadmap
- **Setup**: `spec/roadmap.md` does not exist in the project
- **Do**: `RoadmapStore` lists the roadmap
- **Observe**: it returns an empty ordered list without throwing and without creating the file
- **Machine-verified** — summary.md references "Missing roadmap file reads as an empty roadmap"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.3: Unsafe slug is rejected at the store boundary
- **Setup**: a caller passes the slug `../etc/passwd` to a `RoadmapStore` method
- **Do**: the method executes
- **Observe**: `assertSafeSlug` throws before any file read or write occurs, and `spec/roadmap.md` is untouched
- **Machine-verified** — summary.md references "Unsafe slug is rejected at the store boundary"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.4: Populated roadmap listed in order
- **Setup**: `spec/roadmap.md` contains three entries referencing existing backlog items
- **Do**: I run `metta roadmap` (Run: `metta roadmap`)
- **Observe**: all three entries print in roadmap order with position, slug, title resolved from the backlog item, and note, no file is modified, and the exit code is 0
- **Machine-verified** — summary.md references "Populated roadmap listed in order"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.5: JSON view mirrors the text view
- **Setup**: the same three-entry roadmap
- **Do**: I run `metta roadmap --json` (Run: `metta roadmap --json`)
- **Observe**: the output is a JSON document containing the same three entries in the same order, each with `position`, `slug`, `title`, and `note` fields, consistent with the global `--json` flag behavior of other commands
- **Machine-verified** — summary.md references "JSON view mirrors the text view"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.6: Read-only view runs on any branch without a guard
- **Setup**: I am on a branch other than the configured main branch
- **Do**: I run `metta roadmap` (Run: `metta roadmap`)
- **Observe**: no branch guard fires, no write occurs, and the command exits 0
- **Machine-verified** — summary.md references "Read-only view runs on any branch without a guard"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.7: Empty roadmap renders a friendly empty state
- **Setup**: `spec/roadmap.md` is absent or contains no entries
- **Do**: I run `metta roadmap` and `metta roadmap --json` (Run: `metta roadmap`, `metta roadmap --json`)
- **Observe**: text mode prints an informative empty-roadmap message, JSON mode emits an empty ordered list, and both exit 0
- **Machine-verified** — summary.md references "Empty roadmap renders a friendly empty state"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.8: Deleted backlog item shows as dangling
- **Setup**: a roadmap entry `old-idea` whose backlog file `spec/backlog/old-idea.md` was deleted after the entry was added
- **Do**: I run `metta roadmap` (Run: `metta roadmap`)
- **Observe**: the view lists `old-idea` at its position marked as dangling instead of crashing, the remaining entries render normally with resolved titles, and the exit code is 0
- **Machine-verified** — summary.md references "Deleted backlog item shows as dangling"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.9: Dangling flag present in JSON output
- **Setup**: the same roadmap with the dangling `old-idea` entry
- **Do**: I run `metta roadmap --json` (Run: `metta roadmap --json`)
- **Observe**: the `old-idea` entry object carries `dangling: true` while entries with resolvable backlog items do not report themselves as dangling
- **Machine-verified** — summary.md references "Dangling flag present in JSON output"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.10: Valid slug appended with a note and auto-committed
- **Setup**: a backlog item `spec/backlog/foo.md` exists and `foo` is not on the roadmap
- **Do**: I run `metta roadmap add foo --note "after auth"` on the main branch (Run: `metta roadmap add foo --note "after auth"`)
- **Observe**: the entry is appended at the last position of `spec/roadmap.md` with the note "after auth", the file is auto-committed via `autoCommitFile`, and the command exits 0
- **Machine-verified** — summary.md references "Valid slug appended with a note and auto-committed"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.11: Unknown backlog slug is rejected as not_found
- **Setup**: the slug `nope` does not exist in `spec/backlog/`
- **Do**: I run `metta roadmap add nope --json` (Run: `metta roadmap add nope --json`)
- **Observe**: the command emits `{error: {code, type, message}}` with `type: 'not_found'` and exits with code 4, and `spec/roadmap.md` is byte-for-byte unchanged
- **Machine-verified** — summary.md references "Unknown backlog slug is rejected as not_found"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.12: Duplicate roadmap entry is rejected
- **Setup**: slug `foo` is already on the roadmap
- **Do**: I run `metta roadmap add foo --json` (Run: `metta roadmap add foo --json`)
- **Observe**: the command emits the error envelope with `type: 'duplicate_entry'` and exits with code 4, and the roadmap is unchanged
- **Machine-verified** — summary.md references "Duplicate roadmap entry is rejected"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.13: Full permutation rewrites the order
- **Setup**: the roadmap contains slugs `a`, `b`, `c` in that order
- **Do**: I run `metta roadmap reorder c a b` on the main branch (Run: `metta roadmap reorder c a b`)
- **Observe**: `spec/roadmap.md` is rewritten with `c` first, `a` second, `b` third, each entry keeps its existing note, the file is auto-committed, and the command exits 0
- **Machine-verified** — summary.md references "Full permutation rewrites the order"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.14: Omission, addition, and duplicate are each rejected with no partial write
- **Setup**: the roadmap contains `a`, `b`, `c`
- **Do**: I run `metta roadmap reorder c a` (omission), then `metta roadmap reorder c a b d` (addition), then `metta roadmap reorder a a b` (duplicate), each with `--json` (Run: `metta roadmap reorder c a`, `metta roadmap reorder c a b d`)
- **Observe**: each invocation emits the error envelope with `type: 'invalid_reorder'` and exits with code 4, and after all three invocations `spec/roadmap.md` is byte-for-byte identical to its state before the first invocation
- **Machine-verified** — summary.md references "Omission, addition, and duplicate are each rejected with no partial write"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.15: Top entry activated and removed from the queue
- **Setup**: a roadmap whose top entry `foo` references an existing backlog item titled "Foo feature", with `bar` second
- **Do**: I run `metta roadmap next` on the main branch (Run: `metta roadmap next`, `backlog promote foo`)
- **Observe**: the backlog item is resolved via the same activation path as `backlog promote foo` (emitting the `metta propose "Foo feature"` handoff), the `foo` entry is removed so `bar` becomes the top of the roadmap, `spec/roadmap.md` is auto-committed, and the command exits 0
- **Machine-verified** — summary.md references "Top entry activated and removed from the queue"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.16: Empty roadmap is a friendly no-op
- **Setup**: the roadmap has no entries
- **Do**: I run `metta roadmap next --json`, and again without `--json` (Run: `metta roadmap next --json`)
- **Observe**: JSON mode emits `{"next": null}`, text mode prints an informative empty-roadmap message, both exit 0, and no write or commit occurs
- **Machine-verified** — summary.md references "Empty roadmap is a friendly no-op"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.17: Non-main branch blocks each mutation
- **Setup**: I am on branch `feature-x` and do not pass `--on-branch`
- **Do**: I run `metta roadmap add foo --json`, `metta roadmap reorder ... --json`, and `metta roadmap next --json` (Run: `metta roadmap add foo --json`, `metta roadmap reorder ... --json`)
- **Observe**: each command fails with the error envelope with `type: 'branch_guard'` and exit code 4, and `spec/roadmap.md` is unchanged; for `reorder`, the guard rejection occurs before permutation validation
- **Machine-verified** — summary.md references "Non-main branch blocks each mutation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.18: Escape hatch permits a deliberate off-main mutation
- **Setup**: I am on branch `feature-x` and backlog item `foo` exists off-roadmap
- **Do**: I run `metta roadmap add foo --on-branch feature-x` (Run: `metta roadmap add foo --on-branch feature-x`)
- **Observe**: the branch guard passes, the entry is appended, and `spec/roadmap.md` is auto-committed on the current branch
- **Machine-verified** — summary.md references "Escape hatch permits a deliberate off-main mutation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.19: Envelope shape is consistent across failure types
- **Setup**: a project with a populated roadmap
- **Do**: I trigger a not-found `add`, a duplicate `add`, an invalid `reorder`, and an off-main mutation, each with `--json`
- **Observe**: every failure output parses as JSON with a single top-level `error` object containing numeric `code: 4`, one of the `type` values `'not_found'`, `'duplicate_entry'`, `'invalid_reorder'`, or `'branch_guard'`, and a non-empty `message`, and every process exits with code 4
- **Machine-verified** — summary.md references "Envelope shape is consistent across failure types"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.20: Text mode reports the same failures on stderr
- **Setup**: the slug `nope` does not exist in `spec/backlog/`
- **Do**: I run `metta roadmap add nope` without `--json` (Run: `metta roadmap add nope`)
- **Observe**: a human-readable not-found message is written to stderr and the process exits with code 4
- **Machine-verified** — summary.md references "Text mode reports the same failures on stderr"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.21: Command group and store are reachable through standard wiring
- **Setup**: the project is built
- **Do**: `metta roadmap --help` is invoked and `createCliContext()` is called in a test (Run: `metta roadmap --help`)
- **Observe**: the help output lists the `roadmap` command group with its `add`, `reorder`, and `next` subcommands, the context object exposes a `roadmapStore` instance, and `RoadmapStore` is importable from the package root barrel
- **Machine-verified** — summary.md references "Command group and store are reachable through standard wiring"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.22: Backlog behavior is untouched
- **Setup**: the roadmap feature is installed
- **Do**: the existing `metta backlog add/list/show/promote/done` test suite runs (Run: `metta backlog add/list/show/promote/done`)
- **Observe**: all backlog commands behave exactly as before, with no change to promote's propose-handoff activation semantics
- **Machine-verified** — summary.md references "Backlog behavior is untouched"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.23: Uncredentialed AI session is blocked from roadmap mutations
- **Setup**: an AI orchestrator session with no valid credential at `.metta/scratch/skill-session.token`
- **Do**: it issues direct Bash calls `metta roadmap add foo`, `metta roadmap reorder a b`, and `metta roadmap next` (Run: `metta roadmap add foo`, `metta roadmap reorder a b`)
- **Observe**: the `metta-guard-bash` hook blocks each call via the Tier 2 `roadmap` allowlist entries with a rejection pointing at the skill path
- **Machine-verified** — summary.md references "Uncredentialed AI session is blocked from roadmap mutations"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.24: Read-only view passes the guard without a credential
- **Setup**: the same uncredentialed AI session
- **Do**: it runs the bare `metta roadmap` (with or without `--json`) (Run: `metta roadmap`, `backlog list`)
- **Observe**: the guard permits the call under the unguarded read-only pattern, matching how `backlog list` and `backlog show` are treated
- **Machine-verified** — summary.md references "Read-only view passes the guard without a credential"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.25: Existing guard entries are unchanged
- **Setup**: the guard hook with the new roadmap entries
- **Do**: the existing guard test suite exercises `backlog add/done/promote` and `changes abandon` without a credential (Run: `backlog add/done/promote`, `changes abandon`)
- **Observe**: those forms are still blocked exactly as before the roadmap entries were added
- **Machine-verified** — summary.md references "Existing guard entries are unchanged"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.26: Skill invocation mints the credential and the guard authorizes the mutation
- **Setup**: an AI session invokes `/metta-roadmap` and chooses to activate the next feature
- **Do**: the skill's mint hook writes the session credential and the skill issues the wrapped `metta roadmap next` Bash call (Run: `metta roadmap next`)
- **Observe**: the guard authorizes the call via the Tier 2 credential check, mirroring the existing `metta-backlog` skill flow, and the skill echoes the emitted `metta propose "<title>"` handoff to the user
- **Machine-verified** — summary.md references "Skill invocation mints the credential and the guard authorizes the mutation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.27: Skill offers add and reorder against CLI-emitted slugs
- **Setup**: a user invokes `/metta-roadmap` and chooses `add`
- **Do**: the skill gathers the backlog slug (from `metta backlog list --json` output) and optional note, then runs the wrapped `metta roadmap add <slug> [--note <text>]` (Run: `metta backlog list --json`)
- **Observe**: the mutation succeeds through the credentialed path using only slugs emitted by the CLI, and the skill reports the new roadmap position back to the user
- **Machine-verified** — summary.md references "Skill offers add and reorder against CLI-emitted slugs"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.28: Populated roadmap answers routing without user re-litigation
- **Setup**: no change is active in `spec/changes/` and the roadmap lists `foo` at position 1
- **Do**: the orchestrator routes via `/metta-next` and reads `metta roadmap --json` under the unguarded read-only pattern (Run: `metta roadmap --json`)
- **Observe**: it identifies `foo` as the next feature from the top entry and proceeds to activation through the `/metta-roadmap` skill, never invoking a mutating roadmap CLI form directly
- **Machine-verified** — summary.md references "Populated roadmap answers routing without user re-litigation"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 7.29: Empty roadmap yields a clean fallback signal
- **Setup**: the roadmap is empty and no change is active
- **Do**: the orchestrator checks the roadmap via the read-only view and, through the skill, `roadmap next` (Run: `roadmap next`)
- **Observe**: it receives an empty ordered list and `{"next": null}` respectively, both with exit code 0, and cleanly falls back to other routing such as the backlog or user input
- **Machine-verified** — summary.md references "Empty roadmap yields a clean fallback signal"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass
