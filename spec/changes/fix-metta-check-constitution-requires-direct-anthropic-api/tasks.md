# Tasks: fix-metta-check-constitution-requires-direct-anthropic-api

<!--
Requirement -> Task mapping (spec.md ADDED requirements):
  Contract Emission Without API Credentials (US-1)                        -> 1.1, 4.1
  No Direct AI Provider Invocation (US-1, US-4)                           -> 1.1, 2.1, 4.1
  Verdict Schema Validation (US-2)                                        -> 1.1, 1.3, 4.1
  Verdict Recording and Blocking-Violation Exit Semantics (US-2)          -> 1.1, 1.2, 1.3, 4.1
  Violations Report Format and Location Preserved (US-2, US-3)            -> 1.1, 1.3, 3.1
  Skill-Driven Two-Step Check Flow (US-3)                                 -> 3.1, 4.1
  Idempotent Re-Check Replaces the Prior Verdict (US-2)                   -> 1.1, 1.3

User Story -> Task mapping (stories.md):
  US-1 Constitution check runs without any API key                       -> 1.1, 1.3, 4.1
  US-2 Recording a verdict preserves exit-code/output contract           -> 1.1, 1.2, 1.3, 4.1
  US-3 Skill drives the full two-step flow inside the session            -> 3.1, 4.1
  US-4 No API-auth code paths remain in the codebase                     -> 1.1, 1.2, 2.1, 4.1
  US-5 Constitution and generated docs reflect instruction-mode reality  -> 3.2, 4.1
-->

## Batch 1: Split `checker.ts`, add the `--record` CLI mode, rewrite the two test files that exercise the old provider-based API

### 1.1 [x] Split `checkConstitution` into `buildCheckContract`/`recordVerdict`; add `--record` to the CLI

**Files:**
- `src/constitution/checker.ts`
- `src/cli/commands/check-constitution.ts`
- `.gitignore`

**Action:**
In `src/constitution/checker.ts`:
- Delete `import type { AIProvider } from '../providers/provider.js'` (line 4).
- Delete the `CheckerOptions` interface entirely (lines 24-28). It is replaced by primitive parameters on the two new functions below — do not keep a slimmed-down version, it has no remaining caller.
- Keep `formatArticles` (52-62) and `buildUserPrompt` (64-81) **unchanged in content** — they become the contract's text fields, not an LLM prompt. MOVE `SYSTEM_PROMPT`'s text (lines 30-50) out of TypeScript into a new external template file `src/templates/artifacts/constitution-check-instructions.md` (copied to dist/ at build time like every template family; constitution-check finding — agent-facing instruction content must not live as a TS string literal). `buildCheckContract` reads it from the templates dir at runtime (resolve relative to the module like template-engine/instruction-generator do) and returns it as the `instructions` field. Delete the `SYSTEM_PROMPT` constant.
- Add:
  ```ts
  export interface CheckContract {
    articles: ConstitutionArticles
    specPath: string
    specContent: string
    instructions: string
    formattedPrompt: string
  }

  export class VerdictValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VerdictValidationError'
    }
  }
  ```
  `VerdictValidationError` follows the exact pattern of `ConstitutionParseError` in `src/constitution/constitution-parser.ts:11-15`. It is co-located here but thrown by the CLI layer (`check-constitution.ts`), not by this file's own functions — `recordVerdict` assumes its `verdict` argument is already `ViolationListSchema`-valid.
- Add `buildCheckContract(projectRoot: string, changeName: string): Promise<CheckContract>` — moves the path resolution + `parseConstitution` + `readFile` block (former lines 84-95) verbatim, then returns `{ articles, specPath: specMdPath, specContent, instructions: SYSTEM_PROMPT, formattedPrompt: buildUserPrompt(articles, specMdPath, specContent) }`.
- Add `recordVerdict(verdict: ViolationList, projectRoot: string, changeName: string): Promise<CheckResult>` — recomputes `specMdPath` with the same `join(...)` used in `buildCheckContract`, then absorbs the former lines 103-134 **verbatim** (justification lookup via `parseComplexityTracking(specMdPath)`, blocking classification over `verdict.violations` in place of the old `result.violations`).
- Delete the old `checkConstitution` function and the `generateObject` call block entirely.
- Remove `import { z } from 'zod'` — it was only used for the `generateObject` schema cast, which is gone.
- Keep `AnnotatedViolation`, `CheckResult`, `isBlockingViolation` exports unchanged.

In `src/cli/commands/check-constitution.ts`:
- Delete `import { AnthropicProvider } from '../../providers/anthropic-provider.js'` (line 13).
- Change the import from `../../constitution/checker.js` to `buildCheckContract, recordVerdict, VerdictValidationError, isBlockingViolation, type AnnotatedViolation, type CheckResult` (drop `checkConstitution`).
- Add `import { ViolationListSchema, type ViolationList } from '../../schemas/violation.js'`.
- Add `readFile` to the existing `import { writeFile, mkdir } from 'node:fs/promises'` line.
- Add `.option('--record <file>', 'Path to a verdict JSON file to validate and persist')`.
- Rewrite the `.action()` handler, branching on `options.record`:
  - **Emission (no `--record`):** resolve `changeName` and `assertSafeSlug` as today, then `const contract = await buildCheckContract(ctx.projectRoot, changeName)`. Compute `const outputPath = join('.metta', 'scratch', changeName, 'verdict.json')` (POSIX-relative, this is the conventional record-time input path). If `--json`: `outputJson({ articles: contract.articles, spec_path: contract.specPath, spec_content: contract.specContent, verdict_schema: 'expected shape: {"violations": [{article, severity: critical|major|minor, evidence, suggestion}]}', instructions: contract.instructions, output_path: outputPath })`. Else (human mode): print an article-count/spec-path summary (do **not** dump `specContent` to the terminal) plus a one-line hint to record with `metta check-constitution --change <name> --record <verdict-file>`. Exit `0` on success — emission never inspects `blocking`.
  - **Recording (`--record <file>`):** resolve `changeName`/`assertSafeSlug` as today. `let parsed: unknown` from `JSON.parse(await readFile(options.record, 'utf8'))`, catching parse failures into `throw new VerdictValidationError(...)`. Validate with `ViolationListSchema.safeParse(parsed)`; on failure throw `new VerdictValidationError(...)` built from the Zod error message. On success, `const result = await recordVerdict(verdictResult.data, ctx.projectRoot, changeName)`, then run the **existing, unchanged** `getSpecVersion` / `renderViolationsMd` / `mkdir` / `writeFile` block and the existing `outputJson`/human-report/`process.exit(result.blocking ? 4 : 0)` tail exactly as today. Both parse and schema validation happen strictly before the `mkdir`/`writeFile` call, so a `VerdictValidationError` never touches `violations.md`.
- In the catch-all: set `const errType = err instanceof VerdictValidationError ? 'verdict_validation_error' : 'check_constitution_error'` and use it in the `outputJson({ error: { code: 4, type: errType, message } })` call; keep `process.exit(4)` and the human-mode error line unchanged.

In `.gitignore`: add a `.metta/scratch/` line — the suggested `output_path` is scratch, not a durable tracked artifact.

**Verify:**
```
cd /home/utx0/Code/metta
npx tsc --noEmit
npm run build
FIXTURE=$(mktemp -d)
mkdir -p "$FIXTURE/spec/changes/probe"
cp spec/project.md "$FIXTURE/spec/project.md"
printf '# Spec\n\n## Overview\nProbe change for live check-constitution verification.\n' > "$FIXTURE/spec/changes/probe/spec.md"
( cd "$FIXTURE" && env -u ANTHROPIC_API_KEY node /home/utx0/Code/metta/dist/cli/index.js --json check-constitution --change probe ) | tee "$FIXTURE/contract.json"
# exit 0; JSON must contain articles.conventions, articles.offLimits, spec_path, spec_content, verdict_schema, instructions, output_path
OUT_REL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).output_path)" "$FIXTURE/contract.json")
mkdir -p "$FIXTURE/$(dirname "$OUT_REL")"
echo '{"violations":[]}' > "$FIXTURE/$OUT_REL"
( cd "$FIXTURE" && env -u ANTHROPIC_API_KEY node /home/utx0/Code/metta/dist/cli/index.js --json check-constitution --change probe --record "$OUT_REL" )
# exit 0; spec/changes/probe/violations.md written with "No violations found."
cat "$FIXTURE/spec/changes/probe/violations.md"
rm -rf "$FIXTURE"
```
Both invocations run with `ANTHROPIC_API_KEY` explicitly absent from the child process env (via `env -u`) and must exit `0`. `tests/constitution-checker.test.ts` and `tests/cli-issue-backlog.test.ts` are expected to still fail at this point — they still reference the deleted `checkConstitution`/provider fixtures and are fixed by 1.2/1.3 below.

**Done:** `buildCheckContract`, `recordVerdict`, `VerdictValidationError` are exported from `checker.ts`; no `AIProvider`/`generateObject`/`CheckerOptions` reference remains in either file; the CLI's emission and record modes behave exactly as specified above; both modes succeed live with zero API credential present.

---

### 1.2 [x] Rewrite `tests/constitution-checker.test.ts` against `buildCheckContract`/`recordVerdict`

**Files:**
- `tests/constitution-checker.test.ts`

**Depends on:** 1.1 (imports the new exports).

**Action:** Full rewrite. Keep the `PROJECT_MD` fixture and the `setupProject(specBody)` helper (writes `spec/project.md` + `spec/changes/<name>/spec.md` into a `mkdtemp` temp dir) unchanged. Delete the `mockProvider()` helper and the `AIProvider`/`GenerateOptions`/`ProviderError` imports from `../src/providers/provider.js`. Import `buildCheckContract`, `recordVerdict` from `../src/constitution/checker.js` and `type Violation` from `../src/schemas/violation.js`.

Add contract-emission cases:
- **BCC-1:** `buildCheckContract(projectRoot, changeName)` on a fixture project returns `articles.conventions`/`articles.offLimits` matching `PROJECT_MD`, `specPath` ending in the fixture's `spec.md` path, `specContent` equal to what was written, a non-empty `instructions` string containing the severity rubric (`critical`/`major`/`minor`), and a `formattedPrompt` containing both `<CONSTITUTION>` and `<SPEC path="`.
- **BCC-2:** `buildCheckContract` on a change directory with no `spec.md` written rejects (missing-file error), proving contract emission still fails clearly on a bad change rather than silently succeeding.

Rewrite the former `CHK-1` through `CHK-7` scenarios (clean/minor/unjustified-major/justified-major/critical/mixed/multiple-majors-with-paraphrase-mismatch) to call `recordVerdict({ violations: [...] }, projectRoot, changeName)` directly with the exact same fixture violation arrays, specs, and assertions (`blocking`, `justified`, `justification`, `justifiedMap`) as today — only the call site changes (`recordVerdict(...)` instead of `checkConstitution({ provider, ... })` via a mock). Drop the former `CHK-8` ("provider throws → checker re-throws unchanged") — there is no provider left to throw.

**Verify:**
```
cd /home/utx0/Code/metta
npx vitest run tests/constitution-checker.test.ts
grep -n "AIProvider\|ProviderError\|mockProvider" tests/constitution-checker.test.ts
# expect no matches
```

**Done:** the file imports only `buildCheckContract`/`recordVerdict`/schema types, zero references to `AIProvider`/`ProviderError`/`MockProvider` remain, and every severity/justification scenario from the original suite (minus the dead provider-throws case, plus two new contract-shape cases) passes.

---

### 1.3 [x] Rewrite the `metta check-constitution` block in `tests/cli-issue-backlog.test.ts`

**Files:**
- `tests/cli-issue-backlog.test.ts`

**Depends on:** 1.1 (exercises the new CLI behavior).

**Action:** Replace the `describe('metta check-constitution', ...)` block (current lines 288-353) in full. Add `readFile` (from `node:fs/promises`) and `existsSync` (from `node:fs`) to the file's imports; `mkdir`/`writeFile`/`join` are already imported. Keep the `runCliWithEnv` helper (still useful to prove env-independence explicitly). Add a small local helper that creates a change fixture directly (`mkdir -p spec/changes/<slug>` + `writeFile .../spec.md`) rather than running the full `propose` pipeline, mirroring `tests/constitution-checker.test.ts`'s `setupProject`.

Replace the two API-key-flavored tests with:
- **`'errors with exit 4 on missing change'`** (kept, env simplified) — drop the `ANTHROPIC_API_KEY: 'sk-test-fake'` injection (no longer meaningful); assert `code === 4`, `data.error.code === 4`, `data.error.type === 'check_constitution_error'`.
- **`'emits the check contract with no ANTHROPIC_API_KEY set (emission mode)'`** — create a change fixture with a `spec.md`, run `check-constitution --change <slug> --json` via `runCliWithEnv` with `ANTHROPIC_API_KEY` stripped from the child env (same env-filtering pattern as the old test), assert `code === 0` and the parsed JSON has `articles.conventions`, `articles.offLimits`, `spec_path`, `spec_content`, `verdict_schema`, `instructions`, `output_path`.
- **`'records a clean verdict and exits 0'`** — using the same fixture, write `{"violations":[]}` to a verdict file under `tempDir`, run `check-constitution --change <slug> --record <file> --json`, assert `code === 0`, `data.violations_path` present, and the file at `join(tempDir, data.violations_path)` contains `'No violations found.'`.
- **`'records a blocking verdict and exits 4'`** — verdict file with one `critical` violation, run `--record`, assert `code === 4`, `data.blocking === true`, and the written `violations.md` contains `'BLOCKING'`.
- **`'rejects malformed verdict JSON with exit 4 and does not write violations.md'`** — write non-JSON text to a verdict file for a change whose `violations.md` does not yet exist, run `--record`, assert `code === 4`, `data.error.type === 'verdict_validation_error'`, and `existsSync(join(tempDir, 'spec/changes/<slug>/violations.md'))` is `false` afterward.

Keep `'--help shows the command description'` (add an assertion that `stdout` contains `'--record'`) and `'is registered in the main help listing'` unchanged.

**Verify:**
```
cd /home/utx0/Code/metta
npx vitest run tests/cli-issue-backlog.test.ts
grep -c "ANTHROPIC_API_KEY" tests/cli-issue-backlog.test.ts
npm test
```
`npm test` must be fully green at this point — 1.1, 1.2, 1.3 together close out Batch 1 (`tests/provider.test.ts` still exists and still passes untouched; it is deleted in Batch 2).

**Done:** the block covers emission mode with no credential, missing-change error, clean/blocking/malformed record-mode cases, and the `--help` text mentions `--record`; the full suite (`npm test`) passes.

## Batch 2: Delete the provider abstraction and its dependency

### 2.1 [x] Delete `src/providers/`, `tests/provider.test.ts`, the barrel exports, and `@anthropic-ai/sdk`

**Files:**
- `src/providers/provider.ts` (delete)
- `src/providers/anthropic-provider.ts` (delete)
- `tests/provider.test.ts` (delete)
- `src/index.ts`
- `package.json`
- `package-lock.json`

**Depends on:** 1.1, 1.2, 1.3 (Batch 1 complete — nothing outside `src/providers/` imports these anymore).

**Action:**
- `git rm -r src/providers/` and `git rm tests/provider.test.ts`.
- In `src/index.ts`, remove the two barrel lines `export * from './providers/provider.js'` and `export * from './providers/anthropic-provider.js'` (lines 4-5).
- In `package.json`, remove `"@anthropic-ai/sdk": "^0.39.0",` from `dependencies`.
- Run `npm install` from the repo root to regenerate `package-lock.json` with the dependency removed; stage the regenerated lockfile.

**Verify:**
```
cd /home/utx0/Code/metta
test ! -d src/providers && echo "providers dir removed"
test ! -f tests/provider.test.ts && echo "provider test removed"
grep -rn "anthropic" -i src/ tests/ package.json
# expect exactly the two known-benign hits: src/config-loader.ts's METTA_PROVIDERS__ANTHROPIC__ comment example,
# and tests/config-loader.test.ts's generic 'anthropic' string-value case — no other matches
npm ls @anthropic-ai/sdk 2>&1
# expect "empty" / not-found
npx tsc --noEmit
npm run build
npm test
```

**Done:** `src/providers/` and `tests/provider.test.ts` no longer exist; `src/index.ts` no longer barrel-exports provider symbols; `@anthropic-ai/sdk` is absent from `package.json` and `package-lock.json`; `npm install && npm run build && npm test` all succeed.

## Batch 3: Rewrite the skill for the two-step flow; update the constitution and regenerate `CLAUDE.md`

### 3.1 [x] Rewrite `metta-check-constitution` SKILL.md (template + deployed copy) for the emit/spawn/record flow

**Files:**
- `.claude/skills/metta-check-constitution/SKILL.md`
- `src/templates/skills/metta-check-constitution/SKILL.md`

**Depends on:** 1.1 (the flag/JSON shape it drives), 2.1 (batch ordering only — no content dependency).

**Action:** Replace both files with byte-identical content implementing the three-step flow. Keep the frontmatter `name: metta:check-constitution` and `description` unchanged; change `allowed-tools` to `[Read, Write, Bash, Agent, AskUserQuestion]` (`Write` is needed to capture the subagent's verdict to `output_path`; `Agent` is needed to spawn `metta-constitution-checker`, matching the convention already used by `.claude/skills/metta-plan/SKILL.md`'s frontmatter). Body:

1. **Resolve the change slug** — unchanged logic (`$ARGUMENTS` `--change <name>`, else `metta status --json`, else **AskUserQuestion**).
2. **Emit the check contract.** Bash: `metta check-constitution --change <slug> --json`. Capture `articles`, `spec_path`, `spec_content`, `instructions`, `output_path`. State explicitly that exit `0` here only means the contract was produced — it is not a check result, and the skill must not report "no violations" from this step.
3. **Spawn the subagent.** Spawn `metta-constitution-checker` (Read-only tools, unchanged agent file) with the emitted `articles`/`spec_path`/`spec_content` framed in `<CONSTITUTION>...</CONSTITUTION>` / `<SPEC path="...">...</SPEC>` tags plus `instructions` as task framing. Write its `{"violations": [...]}` output verbatim to `output_path` (create parent directories as needed).
4. **Record.** Bash: `metta check-constitution --change <slug> --record <output_path> --json`.
5. **On exit 0** — echo `No blocking violations` and the `violations_path` from the JSON output (preserves old step 3 verbatim).
6. **On exit 4** — echo `violations_path`, surface each blocking violation (article, severity, evidence) from the JSON `violations` array, and tell the user **verbatim**: "Resolve by editing spec.md — fix each violation or add a justification to the `## Complexity Tracking` section (skip this section for `critical` severity — those are never justifiable)." Report the failure — never report success on exit 4 (preserves old steps 4 verbatim, generalized to also cover the `verdict_validation_error` case).
7. **Never rewrite `violations.md` from this skill** — the CLI command is the sole writer of that file (preserves old step 5 verbatim).

**Verify:**
```
cd /home/utx0/Code/metta
diff .claude/skills/metta-check-constitution/SKILL.md src/templates/skills/metta-check-constitution/SKILL.md
# expect no output (byte-identical)
npx vitest run tests/cli-skills.test.ts
grep -c "ANTHROPIC_API_KEY" .claude/skills/metta-check-constitution/SKILL.md src/templates/skills/metta-check-constitution/SKILL.md
# expect 0 0
grep -n "metta-constitution-checker" .claude/skills/metta-check-constitution/SKILL.md
```

**Done:** both skill copies implement the emit/spawn/record flow, are byte-identical, preserve the exit-4 user-facing guidance verbatim, and `tests/cli-skills.test.ts`'s existing byte-identity/frontmatter assertions for `metta-check-constitution` still pass.

---

### 3.1b [x] Update the metta-plan skill's constitution-check call site to the three-step flow

**Files:**
- `.claude/skills/metta-plan/SKILL.md`
- `src/templates/skills/metta-plan/SKILL.md`

**Action:** metta-plan's step 4 (line ~21 in the deployed copy) directly Bash-invokes `metta check-constitution --change <name> --json` and keys its halt/proceed behavior on exit 4 — after this change that invocation becomes pure contract emission and always exits 0, silently disabling the plan-phase constitution gate (planner-flagged regression, orchestrator-approved scope addition). Replace that step's instructions with the same emit → spawn `metta-constitution-checker` subagent → `--record <verdict-file>` three-step sequence used by the rewritten metta-check-constitution skill (task 3.1), keeping metta-plan's existing exit-0/exit-4 handling semantics against the RECORD invocation's exit code. Apply identically to both copies (byte-identity).

**Verify:**
```
diff .claude/skills/metta-plan/SKILL.md src/templates/skills/metta-plan/SKILL.md
grep -n "record" .claude/skills/metta-plan/SKILL.md
npx vitest run tests/cli-skills.test.ts tests/template-deploy-sync.test.ts
```

**Done:** metta-plan's constitution-check step drives emit/spawn/record; no bare `metta check-constitution --change <name> --json` invocation treated as a verdict remains in either copy; byte-identity tests pass.

---

### 3.2 [x] Update `spec/project.md` Stack section and regenerate `CLAUDE.md`

**Files:**
- `spec/project.md`
- `CLAUDE.md`

**Depends on:** none within this batch (can run alongside 3.1); should land after Batch 2 so the regenerated `CLAUDE.md` reflects a repo state with no provider code left.

**Action:**
- In `spec/project.md`'s `## Stack` section, remove the line `  - Anthropic SDK — AI provider integration` from the `**Frameworks & libraries:**` list.
- Add a new Stack-level bullet after the existing `**Toolchain:**` line: `- **AI execution model:** All AI-driven work runs inside the Claude Code session via skills and subagents (instruction mode); no direct hosted-model provider API calls anywhere in the codebase.`
- From the repo root: `npm run build` (ensures `dist/cli/index.js` reflects current `src/`), then `node dist/cli/index.js refresh --no-commit` to regenerate `CLAUDE.md`'s marker sections from the updated constitution. `--no-commit` is used so this task's own commit carries both `spec/project.md` and the regenerated `CLAUDE.md` together, per design ("committed alongside it so the two never drift") — do not let `metta refresh`'s own auto-commit fire here.

**Verify:**
```
cd /home/utx0/Code/metta
grep -n "Anthropic SDK" spec/project.md CLAUDE.md
# expect no matches in either file
grep -n "AI execution model" spec/project.md CLAUDE.md
# expect a match in both
npx vitest run tests/refresh.test.ts tests/refresh-commit.test.ts
git status --short spec/project.md CLAUDE.md
# both modified and unstaged/staged together, ready for this task's single commit
```

**Done:** `spec/project.md`'s Stack section states the instruction-mode-only principle with no Anthropic SDK reference; `CLAUDE.md` is regenerated via `metta refresh --no-commit` and lands in the same commit as the constitution edit.

## Batch 4: Full sweep

### 4.1 [x] Full gate sweep and final zero-reference proof

**Files:** none (verification-only).

**Depends on:** 1.1, 1.2, 1.3, 2.1, 3.1, 3.2 (all prior batches).

**Action:** Run the complete gate sequence, a final grep sweep, and one more live emission-then-record round trip — including a blocking-verdict case — against the fully rebuilt `dist/`.

**Verify:**
```
cd /home/utx0/Code/metta
npm run build
npx tsc --noEmit
npm test

grep -rn "anthropic" -i src/ package.json
# expect exactly the one known-benign hit: src/config-loader.ts's METTA_PROVIDERS__ANTHROPIC__ comment example
grep -rln "ANTHROPIC_API_KEY" src/ .claude/ src/templates/
# expect zero files
test ! -d src/providers && echo "no providers dir"
diff .claude/skills/metta-check-constitution/SKILL.md src/templates/skills/metta-check-constitution/SKILL.md

FIXTURE=$(mktemp -d)
mkdir -p "$FIXTURE/spec/changes/probe"
cp spec/project.md "$FIXTURE/spec/project.md"
printf '# Spec\n\n## Overview\nFinal sweep probe.\n' > "$FIXTURE/spec/changes/probe/spec.md"
( cd "$FIXTURE" && env -u ANTHROPIC_API_KEY node /home/utx0/Code/metta/dist/cli/index.js --json check-constitution --change probe ) | tee "$FIXTURE/contract.json"
# exit 0
OUT_REL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).output_path)" "$FIXTURE/contract.json")
mkdir -p "$FIXTURE/$(dirname "$OUT_REL")"
printf '{"violations":[{"article":"No singletons","severity":"critical","evidence":"x","suggestion":"y"}]}' > "$FIXTURE/$OUT_REL"
( cd "$FIXTURE" && env -u ANTHROPIC_API_KEY node /home/utx0/Code/metta/dist/cli/index.js --json check-constitution --change probe --record "$OUT_REL" )
# exit 4 (critical is always blocking) — proves the blocking path also works with zero credentials
rm -rf "$FIXTURE"
```

**Done:** `npm run build`, `npx tsc --noEmit`, and `npm test` all pass; the grep sweep finds zero `ANTHROPIC_API_KEY` references and exactly one known-benign `anthropic` string (the `config-loader.ts` comment example) anywhere in `src/`/`package.json`/the deployed skill pair; a full live emission-then-record round trip, including a blocking-verdict case, succeeds/fails with the correct exit codes with no API credential set anywhere in the process environment.
