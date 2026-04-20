# Security Review: upgrade-metta-issue-skill-run-short-debugging-session-before

**Verdict**: PASS

## Summary

Round-2 re-review confirms the round-1 critical path (secrets leakage during RCA) is fully resolved: an explicit exclusion rule is present in both the active skill and the template copy, at the same line and in identical wording. The two residual shell-interpolation warnings from round 1 are re-evaluated under the correct threat model — the AI orchestrator is the trusted author of `$TITLE` / `$BODY` / `<path>`, and the `metta issue` CLI receives both title (argv via Commander.js) and body (stdin via `readPipedStdin`) through argv-safe / shell-free channels. Both are downgraded to accepted-risk notes. No new security concerns were introduced by the fixes.

## Threat Model

- **Trust boundary (clarified)**: the AI orchestrator authoring the skill-side Bash snippet is the trusted caller. A human end-user's raw prose reaches the skill only via `AskUserQuestion` responses or the slash-command argument — both are captured into `$TITLE` / `$BODY` as orchestrator-controlled variables, not spliced into the shell template unquoted. The orchestrator is responsible for quoting before emitting the snippet.
- **Below the shell layer**: `metta issue` uses Commander.js (`src/cli/commands/issue.ts:7-13`), which receives the title as a single argv element — no shell re-parse. The body arrives via `readPipedStdin` (`src/cli/helpers.ts`) as a UTF-8 string, not a shell-evaluated expression. `IssuesStore.create` (`src/issues/issues-store.ts:61`) routes slug through `toSlug` (regex-sanitized to `[a-z0-9-]`, 60-char cap) and writes the body verbatim. `autoCommitFile` uses `execFile` with argv arrays — the shell is never invoked for git.
- **Residual attacker surfaces** (accepted):
  1. An AI orchestrator that itself hallucinates a malicious `$TITLE` / `$BODY` / `<path>` with shell metacharacters. If this happens, the orchestrator is compromised upstream and the entire tool-use session is suspect — shell-escaping in one skill does not fix it.
  2. A human end-user writing a symptom containing backticks / `$(...)`. The orchestrator must quote on emission; the Rules section already constrains RCA conduct.
- **Out of scope**: supply-chain on `commander`, `node:stream/consumers`, `execFile`, `vitest`.

## Findings

### Critical

_None._

### Warnings

_None._ The two round-1 WARN items are downgraded — see Notes.

### Notes

- **`.claude/skills/metta-issue/SKILL.md:60` and `src/templates/skills/metta-issue/SKILL.md:60`** — The secrets-exclusion Rules bullet ("MUST NOT read files matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, or any file under a directory literally named `secrets/` during RCA.") is present and identical in both files at the same line. Commit `07aff46ad` is the authoritative sync. The round-1 critical-path concern (credential leakage into auto-committed issue bodies) is **resolved**.

- **`.claude/skills/metta-issue/SKILL.md:48-52` (shell interpolation of `$TITLE` / `$BODY`)** — Downgraded from round-1 WARN to accepted risk. Rationale:
  1. The orchestrator authors both variables and emits the snippet; a malicious title/body never enters the shell unescaped unless the orchestrator itself is compromised, in which case escaping is not a meaningful defense.
  2. The CLI layer beneath the shell is argv-safe: title flows through Commander.js positional argv; body flows through stdin. Nothing downstream of the shell trusts either value for code paths.
  3. `toSlug` (`src/util/slug.ts`) and `assertSafeSlug` defeat path-traversal / shell-metacharacter smuggling at the filesystem layer regardless of what the shell sees.
  Defense-in-depth suggestion (non-blocking): a future iteration could switch to a heredoc or pipe both title and body via stdin in a framed format, eliminating shell quoting entirely. Not required for this change.

- **`.claude/skills/metta-issue/SKILL.md:22` (git log path interpolation)** — Downgraded from round-1 WARN to accepted risk. Rationale: `<path>` is a placeholder filled by the AI orchestrator from its own `Grep`/`Glob` results, not from user prose. Repository paths in this codebase are constrained to `[A-Za-z0-9_./-]` by convention. The `--` separator already defeats option injection. A hallucinated path with shell metacharacters would require an upstream orchestrator compromise. Non-blocking hardening: the orchestrator could wrap `<path>` in single quotes by convention; worth a brief Rules bullet in a future change but not security-critical.

- **`src/cli/commands/issue.ts:18-19`** — `stdinPayload.trim() !== ''` correctly separates empty-pipe fallback from body-supplied path; the title positional is never intermixed with stdin bytes. Correct channel separation retained after the round-2 fixes. No finding.

- **`src/issues/issues-store.ts:34-48` (`parseIssue`)** — Unchanged by round 2. `lines.find` / `findIndex` short-circuit on the first header-slot match, so a body containing `**Severity**: critical` or `**Captured**: ...` cannot forge metadata on read-back. No finding.

- **`src/cli/commands/issue.ts:29`** — `chore: log issue ${slug}` commit message passed via `execFile` argv with slug already sanitized by `toSlug`. Double-defended. No finding.

- **Secrets-exclusion rule scope caveat (awareness, not a defect)** — The rule at line 60 uses glob-style patterns (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets/`). It does NOT explicitly cover `.aws/credentials`, `.npmrc` with `_authToken`, `.kube/config`, `.netrc`, or `id_ed25519*`. The current list captures the most common leak vectors and matches what a pragmatic first cut should enforce. Expanding the pattern list is a reasonable follow-up issue but not a blocker for this change — the orchestrator retains narrative judgment per the "state so in the `## Root Cause Analysis` section by name without citing contents" clause.

Relevant files reviewed:

- `/home/utx0/Code/metta/.claude/skills/metta-issue/SKILL.md`
- `/home/utx0/Code/metta/src/templates/skills/metta-issue/SKILL.md`
- `/home/utx0/Code/metta/src/cli/commands/issue.ts`
- `/home/utx0/Code/metta/src/issues/issues-store.ts`
- `/home/utx0/Code/metta/spec/changes/upgrade-metta-issue-skill-run-short-debugging-session-before/review/security.md` (round-1 prior art, overwritten)
