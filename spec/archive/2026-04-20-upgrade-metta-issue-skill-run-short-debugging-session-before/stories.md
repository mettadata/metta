<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# upgrade-metta-issue-skill-run-short-debugging-session-before — User Stories

## US-1: Log an issue with captured root cause and candidate solutions

**As a** AI orchestrator that has just hit a failure in the middle of a session
**I want to** log an issue that captures the symptom, root cause evidence, and candidate fixes while the failure is still in context
**So that** a future fixer does not have to redo the debugging session from cold, and the signal I gathered is not lost between sessions

**Priority:** P1
**Independent Test Criteria:** Running `/metta-issue "<description>"` produces a file at `spec/issues/<slug>.md` whose body contains H2 sections `## Symptom`, `## Root Cause Analysis` (with an `### Evidence` subsection citing at least one `path/to/file.ts:LINE` reference), and `## Candidate Solutions` listing 1–3 options with tradeoffs.

**Acceptance Criteria:**
- **Given** an orchestrator has observed a failure and has the relevant files in context **When** the orchestrator invokes `/metta-issue "workflow engine crashes on empty tasks.md"` **Then** the skill runs a short RCA session (reading relevant source, git history, and call paths) before writing the ticket
- **Given** the RCA session completes **When** the issue file is written to `spec/issues/<slug>.md` **Then** the body contains the three H2 sections `## Symptom`, `## Root Cause Analysis`, and `## Candidate Solutions` in that order
- **Given** the `## Root Cause Analysis` section is written **When** a reader inspects it **Then** it contains an `### Evidence` subsection with at least one concrete `file:line` citation drawn from the investigation
- **Given** the `## Candidate Solutions` section is written **When** a reader inspects it **Then** it lists between 1 and 3 candidate fixes, each paired with a short tradeoff note

---

## US-2: Skip RCA for trivial symptoms with --quick

**As a** orchestrator logging a trivial or obvious symptom (typo, cosmetic bug, known-duplicate observation)
**I want to** bypass the RCA session and record a shallow one-liner ticket
**So that** I am not forced to spend tokens on investigation when the cost of RCA exceeds its value

**Priority:** P1
**Independent Test Criteria:** Running `/metta-issue --quick "<description>"` produces an issue file whose body is the shallow description only, with no `## Root Cause Analysis` or `## Candidate Solutions` sections, and the skill does not perform file reads or git history lookups before writing.

**Acceptance Criteria:**
- **Given** an orchestrator passes `--quick` **When** it invokes `/metta-issue --quick "status line color wrong on dark terminals"` **Then** the skill writes the issue immediately without running an RCA session
- **Given** `--quick` was used **When** the resulting `spec/issues/<slug>.md` is inspected **Then** the body contains no `## Root Cause Analysis` and no `## Candidate Solutions` H2 sections
- **Given** a non-`--quick` invocation is made later **When** the skill runs **Then** the default behavior remains the full RCA flow from US-1

---

## US-3: Fall back to shallow log when RCA fails

**As a** orchestrator whose RCA session hits an error (missing files, unreadable git history, time pressure, tool failure)
**I want to** the ticket to still be logged with a clear note that RCA was skipped and why
**So that** capture is never blocked and the next fixer can see the RCA was attempted but did not complete

**Priority:** P1
**Independent Test Criteria:** When the RCA session fails or is aborted during `/metta-issue`, the resulting `spec/issues/<slug>.md` is still written with the shallow description body plus a visible blockquote line `> RCA skipped: <reason>` at the top, and no `## Root Cause Analysis` section.

**Acceptance Criteria:**
- **Given** an orchestrator invokes `/metta-issue "<description>"` **When** the RCA session fails (e.g., file read error, git command failure, or agent aborts) **Then** the skill falls back to writing the shallow ticket rather than erroring out
- **Given** the fallback path was taken **When** the issue file is inspected **Then** it contains a blockquote `> RCA skipped: <reason>` documenting why RCA did not complete
- **Given** the fallback path was taken **When** the issue file is inspected **Then** it does NOT contain a `## Root Cause Analysis` or `## Candidate Solutions` section (to avoid misleading half-analyses)

---

## US-4: Fixer sees structured RCA when starting a fix

**As a** fixer running `/metta-fix-issues <slug>` to resolve a logged issue
**I want to** see the captured Symptom, Root Cause Analysis, and Candidate Solutions sections surfaced when the issue is fetched
**So that** I start the fix with the original observation context in hand instead of rediscovering it

**Priority:** P2
**Independent Test Criteria:** Invoking `/metta-fix-issues <slug>` on an issue authored with the upgraded skill displays the `## Symptom`, `## Root Cause Analysis`, and `## Candidate Solutions` sections to the fixer at step 1, before any fix planning begins, and the subsequent fix flow is identical to today.

**Acceptance Criteria:**
- **Given** an issue at `spec/issues/<slug>.md` containing the three H2 sections **When** a fixer invokes `/metta-fix-issues <slug>` **Then** step 1 of the skill displays the Symptom, Root Cause Analysis, and Candidate Solutions content
- **Given** the structured sections are displayed **When** the fix flow proceeds **Then** subsequent steps (plan, execute, verify) behave identically to the pre-upgrade `/metta-fix-issues` flow
- **Given** the issue body contains an `### Evidence` subsection with `file:line` citations **When** the fixer views the display **Then** those citations are preserved and readable (not stripped or reformatted into noise)

---

## US-5: Pipe a pre-built issue body into the CLI

**As a** orchestrator or shell user who already has a fully-authored issue body in a variable, file, or heredoc
**I want to** pipe it into `metta issue` on stdin and have the CLI use it as the ticket body
**So that** I can compose the RCA body however I like (in-agent, from a template, from a log transcript) without inventing a new flag

**Priority:** P2
**Independent Test Criteria:** Running `echo '<body>' | metta issue "<title>"` produces an issue file whose body is exactly the piped content (overriding the description-as-body default), while running `metta issue "<title>"` from an interactive TTY with no pipe behaves identically to today.

**Acceptance Criteria:**
- **Given** stdin is a pipe (not a TTY) **When** `echo '## Symptom\nfoo\n## Root Cause Analysis\nbar' | metta issue "workflow crash"` runs **Then** `spec/issues/<slug>.md` contains the piped content as its body, not the `"workflow crash"` description
- **Given** stdin is an interactive TTY (no pipe) **When** `metta issue "<title>"` runs **Then** behavior is identical to the pre-upgrade CLI — the description is used as the body and no stdin read is attempted
- **Given** the user pipes empty content **When** `echo -n '' | metta issue "<title>"` runs **Then** the CLI falls back to description-as-body (empty stdin is treated as no pipe data) rather than writing an empty issue

---

## US-6: Existing shallow issues still render correctly

**As a** fixer opening an older issue authored before this upgrade (shallow one-liner body, no H2 sections)
**I want to** have `/metta-fix-issues` continue to display and process it without parse errors
**So that** the upgrade is backward-compatible and no historical tickets become unusable

**Priority:** P3
**Independent Test Criteria:** Running `/metta-fix-issues <slug>` on a pre-upgrade issue file (freeform body, no `## Symptom` / `## Root Cause Analysis` / `## Candidate Solutions` sections) succeeds, displays the raw body, and proceeds through the fix flow without error.

**Acceptance Criteria:**
- **Given** an issue file authored before the upgrade with a freeform body and no structured sections **When** a fixer invokes `/metta-fix-issues <slug>` **Then** the skill reads the file without raising a parse or schema error
- **Given** the legacy issue has no `## Symptom` section **When** step 1 displays the issue **Then** the raw body is shown as-is (the display gracefully handles missing sections rather than demanding them)
- **Given** the legacy issue is processed **When** the fix flow runs to completion **Then** the resulting fix behaves identically to today's `/metta-fix-issues` on the same input

---
