# Design: fix-metta-check-constitution-requires-direct-anthropic-api

## Approach

Convert `check-constitution` from a single direct-API invocation into the two-invocation instruction-mode shape research selected: no-flag call emits a contract, `--record <verdict-file>` persists a subagent-produced verdict. `checker.ts` splits along its existing seam (research: prompt-building lines 52-81 are provider-agnostic; lines 96-101 are the only provider-coupled block) into `buildCheckContract()` (survives as contract emitter) and `recordVerdict()` (new, absorbs the post-processing block at `checker.ts:103-134` verbatim). `renderViolationsMd`/`renderViolationLine`/`getSpecVersion` stay in `check-constitution.ts:18-67` unchanged, called only from the `--record` branch. The provider abstraction (`src/providers/`) is deleted outright — no conditional fallback, matching Out of Scope item 5 (Requirement: No Direct AI Provider Invocation). `ViolationListSchema` is reused as-is for verdict validation (Requirement: Verdict Schema Validation) — no new schema.

## Components

### `src/constitution/checker.ts`
- **Deleted:** `import type { AIProvider }` (line 4), `CheckerOptions.provider` field (line 25), the `generateObject` call block (lines 96-101), the `import { z } from 'zod'` if unused after removal (verify — `ViolationListSchema` type cast used `z.ZodSchema`; drop if no longer needed).
- **Kept, renamed contract text:** `SYSTEM_PROMPT` (lines 30-50), `formatArticles` (52-62), `buildUserPrompt` (64-81) survive **unchanged in content**. Decision: `SYSTEM_PROMPT`'s text becomes part of the emitted JSON contract (a `check_instructions` field), not dead code — the subagent still needs the severity rubric, the untrusted-data framing for `<SPEC>`, and the exact output shape; that text currently lives only in `checker.ts` and nowhere in `.claude/agents/metta-constitution-checker.md`'s frontmatter is guaranteed in sync. Emitting it keeps a single source of truth instead of trusting the skill/agent file to restate it. `buildUserPrompt` is repurposed to build the `<CONSTITUTION>...<SPEC>...` framed string used as the contract's `formatted_prompt` field (research: subagent already parses these tags per agent line 12) — structured `articles`/`specPath`/`specContent` fields are emitted *alongside* it, not instead, so the skill can pass either the flattened string or the structured JSON to the subagent.
- **New:** `buildCheckContract(projectRoot: string, changeName: string): Promise<CheckContract>` — moves lines 84-95 (path resolution, `parseConstitution`, `readFile`) verbatim; returns `{ articles, specPath, specContent, instructions: SYSTEM_PROMPT, formattedPrompt }`.
- **New:** `recordVerdict(verdict: ViolationList, projectRoot: string, changeName: string): Promise<CheckResult>` — takes an already-`ViolationListSchema`-validated verdict (validation happens in the CLI layer, not here, so `checker.ts` stays testable with plain objects), absorbs `checker.ts:103-134` unchanged (justification lookup via `parseComplexityTracking`, blocking classification, `isBlockingViolation` — untouched, `checker.ts:141-143`).
- `AnnotatedViolation`, `CheckResult`, `isBlockingViolation` — unchanged exports.
- **New error class:** `VerdictValidationError extends Error`, co-located in `checker.ts` (not reusing `ConstitutionParseError`, which is scoped to constitution-parsing failures in `constitution-parser.ts` — a distinct failure domain from "the subagent's verdict file is malformed"). Follows the existing pattern exactly (`constitution-parser.ts:11-15`): `name = 'VerdictValidationError'`, thrown by the CLI's `--record` branch on JSON-parse failure or `ViolationListSchema.parse()` failure, caught by the existing catch-all in `check-constitution.ts:140-150` and mapped to exit 4 via `getErrorMessage`.

### `src/cli/commands/check-constitution.ts`
- **Deleted:** `import { AnthropicProvider }` (line 13), the `new AnthropicProvider(...)` construction (line 96).
- **New option:** `.option('--record <file>', 'Path to a verdict JSON file to validate and persist')`.
- **Action handler branches on `options.record`:**
  - **No `--record` (emission mode):** calls `buildCheckContract(ctx.projectRoot, changeName)`. Human mode prints a summary (article counts, spec path) per research decision 3 — full `specContent` is not dumped to terminal. `--json` mode emits the full contract object via `outputJson`. Exit `0` always on success (Requirement: Contract Emission Without API Credentials). Nonexistent change still throws in `buildCheckContract`'s `readFile`/`parseConstitution` calls and falls through to the existing catch-all → exit 4, `check_constitution_error` (unchanged from today).
  - **`--record <file>` (recording mode):** `readFile(file, 'utf8')` → `JSON.parse` (catch → throw `new VerdictValidationError('invalid JSON: ...')`) → `ViolationListSchema.parse(parsed)` (catch `ZodError` → wrap in `VerdictValidationError`) → `recordVerdict(verdict, ctx.projectRoot, changeName)` → existing `renderViolationsMd`/`getSpecVersion`/`writeFile` block (lines 104-114, unchanged) → exit `0`/`4` on `result.blocking` (unchanged, lines 116-139). On `VerdictValidationError`, the existing catch-all fires *before* any `mkdir`/`writeFile` call is reached (both are validation failures that occur ahead of persistence in source order), satisfying "does not write or modify `violations.md`" (Requirement: Verdict Schema Validation).
- `outputJson` shape for emission mode (`--json`): `{ articles: { conventions: string[], offLimits: string[] }, spec_path: string, spec_content: string, verdict_schema: "expected shape: {\"violations\": [{article, severity: critical|major|minor, evidence, suggestion}]}", instructions: string, output_path: string }` — `output_path` names the conventional record-time input path suggestion, `spec/changes/<name>/.verdict.json`, so the skill has a deterministic place to write the subagent's output before calling `--record`.

### `.claude/skills/metta-check-constitution/SKILL.md` and `src/templates/skills/metta-check-constitution/SKILL.md`
Full rewrite (byte-identical copies, per US-3 AC2 / Requirement: Skill-Driven Two-Step Check Flow). Three-step flow replacing the current single-call wrapper:
1. **Emit.** Resolve change slug (unchanged step 1 logic). Run `metta check-constitution --change <slug> --json` (no `--record`) — capture `articles`, `spec_path`, `spec_content`, `instructions`, `output_path`.
2. **Spawn subagent.** Spawn `metta-constitution-checker` (Read-only tools, unchanged agent file) with the emitted constitution/spec content framed in `<CONSTITUTION>`/`<SPEC path="...">` tags. Write its `{"violations": [...]}` output to `output_path`.
3. **Record.** Run `metta check-constitution --change <slug> --record <output_path> --json`. Preserve the current skill's exit-4 guidance verbatim (steps 4-5 of the existing skill: echo `violations_path`, surface each blocking violation with article/severity/evidence, tell the user the Complexity Tracking resolution message, never rewrite `violations.md` from the skill).

### `.claude/agents/metta-constitution-checker.md`
No change (confirmed by research and Out of Scope item 4) — its `<CONSTITUTION>`/`<SPEC>` in, `{"violations": [...]}` out contract already matches.

## Data Model

No new schemas. `ViolationSchema`/`ViolationListSchema` (`src/schemas/violation.ts:6-17`) reused unchanged for both the emitted "expected shape" documentation and the `--record` input validation. New TypeScript-only (non-Zod, internal) interface `CheckContract` in `checker.ts`:
```
interface CheckContract {
  articles: ConstitutionArticles
  specPath: string
  specContent: string
  instructions: string        // = SYSTEM_PROMPT
  formattedPrompt: string      // = buildUserPrompt(...)
}
```
Not Zod-validated (it is produced, not consumed, by this codebase — no external input to guard).

## API Design

`metta check-constitution --change <name> [--json]` — emission mode, exit `0` on success, `4` on missing/invalid change.
`metta check-constitution --change <name> --record <verdict-file> [--json]` — recording mode, exit `0` (no blocking violations), `4` (blocking violations, malformed JSON, or schema-invalid verdict).
Both modes preserve `violations_path`/`violations.md` write location and rendered format exactly (Requirement: Violations Report Format and Location Preserved; Idempotent Re-Check Replaces the Prior Verdict — `writeFile(..., { flag: 'w' })` already overwrites, unchanged).

## Risks & Mitigations

- **Subagent verdict quality is unvalidated semantically** (schema-valid but substantively wrong — e.g. missed or fabricated violations). Same trust level as the prior direct-API call, which had the identical risk with a hosted model instead of a subagent; mitigation is unchanged: `violations.md` is human-reviewable before the gate is treated as authoritative, and severity/justification logic is deterministic and auditable regardless of verdict source.
- **Orphaned verdict files.** The suggested `output_path` (`spec/changes/<name>/.verdict.json`) is a scratch artifact, not a durable one. Recommend it lives under `.metta/` scratch space instead (e.g. `.metta/scratch/<change>/verdict.json`) and is added to `.gitignore`, avoiding stray dotfiles inside `spec/changes/<name>/` that could be mistaken for tracked artifacts.
- **Consumer-project skill drift.** Projects that installed metta before this change keep the old single-call skill until they rerun `metta install`/refresh their `.claude/skills/` copy — their `check-constitution` will keep failing on missing API keys until refreshed; out of scope per this change's Impact note but worth flagging to consumers.
- **Vendor lock-in:** none introduced — this change *removes* the sole hosted-provider dependency (`@anthropic-ai/sdk`), reducing lock-in to zero for this capability.

## Dependencies

`package.json:32` — remove `"@anthropic-ai/sdk": "^0.39.0"` from `dependencies`; run `npm install` to regenerate `package-lock.json`. No other `engines`/`dependencies` entries change.

## Deletions (US-4)

`src/providers/provider.ts`, `src/providers/anthropic-provider.ts`, `tests/provider.test.ts` — deleted in full. `src/index.ts:4-5` barrel lines removed. `tests/constitution-checker.test.ts` rewritten: drop `MockProvider`/`AIProvider`/`ProviderError` fixtures (lines 10-11, 36-43), add cases exercising `buildCheckContract` (returns expected contract shape for a fixture change) and `recordVerdict` (fixture verdicts: empty, minor-only, unjustified-major, justified-major, critical — asserting `blocking` and `justifiedMap`). `tests/cli-issue-backlog.test.ts:288-323` rewritten per research's "surprise" finding: the two `ANTHROPIC_API_KEY` set/unset cases are replaced with an emission-mode case (no `--record`, asserts contract JSON, exit 0) and a record-mode case (fixture verdict file, asserts exit 0/4); the missing-change assertion of `check_constitution_error` is preserved since `buildCheckContract` still throws on a nonexistent change.

## Constitution & Docs (US-5)

`spec/project.md` Stack section — remove the line `  - Anthropic SDK — AI provider integration`; add a stated principle, e.g.: `**AI execution model:** All AI-driven work runs inside the Claude Code session via skills and subagents (instruction mode); no direct hosted-model provider API calls anywhere in the codebase.` `CLAUDE.md` is regenerated via `/metta-refresh` after the constitution edit lands, committed alongside it so the two never drift (per US-5 AC3). This constitution edit is in-scope and deliberate, not an out-of-band drift fix: the change's own proposal (Impact, item 6) explicitly names updating `spec/project.md` and regenerating `CLAUDE.md` as required steps, and the stale "Anthropic SDK" line is the direct, sole textual artifact of the exact defect this change fixes — leaving it stale would misdescribe the very capability being reworked.
