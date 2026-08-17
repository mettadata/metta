# fix-follow-ups-backlog-milestones-rework-review-pr-85 — User Stories

## US-1: Backlog auto-commits stage only the files the command wrote

**As a** developer running `metta backlog add/done/promote` with other uncommitted edits under `spec/issues/`
**I want to** have the backlog auto-commit stage only the exact files the command created, moved, or archived
**So that** my unrelated in-progress work is never silently swept into a commit I did not intend — a merge-safety guarantee I depend on

**Priority:** P1
**Independent Test Criteria:** With an unrelated dirty file under `spec/issues/`, running a backlog write command produces a commit containing only the command's own files, leaving the unrelated file uncommitted in the working tree.

**Acceptance Criteria:**
- **Given** a working tree with an unrelated modified file `spec/issues/other-issue.md` **When** I run `metta backlog add "new item"` **Then** the auto-commit contains only the newly created issue file and `spec/issues/other-issue.md` remains dirty and uncommitted
- **Given** an unrelated dirty file under `spec/issues/` **When** I run `metta backlog done <slug>` or `metta backlog promote <slug>` **Then** the auto-commit stages only the files those commands moved or archived, not the directory
- **Given** the three `commitPaths` call sites in `src/cli/commands/backlog.ts` **When** the commands execute **Then** each passes explicit file paths rather than a `spec/issues` directory pathspec

---

## US-2: Backlog and milestone listings render titles safely

**As a** developer listing backlog entries or milestone issues in my terminal
**I want to** see issue titles with ANSI escape sequences and control characters stripped before printing
**So that** a hostile or malformed title in issue frontmatter cannot inject escape sequences into my terminal or corrupt the listing output

**Priority:** P1
**Independent Test Criteria:** An issue whose frontmatter title embeds ANSI escape or control characters renders in `metta backlog` and milestone listings with those characters removed, while normal titles render unchanged.

**Acceptance Criteria:**
- **Given** an issue whose title contains an ANSI escape sequence (e.g. `\x1b[31m`) **When** I run the backlog list view **Then** the rendered line contains no escape bytes and shows only the sanitized printable text
- **Given** an issue whose title contains control characters **When** the milestone issues renderer prints it **Then** the control characters are stripped from the output
- **Given** an issue with an ordinary plain-text title **When** either list renders it **Then** the title is displayed byte-for-byte unchanged

---

## US-3: No stale spec/backlog references in generated CLAUDE.md, docs, or guard allowlist

**As a** developer (or AI orchestrator) regenerating CLAUDE.md via `metta refresh` or reading the metta docs
**I want to** see only references to the current frontmatter-over-`spec/issues/` backlog model, with no mention of the removed `spec/backlog/` directory
**So that** I am never directed to a dead path, and the guard-edit hook no longer allowlists edits under a directory that does not exist

**Priority:** P2
**Independent Test Criteria:** After the change, `metta refresh` output, the five affected docs files, and the guard-edit template contain no `spec/backlog/` references, and the regenerated Table of Contents either omits the backlog row or points at the issues-backed view.

**Acceptance Criteria:**
- **Given** a project using metta **When** I run `metta refresh` **Then** the regenerated CLAUDE.md Table of Contents contains no `spec/backlog/` row (or the row points at the current issues-backed backlog view)
- **Given** the five docs files (`docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/guide/troubleshooting.md`, `docs/internals/guard-hooks.md`) **When** I read them **Then** backlog storage is described as frontmatter over `spec/issues/` with no reference to a `spec/backlog/` directory store
- **Given** the guard-edit hook template (`src/templates/hooks/metta-guard-edit.mjs`) **When** an out-of-band `.md` edit targets a path under `spec/backlog/` **Then** the edit is denied because the prefix is no longer allowlisted

---

## US-4: Bare `metta backlog` allowed by the guard hook

**As an** AI orchestrator session invoking the read-only backlog view
**I want to** run bare `metta backlog` without a guard denial, consistent with bare `roadmap` and `release`
**So that** I can check backlog state without spurious fail-closed errors that stall the workflow

**Priority:** P2
**Independent Test Criteria:** With the guard-bash hook active, a bare `metta backlog` invocation is allowed, and both hook copies (repo and template) remain byte-identical.

**Acceptance Criteria:**
- **Given** the `metta-guard-bash` PreToolUse hook is active **When** a session issues bare `metta backlog` **Then** the command is allowed rather than denied
- **Given** the `ALLOWED_BARE` set in both `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` **When** the change lands **Then** both copies include `backlog` and are byte-identical (the byte-identity guarantee continues to hold)
- **Given** the existing two-word authorization rules for `backlog add/done/promote` **When** those write forms are invoked without proper authorization **Then** they are still denied — only the bare read-only form is newly allowed

---

## US-5: Published package ships no compiled test code

**As a** consumer of the published metta package
**I want to** receive a `dist/` build that contains no compiled issues-store test module
**So that** the package stays lean and follows the repo convention that all tests live under `tests/`, without losing any test coverage

**Priority:** P2
**Independent Test Criteria:** After building, `dist/` contains no `issues-store.test` artifact, `src/issues/issues-store.test.ts` no longer exists, and every test case unique to the deleted colocated file passes from `tests/issues-store.test.ts`.

**Acceptance Criteria:**
- **Given** the consolidated test suite **When** I run `tsc` and inspect `dist/` **Then** no compiled `issues-store.test` module is present
- **Given** test cases that existed only in `src/issues/issues-store.test.ts` **When** the colocated file is deleted **Then** those cases have been folded into `tests/issues-store.test.ts` and the full suite passes
- **Given** the repo convention of tests under `tests/` **When** I search the tree **Then** exactly one issues-store test file exists, at `tests/issues-store.test.ts`

---

## US-6: Tier advisory never recommends an unsupported upscale to full

**As a** developer reading the complexity tier advisory on a change's status output
**I want to** see the upscale recommendation capped at `standard`, never `full`
**So that** I am never advised to take an action (upscale-to-full) that the workflow does not support

**Priority:** P3
**Independent Test Criteria:** For a change whose complexity scores at the `full` tier, every surface that emits the renderer's advisory shows a recommendation capped at `standard`, and no output string recommends upscaling to `full`.

**Acceptance Criteria:**
- **Given** a change scored at the `full` tier **When** the complexity advisory is rendered **Then** the output recommends at most `standard` and never reads "scored full -- upscale recommended"
- **Given** a change scored at `standard` while running at `quick` **When** the advisory is rendered **Then** the existing upscale-to-standard recommendation is unchanged
- **Given** the existing caps in `complete.ts` (lines 362-367, 462-466) **When** the renderer cap is applied **Then** advisory text is consistent across all surfaces that emit it, and the underlying scoring values are unmodified
