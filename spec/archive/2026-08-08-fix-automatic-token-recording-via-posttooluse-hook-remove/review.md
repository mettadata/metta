# Code Review: fix-automatic-token-recording-via-posttooluse-hook-remove

## Summary
Correctness review against spec.md. All seven scoped surfaces (hook, CLI resolution, worktree detection, report dedupe, schema, skill demotion, settings registration) match the spec and design ADRs; all 309 tests in the seven affected suites pass, hook/skill template pairs are byte-identical, and both hook copies pass `node --check`. Only minor documentation-level nits found.

## Issues Found

### Critical (must fix)
- None.

### Warnings (should fix)
- None.

### Suggestions (nice to have)
- `src/cli/commands/tokens.ts:12` — docstring says "a PostToolUse hook invokes this"; the shipped hook is registered on **SubagentStop** (the spec was amended to restate the event). Comment-only inaccuracy, no behavioral effect, but it will mislead future readers.
- `src/finalize/tokens-report-generator.ts:135` — the total line still renders `**~N tokens**` even when every deduped record is hook-sourced (exact). Spec permits this (header wording covers the distinction), but the `~` is now sometimes wrong-in-spirit.
- `src/cli/commands/tokens.ts:52` — rule 1 uses truthiness (`if (options.change)`), so `--change=""` silently falls through to rule 2 rather than erroring on the empty name. Unreachable via normal Commander usage (`<name>` is required); cosmetic.
- `.claude/hooks/metta-tokens-record.mjs:61` — `toCount` accepts negative finite numbers, so a (pathological) negative harness usage value would skew the sum rather than being clamped. Harness never writes negatives; the positive-integer total guard at line 133 already prevents recording nonsense totals.

## Verification performed
- Hook (`metta-tokens-record.mjs`, both copies byte-identical, `node --check` clean, executable): sums `input_tokens + output_tokens` per assistant record with a `message.usage` object (ADR-1); cache components parsed for diagnostics only; `metta-*` prefix filter (ADR-3); model mapped by case-insensitive family substring from the **last** usage-bearing record, `inherit` fallback (ADR-6); static agent→task map with agent_type fallback (ADR-2); `execFile('metta', [... '--source','hook'], { cwd: payload.cwd ?? process.cwd(), timeout: 30_000 })`; unconditional `exit 0` via `.finally()`; stdout never written; malformed lines/empty/missing transcripts/CLI failure all short-circuit without recording. 20/20 hook tests pass, including empty-stdout and shim-argv assertions.
- `tokens.ts` four-rule resolution: `--change` verbatim > worktree-cwd hard bind (inactive candidate throws typed error before any write — no fall-through) > single-active auto-select > typed `tokens_record_error` exit 4. `realpathSync` best-effort before detection. Omitted `--source` persists no field; invalid value fails Zod before write. 14/14 CLI tests pass, including the two-active-changes worktree bind and inactive-worktree-name failure.
- `detectWorktreeChangeName` (`src/util/git-worktree.ts`): pure, no I/O; backwards walk from `segments.length - pair.length - 1` guarantees a following segment exists and last occurrence wins; adjacency enforced via `pair.every`; empty pair, non-adjacent segments, missing follower, trailing separators, custom worktreeDir all covered by tests.
- Report dedupe: hook records always kept; prose (including `source`-absent) dropped only on same-`(task,agent)` hook collision; NUL-separated key avoids collision on whitespace-bearing ids (improves on the design's space join); applied uniformly to total, table, both rollups, split, and GAPS input; input array not mutated (filter); GAPS/`NO_GAPS` logic intact with hook-coverage-miss wording. 21/21 generator tests pass.
- Schema: `source: z.enum(['hook','prose']).optional()` on the existing `.strict()` object; legacy records without `source` validate; unknown keys and out-of-enum values reject (schemas suite 178/178).
- Skills: the ADR-4 fallback sentence is verbatim-identical across all 4 template files (1 unique string after prefix strip); each of the 4 template/deployed pairs is byte-identical; the only diff per file is the single mandate→fallback line replacement. Guard-bash change is comment-only; `tokens` allowlist entry retained; pair byte-identical.
- `.claude/settings.json`: `SubagentStop` block added (no matcher); `PreToolUse` entries and `statusLine` untouched in the diff.

## Verdict
PASS

---

# Quality Review (conventions, tests, clarity, docs, commit hygiene)

## Summary
Convention-clean and well-tested: pure functional core (`detectWorktreeChangeName`, `dedupeTokenUsage`), Zod validation ahead of every write, `.js` import extensions throughout, no CommonJS/singletons/string-literal templates, byte-identical template pairs verified, and behavior-focused tests with temp-dir isolation. Two items should be fixed or logged.

## Issues Found

### Critical (must fix)
- None.

### Warnings (should fix)
- `src/cli/commands/tokens.ts:12` — Stale event name: header says "a PostToolUse hook invokes this after each subagent run"; the shipped and spec-amended event is SubagentStop. This is the doc comment the delta was meant to update (spec.md line 5 restates all event references), and it contradicts every other file in the change. One-word fix.
- `src/cli/commands/install.ts:355-358` — Deployment gap for downstream adopters: readdir-driven `installMettaHooks` now copies `metta-tokens-record.mjs` into consumer projects, but the installer only settings-registers guard-edit/guard-bash, so the recording hook is inert (never fires) everywhere except this repo. The adjacent comment enumerating why other hooks are unregistered ("frontmatter-scoped by design") no longer accounts for metta-tokens-record, which is neither registered nor frontmatter-scoped. Installer work was outside this change's spec/design scope — log a follow-up issue rather than block.

### Suggestions (nice to have)
- `src/finalize/tokens-report-generator.ts:70` — `(r.source ?? 'prose') === 'hook'` — the coalesce is redundant (`r.source === 'hook'` is equivalent); keep only if intended as legacy-semantics documentation.
- `src/finalize/tokens-report-generator.ts:54-66` — Dedupe key is `task+agent`; a shadowed prose record with a *different* model silently vanishes from the per-model rollup. Matches the design's normative rule; awareness note only.

## Checks performed
- Conventions: camelCase/PascalCase/kebab-case consistent; `.js` extensions on all TS imports; `TokenUsageRecordSchema.parse` before write plus full-metadata re-validation in `ArtifactStore.updateChange`; ESM-only (`.mjs` hook, no `require`); no singletons; tokens.md template external (the shell shim string in `tests/metta-tokens-record-hook.test.ts:151` is a test fixture, not a template — acceptable); pure helpers with I/O at the CLI edge.
- Tests: 1:1 coverage for every touched source file; new hook suite uses `mkdtempSync` sandboxes with afterEach cleanup and PATH restricted to the shim dir (no global-`metta` leakage); assertions target observable behavior (captured argv, exit codes, empty stdout, persisted YAML shape, rendered markdown), not internals. `npx tsc --noEmit` clean; 309/309 tests pass across the 7 touched suites.
- Byte-identity: `cmp` confirms all 6 template/deployed pairs identical (tokens hook, guard-bash, 4 SKILL.md files); `dist` copy step already covers `src/templates/hooks/` (package.json `copy-templates`).
- Docs/templates: `src/templates/artifacts/tokens.md` header wording matches generator output (`hook (exact)` / `prose (estimate)`, hook-wins rule); ADR-4 fallback sentence verbatim-identical across all four skill pairs and locked by test.
- Commit hygiene: 28 branch commits, all conventional prefixes with change-name scope, atomic per component (schema → helper → dedupe → CLI resolution → skills → hook → fixture alignment → docs).

## Verdict
PASS_WITH_WARNINGS

---

## Security Review

**Verdict: PASS_WITH_WARNINGS**

Confirmed clean: execFile array form, no shell; transcript-controlled data cannot reach argv
(agent_type runtime-set with `metta-` prefix requirement, model collapsed to fixed enum, tokens
integer-gated); worktree name derivation is single-segment post-resolve (no traversal); guard
PreToolUse registrations byte-identical to main; hook fail-safe (exit 0 every path, no stdout);
no secrets; session-token flow untouched.

Findings (all minor):
1. minor — `.claude/hooks/metta-tokens-record.mjs:160` — `payload.cwd` lacks the `typeof === 'string'` check applied to other payload fields; add for symmetry.
2. minor — `.claude/hooks/metta-tokens-record.mjs:92-96` — `agent_transcript_path` read verbatim without containment check; blast radius limited to numeric summing.
3. minor — `.claude/hooks/metta-tokens-record.mjs:93` — whole-file readFile with no size cap; DoS-only impact on a fail-open hook.
4. minor (pre-existing) — `src/cli/commands/tokens.ts:53-55` — `--change` accepted verbatim into joined paths; predates this change, not reachable from the hook.

---

## Merged verdict

Correctness: PASS. Security: PASS_WITH_WARNINGS. Quality: PASS_WITH_WARNINGS.
No critical findings — review loop exits after one iteration. Actioned in-change: tokens.ts
header doc comment (PostToolUse → SubagentStop) and the redundant source coalesce. Deferred to
follow-up issue: installer settings-registration gap for the recording hook in consumer projects
(src/cli/commands/install.ts:355-358) — outside this change's spec scope.
