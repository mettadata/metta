# Research: upgrade-metta-issue-skill-run-short-debugging-session-before

## Decision: Inline-skill RCA + stdin via `node:stream/consumers`, pass-through parser

Three implementation axes were researched in parallel. See per-approach files:

- [research-stdin-read-api.md](research-stdin-read-api.md)
- [research-parser-tolerance.md](research-parser-tolerance.md)
- [research-rca-skill-design.md](research-rca-skill-design.md)

### Axis 1 — CLI stdin-read API

#### Approaches Considered

1. **`node:stream/consumers` `text()` with explicit `isTTY` guard** (selected) — one-line, built-in, non-blocking, correct UTF-8. Extracted as a `readPipedStdin(): Promise<string>` helper in `src/cli/helpers.ts` (mirrors the existing TTY-guard pattern at `helpers.ts:260`). Returns `''` when stdin is a TTY; catches SIGPIPE / early-close.
2. **Manual async iterator (`for await (const chunk of process.stdin)`)** — correct, but ~6 lines of Buffer concat boilerplate; same TTY-hang risk if the guard is forgotten.
3. **`readFileSync(0, 'utf8')`** — eliminated: blocks the event loop synchronously; throws `EOF` on Windows when the pipe is already closed.
4. **`get-stdin` v10 npm package** — built-in TTY guard, but an extra dep for 4 lines of logic — inconsistent with metta's minimal-dep posture.

### Axis 2 — Parser tolerance for `parseIssue`

#### Approaches Considered

1. **Pass-through** (selected) — `parseIssue` at `src/issues/issues-store.ts:42-43` already returns everything after `**Severity**:` as `description`. None of its metadata `startsWith` predicates match a `##` line, so H2 headings cannot be misattributed. Structured bodies already round-trip verbatim. This option is zero-diff in behavior and ships backward compatibility for free.
2. **Structured split** — expose typed `symptom / rootCauseAnalysis / evidence / candidateSolutions` fields alongside `description`. Rejected: the downstream requirement is *display*, not programmatic field extraction. `/metta-fix-issues` reads the full `description` string from `metta issues show --json` and renders it.
3. **remark-parse AST split** — matches how `src/specs/spec-parser.ts` handles specs, but imposes an async parse on every issue read and adds a dependency surface that isn't justified by the display-only requirement.
4. **Regex sectioner** — same semantics as (3), pure regex, no deps. Lighter than (3) but still unnecessary for this change.

### Axis 3 — `/metta-issue` skill design (where RCA runs)

#### Approaches Considered

1. **Inline RCA in the skill** (selected) — the skill, running in the orchestrator context, uses `Read`, `Grep`, `Glob`, `Bash` directly to investigate, formats the structured body, then pipes it to `metta issue "<title>"` via stdin. `--quick` short-circuits at step 4; RCA failure falls through to a shallow body with `> RCA skipped: <reason>` at the top. ~70 lines in SKILL.md; no new agent file.
2. **Subagent-driven RCA** — spawn a `metta-issue-investigator` subagent (or reuse `metta-researcher`). The subagent writes the body to a file; the skill reads it back and pipes it. Adds one round-trip of agent-spawn latency on an interactive command, and forces three control hand-offs (skill asks → user answers → subagent investigates → skill pipes) because `AskUserQuestion` can't be delegated. Adds a new agent definition to maintain.
3. **Hybrid threshold** — quick inline pass for simple symptoms, subagent for complex ones. Two code paths produce the body, two fallback paths, ambiguous threshold prose. Not recommended.

### Rationale

The three decisions reinforce each other and align with metta's minimal-surface posture:

- **Inline skill RCA** exploits the orchestrator's already-loaded execution context (the very context that led the user to invoke `/metta-issue` in the first place). Delegating to a subagent would throw that context away and force reconstruction from files. On an interactive command the user is watching, latency matters — agent spawn round-trips are immediately felt.
- **`stream/consumers.text()`** is a built-in, one-line API. No new dependency, no custom Buffer concat, non-blocking, and composes cleanly with the existing `askYesNo` TTY-guard pattern already in `helpers.ts`. The `payload.trim() === ''` check handles the `echo ""` → `"\n"` empty-fallback case the spec requires.
- **Pass-through parser** is a near-zero-diff change. The existing `parseIssue` logic already handles structured bodies correctly because H2 lines never match metadata prefixes. We add a one-line clarifying comment and three unit-test cases (freeform round-trip, H2 round-trip, metadata-line boundary guard). No existing file in `spec/issues/` requires migration.

Together, these keep the change surface small: one new CLI helper, one `issue.ts` action-handler branch, one SKILL.md rewrite, one step-1 display addition in `.claude/skills/metta-fix-issues/SKILL.md`, and an `issues-store.test.ts` addition. No new npm dependencies, no new subagent files, no migrations.

### Artifacts Produced

- [research-stdin-read-api.md](research-stdin-read-api.md) — CLI stdin-read API comparison and `readPipedStdin` helper sketch.
- [research-parser-tolerance.md](research-parser-tolerance.md) — parser-tolerance analysis concluding pass-through is already correct.
- [research-rca-skill-design.md](research-rca-skill-design.md) — inline vs subagent vs hybrid RCA structure, with a full SKILL.md sketch and a prompt snippet that stabilises the three-H2 schema output.
