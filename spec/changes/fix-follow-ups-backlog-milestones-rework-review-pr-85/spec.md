# issue-logging

## ADDED: Requirement: Backlog auto-commits stage only the files the command wrote

Every auto-commit performed by a `metta backlog` write command (`add`, `done`, `promote`, and any other subcommand that writes files and commits) MUST pass only the explicit file paths the command itself created, modified, moved, or archived to `commitPaths` — never a directory pathspec such as `spec/issues` or `spec/issues/resolved`. Files under `spec/issues/` that were dirty before the command ran and were not touched by the command MUST NOT be staged or committed, and MUST remain in their pre-command working-tree state after the command completes. This applies to all three `commitPaths` call sites in `src/cli/commands/backlog.ts` (the `add`, `done`, and promote/frontmatter-update paths).

**Fulfills:** US-1

### Scenario: Unrelated dirty file survives a backlog add
- GIVEN a working tree containing an unrelated modified file `spec/issues/other-issue.md`
- WHEN the user runs `metta backlog add "new item" --new`
- THEN the resulting auto-commit contains only the newly created issue file, and `spec/issues/other-issue.md` remains modified and uncommitted in the working tree

### Scenario: Done and promote stage only their own moved or updated files
- GIVEN an unrelated dirty file exists under `spec/issues/` and a backlogged issue `<slug>` exists
- WHEN the user runs `metta backlog done <slug>` (or `metta backlog promote <slug>` where promote writes frontmatter)
- THEN the auto-commit stages exactly the files the command moved, archived, or updated for `<slug>`, and the unrelated dirty file is absent from the commit

### Scenario: No directory pathspecs at any commitPaths call site
- GIVEN the three `commitPaths` call sites in `src/cli/commands/backlog.ts`
- WHEN any backlog write command executes its auto-commit
- THEN the paths passed to `commitPaths` are explicit file paths (e.g. `spec/issues/<slug>.md`, `spec/issues/resolved/<slug>.md`), and no argument is a bare directory such as `spec/issues`


## MODIFIED: Requirement: Backlog done resolves through the issue store archive

`metta backlog done <slug>` MUST archive the issue through the issue store's standard resolution path: the file MUST be copied to `spec/issues/resolved/<slug>.md` with its frontmatter preserved, and the open file at `spec/issues/<slug>.md` MUST be removed. The command MUST NOT write to `spec/backlog/done/`. The optional `--change <name>` stamp (`**Shipped-in**` metadata) MUST continue to be supported and appended to the archived copy. After completion the entry MUST no longer appear in `metta backlog list`. The auto-commit MUST stage exactly the two file paths the command touched — the removed open file `spec/issues/<slug>.md` and the created archive file `spec/issues/resolved/<slug>.md` — and MUST NOT pass directory pathspecs, so unrelated dirty files under `spec/issues/` are never swept into the commit. (Traces: US-6 of PR #85; intent proposal §3.)

**Fulfills:** US-1

### Scenario: Done moves the issue to resolved and off the backlog
- GIVEN a backlogged issue exists at `spec/issues/<slug>.md` with frontmatter `backlog: true` and `type: idea`
- WHEN the user runs `metta backlog done <slug>`
- THEN `spec/issues/resolved/<slug>.md` exists with the frontmatter (`type: idea`, `backlog: true`) intact, `spec/issues/<slug>.md` is gone, nothing was written under `spec/backlog/done/`, and the slug no longer appears in `metta backlog list`

### Scenario: Shipped-in stamp survives the new archive path
- GIVEN a backlogged issue exists
- WHEN the user runs `metta backlog done <slug> --change some-shipped-change`
- THEN the archived copy at `spec/issues/resolved/<slug>.md` contains the `**Shipped-in**: some-shipped-change` stamp in addition to its preserved frontmatter

### Scenario: Done commits only the archived pair of paths
- GIVEN a backlogged issue `<slug>` and an unrelated modified file `spec/issues/unrelated.md`
- WHEN the user runs `metta backlog done <slug>`
- THEN the auto-commit contains exactly `spec/issues/<slug>.md` (deletion) and `spec/issues/resolved/<slug>.md` (addition), and `spec/issues/unrelated.md` remains dirty and uncommitted


## ADDED: Requirement: Backlog and milestone list renderers sanitize titles

The backlog list renderer (`src/cli/commands/backlog.ts`, title output around line 75) and the milestone issues renderer (`src/cli/commands/milestone.ts`, title output around line 176) MUST strip ANSI escape sequences (including CSI sequences such as `\x1b[31m`) and non-printing control characters (C0 controls other than the renderer's own intentional formatting, plus DEL) from issue titles before printing them to the terminal. Titles consisting solely of ordinary printable text MUST be rendered unchanged. Sanitization MUST apply to the rendered output only — the issue file's frontmatter MUST NOT be modified. Other CLI output surfaces are out of scope for this requirement.

**Fulfills:** US-2

### Scenario: ANSI escape in a backlog title is stripped
- GIVEN a backlogged issue whose frontmatter title contains the ANSI sequence `\x1b[31m` followed by text
- WHEN the user runs the backlog list view
- THEN the rendered line for that issue contains no `\x1b` escape byte and shows only the sanitized printable text

### Scenario: Control characters in a milestone issue title are stripped
- GIVEN an issue assigned to a milestone whose title embeds control characters (e.g. `\x07`, `\x08`)
- WHEN `metta milestone show <slug>` renders the milestone's issue list
- THEN the printed title contains none of the embedded control characters

### Scenario: Plain titles render unchanged
- GIVEN an issue with an ordinary plain-text title
- WHEN either the backlog list or the milestone issues renderer prints it
- THEN the title is displayed byte-for-byte unchanged

### Scenario: Sanitization does not rewrite the issue file
- GIVEN an issue whose frontmatter title contains an ANSI escape sequence
- WHEN the backlog list is rendered
- THEN the issue file on disk is byte-identical to its pre-render state


## ADDED: Requirement: No stale spec/backlog references in generated CLAUDE.md, docs, or guard-edit allowlist

All references to the retired `spec/backlog/` directory store MUST be removed from the surfaces that still carry them. Specifically: (1) the CLAUDE.md Table of Contents emitted by `metta refresh` (`src/cli/commands/refresh.ts`) MUST NOT contain a `spec/backlog/` row — it MUST either omit the backlog row or describe the backlog as the frontmatter view over `spec/issues/`; (2) the five docs files `docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/guide/troubleshooting.md`, and `docs/internals/guard-hooks.md` MUST describe backlog storage as frontmatter over `spec/issues/` and MUST NOT reference a `spec/backlog/` directory store; (3) the guard-edit hook template (`src/templates/hooks/metta-guard-edit.mjs`) MUST NOT include `spec/backlog/` in its allowlisted edit prefixes, so out-of-band `.md` edits under that path are denied. (Cross-capability note: item 1 touches the refresh/CLAUDE.md regeneration surface and item 3 the orchestration guard-edit template; they are specified here because the residue originates from the backlog rework and no multi-H1 delta is supported.)

**Fulfills:** US-3

### Scenario: Refresh emits a TOC without a spec/backlog row
- GIVEN a project using metta with the change applied
- WHEN the user runs `metta refresh` and inspects the regenerated CLAUDE.md Table of Contents
- THEN no row references the path `spec/backlog/`; any backlog row present points at the issues-backed view

### Scenario: Docs describe the frontmatter-over-issues model
- GIVEN the five affected docs files
- WHEN they are searched for the string `spec/backlog/`
- THEN no match is found, and backlog storage is described as frontmatter over `spec/issues/`

### Scenario: Guard-edit denies edits under the retired path
- GIVEN the guard-edit hook built from the updated template is active
- WHEN an out-of-band `.md` edit targets a path under `spec/backlog/`
- THEN the edit is denied because the prefix is no longer allowlisted


## ADDED: Requirement: Bare metta backlog is allowed by the guard-bash hook

The `ALLOWED_BARE` set in the `metta-guard-bash` PreToolUse hook MUST include `backlog`, so that a bare `metta backlog` invocation (the read-only backlog view) is allowed without a session credential, consistent with bare `roadmap` and `release`. The change MUST be applied to both hook copies — `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` — and the two copies MUST remain byte-identical. The Tier 2 (session-tier) authorization for the scoped two-word write forms `backlog add`, `backlog done`, and `backlog promote` MUST be unchanged: those forms MUST still be denied without valid authorization. (Cross-capability note: this requirement targets the orchestration-guard hook surface; it is specified here because no multi-H1 delta is supported.)

**Fulfills:** US-4

### Scenario: Bare backlog invocation is allowed
- GIVEN the `metta-guard-bash` PreToolUse hook is active and no session credential has been minted
- WHEN a session issues the bare command `metta backlog`
- THEN the hook allows the command rather than denying it

### Scenario: Both hook copies stay byte-identical
- GIVEN the repo hook `.claude/hooks/metta-guard-bash.mjs` and the template `src/templates/hooks/metta-guard-bash.mjs` after the change
- WHEN their contents are compared byte-for-byte (as by the byte-identity test)
- THEN both include `backlog` in `ALLOWED_BARE` and the files are identical

### Scenario: Write forms remain gated
- GIVEN the guard-bash hook is active and no valid session credential exists
- WHEN a session issues `metta backlog add <slug>`, `metta backlog done <slug>`, or `metta backlog promote <slug>`
- THEN each command is denied exactly as before the change


## ADDED: Requirement: Single issues-store test file with no compiled test code in dist

Exactly one issues-store test file MUST exist in the repository, at `tests/issues-store.test.ts`; the colocated `src/issues/issues-store.test.ts` MUST be removed. Every test case that existed only in the colocated file MUST be folded into `tests/issues-store.test.ts` before deletion, so no coverage is lost, and the consolidated suite MUST pass. After a build (`tsc`), `dist/` MUST NOT contain any compiled `issues-store.test` module or any other compiled `.test.` artifact originating from `src/`.

**Fulfills:** US-5

### Scenario: Build output contains no compiled test module
- GIVEN the consolidated test suite with the colocated file deleted
- WHEN the project is built with `tsc` and `dist/` is inspected
- THEN no `issues-store.test` artifact (nor any `*.test.js`/`*.test.d.ts` compiled from `src/`) is present in `dist/`

### Scenario: Unique test cases survive consolidation
- GIVEN test cases that existed only in `src/issues/issues-store.test.ts`
- WHEN the colocated file is deleted
- THEN each of those cases exists in `tests/issues-store.test.ts` and the full test suite passes

### Scenario: Exactly one issues-store test file in the tree
- GIVEN the repository after the change
- WHEN the tree is searched for files matching `issues-store.test`
- THEN exactly one match exists, at `tests/issues-store.test.ts`


## ADDED: Requirement: Tier advisory recommendation is capped at standard

The complexity tier advisory rendered by `src/complexity/renderer.ts` MUST never recommend upscaling to the `full` tier while upscale-to-full is unsupported: when a change's complexity scores at `full`, every surface that emits the renderer's advisory MUST show a recommendation capped at `standard`, and no emitted string may read "scored full -- upscale recommended" or otherwise advise upscaling to `full`. The cap MUST apply at the renderer (or equivalently at every surface emitting its output) so the advisory is consistent with the existing full-tier caps in `src/cli/commands/complete.ts` (lines 362-367 and 462-466). The existing upscale-to-`standard` recommendation for a change scored `standard` while running at `quick` MUST be unchanged, and the underlying complexity scoring values MUST NOT be modified by the cap. (Cross-capability note: this requirement targets the adaptive-workflow-tier-selection advisory surface; it is specified here because no multi-H1 delta is supported.)

**Fulfills:** US-6

### Scenario: Full-scored change renders a capped advisory
- GIVEN a change whose complexity scores at the `full` tier while running at a lower tier
- WHEN the complexity advisory is rendered on any surface that emits it
- THEN the output recommends at most `standard` and never contains a recommendation to upscale to `full`

### Scenario: Standard-over-quick recommendation is unchanged
- GIVEN a change scored at `standard` while running at `quick`
- WHEN the advisory is rendered
- THEN the existing upscale-to-standard recommendation text appears exactly as before the change

### Scenario: Scoring values are untouched by the cap
- GIVEN a change whose raw complexity score maps to the `full` tier
- WHEN the advisory cap is applied at render time
- THEN the stored/computed score and scored tier remain `full`; only the rendered recommendation text is capped, consistently across all emitting surfaces
