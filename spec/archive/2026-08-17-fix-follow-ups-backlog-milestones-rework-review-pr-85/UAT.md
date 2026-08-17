# UAT: fix-follow-ups-backlog-milestones-rework-review-pr-85

- **Change**: fix-follow-ups-backlog-milestones-rework-review-pr-85
- **Generated**: 2026-08-17
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Backlog auto-commits stage only the files the command wrote

*Independent test:* With an unrelated dirty file under `spec/issues/`, running a backlog write command produces a commit containing only the command's own files, leaving the unrelated file uncommitted in the working tree.

#### Step 1.1
- **Setup**: a working tree with an unrelated modified file `spec/issues/other-issue.md`
- **Do**: I run `metta backlog add "new item"` (Run: `metta backlog add "new item"`)
- **Observe**: the auto-commit contains only the newly created issue file and `spec/issues/other-issue.md` remains dirty and uncommitted
- [ ] Pass

#### Step 1.2
- **Setup**: an unrelated dirty file under `spec/issues/`
- **Do**: I run `metta backlog done <slug>` or `metta backlog migrate` (Run: `metta backlog migrate`)
- **Observe**: the auto-commit stages only the files those commands moved or archived, not the directory
- [ ] Pass

#### Step 1.3
- **Setup**: the three `commitPaths` call sites in `src/cli/commands/backlog.ts`
- **Do**: the commands execute
- **Observe**: each passes explicit file paths rather than a `spec/issues` directory pathspec
- [ ] Pass

#### Step 1.4: Unrelated dirty file survives a backlog add
- **Setup**: a working tree containing an unrelated modified file `spec/issues/other-issue.md`
- **Do**: the user runs `metta backlog add "new item" --new` (Run: `metta backlog add "new item" --new`)
- **Observe**: the resulting auto-commit contains only the newly created issue file, and `spec/issues/other-issue.md` remains modified and uncommitted in the working tree
- [ ] Pass

#### Step 1.5: Done and migrate stage only their own moved or updated files
- **Setup**: an unrelated dirty file exists under `spec/issues/` and a backlogged issue `<slug>` exists
- **Do**: the user runs `metta backlog done <slug>` (or `metta backlog migrate` where migrate moves legacy files) (Run: `metta backlog migrate`)
- **Observe**: the auto-commit stages exactly the files the command moved, archived, or updated, and the unrelated dirty file is absent from the commit
- [ ] Pass

#### Step 1.6: No directory pathspecs at any commitPaths call site
- **Setup**: the three `commitPaths` call sites in `src/cli/commands/backlog.ts`
- **Do**: any backlog write command executes its auto-commit
- **Observe**: the paths passed to `commitPaths` are explicit file paths (e.g. `spec/issues/<slug>.md`, `spec/issues/resolved/<slug>.md`), and no argument is a bare directory such as `spec/issues`
- [ ] Pass

#### Step 1.7: Done moves the issue to resolved and off the backlog
- **Setup**: a backlogged issue exists at `spec/issues/<slug>.md` with frontmatter `backlog: true` and `type: idea`
- **Do**: the user runs `metta backlog done <slug>` (Run: `metta backlog list`)
- **Observe**: `spec/issues/resolved/<slug>.md` exists with the frontmatter (`type: idea`, `backlog: true`) intact, `spec/issues/<slug>.md` is gone, nothing was written under `spec/backlog/done/`, and the slug no longer appears in `metta backlog list`
- [ ] Pass

#### Step 1.8: Shipped-in stamp survives the new archive path
- **Setup**: a backlogged issue exists
- **Do**: the user runs `metta backlog done <slug> --change some-shipped-change`
- **Observe**: the archived copy at `spec/issues/resolved/<slug>.md` contains the `**Shipped-in**: some-shipped-change` stamp in addition to its preserved frontmatter
- [ ] Pass

#### Step 1.9: Done commits only the archived pair of paths
- **Setup**: a backlogged issue `<slug>` and an unrelated modified file `spec/issues/unrelated.md`
- **Do**: the user runs `metta backlog done <slug>`
- **Observe**: the auto-commit contains exactly `spec/issues/<slug>.md` (deletion) and `spec/issues/resolved/<slug>.md` (addition), and `spec/issues/unrelated.md` remains dirty and uncommitted
- [ ] Pass

### US-2: Backlog and milestone listings render titles safely

*Independent test:* An issue whose frontmatter title embeds ANSI escape or control characters renders in `metta backlog` and milestone listings with those characters removed, while normal titles render unchanged.

#### Step 2.1
- **Setup**: an issue whose title contains an ANSI escape sequence (e.g. `\x1b[31m`)
- **Do**: I run the backlog list view (Run: `metta backlog`)
- **Observe**: the rendered line contains no escape bytes and shows only the sanitized printable text
- [ ] Pass

#### Step 2.2
- **Setup**: an issue whose title contains control characters
- **Do**: the milestone issues renderer prints it
- **Observe**: the control characters are stripped from the output
- [ ] Pass

#### Step 2.3
- **Setup**: an issue with an ordinary plain-text title
- **Do**: either list renders it
- **Observe**: the title is displayed byte-for-byte unchanged
- [ ] Pass

#### Step 2.4: ANSI escape in a backlog title is stripped
- **Setup**: a backlogged issue whose frontmatter title contains the ANSI sequence `\x1b[31m` followed by text
- **Do**: the user runs the backlog list view
- **Observe**: the rendered line for that issue contains no `\x1b` escape byte and shows only the sanitized printable text
- [ ] Pass

#### Step 2.5: Control characters in a milestone issue title are stripped
- **Setup**: an issue assigned to a milestone whose title embeds control characters (e.g. `\x07`, `\x08`)
- **Do**: `metta milestone show <slug>` renders the milestone's issue list
- **Observe**: the printed title contains none of the embedded control characters
- [ ] Pass

#### Step 2.6: Plain titles render unchanged
- **Setup**: an issue with an ordinary plain-text title
- **Do**: either the backlog list or the milestone issues renderer prints it
- **Observe**: the title is displayed byte-for-byte unchanged
- [ ] Pass

#### Step 2.7: Sanitization does not rewrite the issue file
- **Setup**: an issue whose frontmatter title contains an ANSI escape sequence
- **Do**: the backlog list is rendered
- **Observe**: the issue file on disk is byte-identical to its pre-render state
- [ ] Pass

### US-3: No stale spec/backlog references in generated CLAUDE.md, docs, or guard allowlist

*Independent test:* After the change, `metta refresh` output and the guard-edit template contain no `spec/backlog/` references, the five affected docs files describe `spec/backlog/` only as the legacy input to `metta backlog migrate` (never as a live directory store), and the regenerated Table of Contents either omits the backlog row or points at the issues-backed view.

#### Step 3.1
- **Setup**: a project using metta
- **Do**: I run `metta refresh` (Run: `metta refresh`)
- **Observe**: the regenerated CLAUDE.md Table of Contents contains no `spec/backlog/` row (or the row points at the current issues-backed backlog view)
- [ ] Pass

#### Step 3.2
- **Setup**: the five docs files (`docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/guide/troubleshooting.md`, `docs/internals/guard-hooks.md`)
- **Do**: I read them
- **Observe**: backlog storage is described as frontmatter over `spec/issues/` with no reference to a `spec/backlog/` directory store
- [ ] Pass

#### Step 3.3
- **Setup**: the guard-edit hook template (`src/templates/hooks/metta-guard-edit.mjs`)
- **Do**: an out-of-band `.md` edit targets a path under `spec/backlog/`
- **Observe**: the edit is denied because the prefix is no longer allowlisted
- [ ] Pass

#### Step 3.4: Refresh emits a TOC without a spec/backlog row
- **Setup**: a project using metta with the change applied
- **Do**: the user runs `metta refresh` and inspects the regenerated CLAUDE.md Table of Contents (Run: `metta refresh`)
- **Observe**: no row references the path `spec/backlog/`; any backlog row present points at the issues-backed view
- [ ] Pass

#### Step 3.5: Docs describe the frontmatter-over-issues model
- **Setup**: the five affected docs files
- **Do**: they are searched for the string `spec/backlog/` (Run: `metta backlog migrate`)
- **Observe**: every remaining match describes the retired directory only as the legacy input to `metta backlog migrate`, no match describes `spec/backlog/` as a live directory store, and backlog storage is described as frontmatter over `spec/issues/`
- [ ] Pass

### US-4: Bare `metta backlog` allowed by the guard hook

*Independent test:* With the guard-bash hook active, a bare `metta backlog` invocation is allowed, and both hook copies (repo and template) remain byte-identical.

#### Step 4.1
- **Setup**: the `metta-guard-bash` PreToolUse hook is active
- **Do**: a session issues bare `metta backlog` (Run: `metta backlog`)
- **Observe**: the command is allowed rather than denied
- [ ] Pass

#### Step 4.2
- **Setup**: the `ALLOWED_BARE` set in both `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs`
- **Do**: the change lands
- **Observe**: both copies include `backlog` and are byte-identical (the byte-identity guarantee continues to hold)
- [ ] Pass

#### Step 4.3
- **Setup**: the existing two-word authorization rules for `backlog add/done/promote`
- **Do**: those write forms are invoked without proper authorization (Run: `backlog add/done/promote`)
- **Observe**: they are still denied — only the bare read-only form is newly allowed
- [ ] Pass

#### Step 4.4: Bare backlog invocation is allowed
- **Setup**: the `metta-guard-bash` PreToolUse hook is active and no session credential has been minted
- **Do**: a session issues the bare command `metta backlog` (Run: `metta backlog`)
- **Observe**: the hook allows the command rather than denying it
- [ ] Pass

#### Step 4.5: Both hook copies stay byte-identical
- **Setup**: the repo hook `.claude/hooks/metta-guard-bash.mjs` and the template `src/templates/hooks/metta-guard-bash.mjs` after the change
- **Do**: their contents are compared byte-for-byte (as by the byte-identity test)
- **Observe**: both include `backlog` in `ALLOWED_BARE` and the files are identical
- [ ] Pass

#### Step 4.6: Write forms remain gated
- **Setup**: the guard-bash hook is active and no valid session credential exists
- **Do**: a session issues `metta backlog add <slug>`, `metta backlog done <slug>`, or `metta backlog promote <slug>`
- **Observe**: each command is denied exactly as before the change
- [ ] Pass

### US-5: Published package ships no compiled test code

*Independent test:* After building, `dist/` contains no `issues-store.test` artifact, `src/issues/issues-store.test.ts` no longer exists, and every test case unique to the deleted colocated file passes from `tests/issues-store.test.ts`.

#### Step 5.1
- **Setup**: the consolidated test suite
- **Do**: I run `tsc` and inspect `dist/`
- **Observe**: no compiled `issues-store.test` module is present
- [ ] Pass

#### Step 5.2
- **Setup**: test cases that existed only in `src/issues/issues-store.test.ts`
- **Do**: the colocated file is deleted
- **Observe**: those cases have been folded into `tests/issues-store.test.ts` and the full suite passes
- [ ] Pass

#### Step 5.3
- **Setup**: the repo convention of tests under `tests/`
- **Do**: I search the tree
- **Observe**: exactly one issues-store test file exists, at `tests/issues-store.test.ts`
- [ ] Pass

#### Step 5.4: Build output contains no compiled test module
- **Setup**: the consolidated test suite with the colocated file deleted
- **Do**: the project is built with `tsc` and `dist/` is inspected
- **Observe**: no `issues-store.test` artifact (nor any `*.test.js`/`*.test.d.ts` compiled from `src/`) is present in `dist/`
- [ ] Pass

#### Step 5.5: Unique test cases survive consolidation
- **Setup**: test cases that existed only in `src/issues/issues-store.test.ts`
- **Do**: the colocated file is deleted
- **Observe**: each of those cases exists in `tests/issues-store.test.ts` and the full test suite passes
- [ ] Pass

#### Step 5.6: Exactly one issues-store test file in the tree
- **Setup**: the repository after the change
- **Do**: the tree is searched for files matching `issues-store.test`
- **Observe**: exactly one match exists, at `tests/issues-store.test.ts`
- [ ] Pass

### US-6: Tier advisory never recommends an unsupported upscale to full

*Independent test:* For a change whose complexity scores at the `full` tier, every surface that emits the renderer's advisory shows a recommendation capped at `standard`, and no output string recommends upscaling to `full`.

#### Step 6.1
- **Setup**: a change scored at the `full` tier
- **Do**: the complexity advisory is rendered
- **Observe**: the output recommends at most `standard` and never reads "scored full -- upscale recommended"
- [ ] Pass

#### Step 6.2
- **Setup**: a change scored at `standard` while running at `quick`
- **Do**: the advisory is rendered
- **Observe**: the existing upscale-to-standard recommendation is unchanged
- [ ] Pass

#### Step 6.3
- **Setup**: the existing caps in `complete.ts` (lines 362-367, 462-466)
- **Do**: the renderer cap is applied
- **Observe**: advisory text is consistent across all surfaces that emit it, and the underlying scoring values are unmodified
- [ ] Pass

#### Step 6.4: Full-scored change renders a capped advisory
- **Setup**: a change whose complexity scores at the `full` tier while running at a lower tier
- **Do**: the complexity advisory is rendered on any surface that emits it
- **Observe**: the output recommends at most `standard` and never contains a recommendation to upscale to `full`
- [ ] Pass

#### Step 6.5: Standard-over-quick recommendation is unchanged
- **Setup**: a change scored at `standard` while running at `quick`
- **Do**: the advisory is rendered
- **Observe**: the existing upscale-to-standard recommendation text appears exactly as before the change
- [ ] Pass

#### Step 6.6: Scoring values are untouched by the cap
- **Setup**: a change whose raw complexity score maps to the `full` tier
- **Do**: the advisory cap is applied at render time
- **Observe**: the stored/computed score and scored tier remain `full`; only the rendered recommendation text is capped, consistently across all emitting surfaces
- [ ] Pass
