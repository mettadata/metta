# No CLI path to amend an existing issue

**Captured**: 2026-08-25
**Status**: logged
**Severity**: minor

## Symptom
Reported by the zeus session (2026-08-26) as their top day-to-day want: there is no CLI path to amend an existing issue. `metta issue` only creates; `metta issues` is list/show only. The backlog and issue skills mandate "Never write to spec/issues/ directly — the CLI owns those files", so when code moved under 9 logged issues, zeus had to hand-edit all 9 files to refresh line references, violating the ownership rule the tooling itself imposes. Issues drift constantly — line refs rot, scope widens, half a fix lands in an adjacent change — and there is no supported way to record any of it.

## Root Cause Analysis
The issue CLI surface was designed write-once. `registerIssueCommand` wires exactly three verbs: `issue` (create), `issues list`, and `issues show` — no update path. The store layer is only marginally better: `IssuesStore.updateFrontmatter(slug, patch)` exists but is reachable solely through the backlog promote path, and no primitive exists for body mutation at all (appending a dated addendum, refreshing evidence refs, or adjusting severity). At the same time, the guard hook's authorization model has no scope for an amend verb — its read-only allow-list covers only `issues list`, and `issue` is tiered as fork-tier create. So every post-creation change is squeezed between two walls: the ownership rule says only the CLI may write `spec/issues/*.md`, and the CLI exposes no verb that writes after create. Hand-editing is the only escape hatch, which is exactly what the rules forbid.

### Evidence
- `src/cli/commands/issue.ts:11` — `registerIssueCommand` registers only create plus `issues list` / `issues show`; no amend/update subcommand exists anywhere in the CLI.
- `src/issues/issues-store.ts:223` — `updateFrontmatter` is the sole mutation primitive and its only production caller is `src/cli/commands/backlog.ts:174`; there is no method to append body sections or refresh evidence references.
- `.claude/hooks/metta-guard-bash.mjs:49` — the guard's read-only allow-list recognises only `issues list`, and the tier maps treat `issue` purely as the fork-tier create verb; an amend subcommand has no defined authorization scope.

## Candidate Solutions
1. **`metta issue amend <slug>` subcommand** — new verb accepting piped stdin as a dated addendum body (appended as `## Update — <date>`), plus flags `--severity` / `--priority` / `--milestone` / `--refresh-evidence` for frontmatter and reference updates. Reuse `updateFrontmatter` (extended for severity), add an `appendUpdate` store primitive, validate with Zod, and auto-commit like the create path; register the two-word form in `metta-guard-bash` with mint scoping so both fork skills and the session tier can invoke it. Tradeoff: grows the scoped two-word command surface the guard must parse and requires a new store primitive with parsing edge cases (issues created before frontmatter support, RCA-fallback bodies).
2. **Overload `metta issue --amend <slug>`** — keep a single verb and switch the existing action into amend mode when the flag is present, inheriting the current fork-tier authorization unchanged. Tradeoff: one action handler with two contracts — the description argument means title on create but is unused on amend — which muddies JSON output, exit-code semantics, and tests.
3. **Store primitives + dedicated amend skill** — add `IssuesStore.appendUpdate` / evidence-refresh primitives and a `metta-issue-amend` skill that authors the addendum content, keeping the CLI verb thin and the RCA-quality bar on the skill side. Tradeoff: still requires the guard/mint wiring and a CLI entry point anyway, and human terminal users get no amend path until that verb ships, so it is strictly more work than option 1 for the same coverage.

