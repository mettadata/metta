# Design: uat-document-generation-at-finalize-every-finalized-change

## Approach

Generate `UAT.md` as a **deterministic, pure assembly** over the change's on-disk artifacts, hooked into `Finalizer.finalize` as a new **Step 5b** — after the real spec merge is written and conflict-checked, immediately before `artifactStore.archive()`. The archive `rename` (a directory move, `src/artifacts/artifact-store.ts:108-118`) then sweeps `UAT.md` into `spec/archive/<date>-<name>/` for free, satisfying the "Archive sweep carries UAT.md" scenario with zero extra code. All five failure/dry-run exits in `finalize()` sit upstream of the insertion point, so the "No Stray UAT On Failed Finalize Paths" requirement holds **by construction** — no guards needed.

The generator lives in a new module `src/finalize/uat-generator.ts`: a functional core (pure step assembly over parser output) with a thin imperative shell (four artifact reads, one template render). It never calls an AI provider, never touches the clock (`generatedAt` is injected), and renders through the existing `TemplateEngine` over a new external skeleton `src/templates/artifacts/uat.md` — satisfying "Generation is deterministic with no AI call" and "UAT Template Externality".

Key architecture decisions (all adopted from research.md; recorded here as mini-ADRs):

- **ADR-1: Pre-archive write (Option A from research-finalize-hook.md).** Write to `spec/changes/<name>/UAT.md` via `artifactStore.writeArtifact`, report the path **after** `archive()` returns using its returned `archiveName`. Rationale: mandated verbatim by the spec's first two scenarios; failure paths are structurally upstream; avoids the date-rollover hazard of pre-computing `<date>-<name>`.
- **ADR-2: TemplateEngine skeleton + code-assembled `{uat_steps}` (Option A from research-rendering.md).** Static prose lives in the template file; per-item repeating blocks are serialized in TypeScript — the exact boundary the codebase already enforces (`spec-merger.renderRequirementBody`, `issues-store`). No engine changes.
- **ADR-3: AC-driven steps with ITC preamble + command hints (Option A from research-source-assembly.md).** One step per acceptance criterion; deterministic and lossless.
- **ADR-4: Warn-and-demote error ladder inside the generator; only template load/render/write errors propagate.** The finalizer catches those and degrades (`uatError`, warn-and-continue), per "UAT Generation Failure Degradation".
- **ADR-5: In-memory gate results, not gates.yaml.** See explicit note below.

> **Explicit note — spec wording vs. runtime reality (resolved, do not "fix"):** the "UAT Source Material Assembly" requirement says the generator consults `gates.yaml`, but at Step 5b **gates.yaml does not exist anywhere on disk** — it is written into the archive dir at Step 6b (`finalizer.ts:156-169`), after the move. The generator therefore consumes the Step-4 in-memory `GateResult[]` — the *identical* data Step 6b serializes moments later — which satisfies the requirement's intent. Any implementation that tries to read `gates.yaml` from disk at generation time, or reorders generation after archive, is wrong.

> **Explicit note — generator warnings vs. FinalizeResult shape:** research-source-assembly.md §6 suggests assembly warnings "flow to the finalize output", but the settled `FinalizeResult` shape (research.md, decision 3) carries only `uatPath` and `uatError` — no warnings array — and no spec scenario requires tier-demotion warnings in CLI output (only *degradation* must be reported, via `uatError`). Resolution: tier-demotion warnings are rendered **into the document itself** as a trailing `### Generation notes` section inside `{uat_steps}` (deterministic, archived, auditable) and do not extend `FinalizeResult` or the CLI payload. This honors both pinned decisions without silently dropping the warnings.

## Components

### 1. `src/finalize/uat-generator.ts` (new)

Exports:

```ts
export interface UatGeneratorInput {
  changeName: string
  changeDir: string        // absolute: join(specDir, 'changes', changeName)
  generatedAt: string      // 'YYYY-MM-DD', injected by the finalizer — the
                           // generator MUST NOT read the clock
  gates: GateResult[]      // Step-4 in-memory results (gates.yaml does not exist yet)
  gatesPassed: boolean
}

export type UatTier = 'stories' | 'spec' | 'intent-summary' | 'floor'

export interface UatGeneratorResult {
  markdown: string         // fully rendered document
  tier: UatTier
  warnings: string[]       // tier-demotion / extraction warnings (rungs 2,3,5,6,8)
}

export async function generateUat(input: UatGeneratorInput): Promise<UatGeneratorResult>
```

Responsibilities:

- **Own reads** of `stories.md`, `spec.md`, `intent.md`, `summary.md` from `changeDir` (read-only). `parseStories(join(changeDir, 'stories.md'))` does its own `readFile`; for `spec.md`/`intent.md`/`summary.md` the generator does the `readFile` and hands markdown to `parseDeltaSpec` / local remark extraction. It MUST NOT modify parser behavior or any source artifact.
- **Tier selection** per the fallback tree (see Data Model → Tier fallback), never returning "skip".
- **Step assembly** (pure functions, composed — no inheritance): tier-1 mapping, delta folding, machine-verified annotation, tier-2/3/floor reduced scripts.
- **Rendering** via `new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname]).render('uat.md', context)`. From `src/finalize/`, `../templates/artifacts` resolves to `src/templates/artifacts`; compiled to `dist/finalize/`, it resolves to `dist/templates/artifacts` — same relative depth in both trees, matching the `new URL(...)` pattern in `src/cli/commands/finalize.ts:36-41`.
- **Error contract:** never throws for missing/malformed *source* artifacts (warn-and-demote); only `TemplateEngine.load` failure, render errors, or errors thrown before returning `markdown` propagate to the caller.

Internal structure (non-exported pure helpers, unit-tested through `generateUat` and, where useful, via a small exported-for-test surface):

- `norm(s: string): string` — lowercase, strip backticks and `**`, strip punctuation, collapse whitespace. Used by both the dedupe predicate and the annotation predicate.
- `extractCommands(text: string): string[]` — stage 1 `/`([^`\n]+)`/g` span capture, stage 2 filter `/^[A-Za-z][\w./-]*(?:\s+\S+)+$/` (multi-token, word-ish first token). Max 2 hints per step, first-match-wins dedupe.
- `splitScenarioSteps(steps: string[])` — role split `/^(GIVEN|WHEN|THEN|AND)\b\s*/i`; `AND` and unprefixed steps inherit the preceding role; a scenario with no THEN-role step gets observe-text `(no explicit observable stated — confirm the scenario description holds)`.
- `isMachineVerified(...)` — the predicate in Data Model → Machine-verified annotation.
- Tier assemblers: `assembleFromStories`, `assembleFromSpec`, `assembleFromIntentSummary`, `assembleFloor` — each returns the `{uat_steps}` string.

### 2. `src/finalize/finalizer.ts` (modified)

- `FinalizeResult` gains **required** `uatPath: string | null` and **optional** `uatError?: string` (see Data Model). All six return literals updated — lines 69-78 (incomplete artifacts), 87-95 (dry-run-merge conflict), 111-119 (gate failure), 126-134 (caller dry-run), 141-149 (applying-merge conflict), 193-201 (success). The first five get `uatPath: null`; the compiler enforces coverage.
- **Step 5b** inserted between the close of the applying-merge conflict return (line 150) and the `// Step 6: Archive the change` comment (line 152):

```ts
// Step 5b: Generate UAT.md (pre-archive so the move sweeps it in)
let uatGenerated = false
let uatError: string | undefined
let configLoader: import('../config/config-loader.js').ConfigLoader | undefined
if (this.projectRoot) {
  try {
    const { ConfigLoader } = await import('../config/config-loader.js')
    configLoader ??= new ConfigLoader(this.projectRoot)
    const config = await configLoader.load()
    if (config.uat.enabled) {
      const { generateUat } = await import('./uat-generator.js')
      const result = await generateUat({
        changeName,
        changeDir: join(this.specDir, 'changes', changeName),
        generatedAt: new Date().toISOString().slice(0, 10),
        gates,
        gatesPassed,
      })
      await this.artifactStore.writeArtifact(changeName, 'UAT.md', result.markdown)
      uatGenerated = true
    }
  } catch (err) {
    uatError = getErrorMessage(err) // warn-and-continue; finalize proceeds
  }
}
```

  - `this.projectRoot` guard mirrors Step 7 (line 173): library/test constructions without `projectRoot` silently skip (`uatPath: null`), keeping existing `finalizer.test.ts` fixtures green. The real CLI always passes `projectRoot` (`finalize.ts:43-51`).
  - `getErrorMessage` imported from `../util/errors.js` (verified export at `src/util/errors.ts:7`).
- **Step 7 refactor (shared loader):** Step 7 reuses `configLoader` when Step 5b created it, inside its **own** try/catch: `configLoader ??= new (await import('../config/config-loader.js')).ConfigLoader(this.projectRoot)` then `load()` (per-instance cache makes the second `load()` free). Independent try/catches preserve independent degradation semantics — a UAT failure cannot alter doc generation and vice versa. Step 7's catch stays silent (unchanged contract).
- **Path resolution after archive** (after existing line 153):

```ts
const archiveName = await this.artifactStore.archive(changeName)
const uatPath = uatGenerated ? join(this.specDir, 'archive', archiveName, 'UAT.md') : null
```

  Success return literal (line 193) becomes `{ ...existing, uatPath, ...(uatError ? { uatError } : {}) }`. Never pre-compute `<date>-<name>` — `archive()` computes its own date stamp (`artifact-store.ts:109`), and deriving from its return dodges midnight rollover.

### 3. `src/cli/commands/finalize.ts` (modified)

- **JSON success block** (lines 139-146) gains:

```ts
uatPath: result.uatPath,                                    // always present: string | null
...(result.uatError ? { uatWarning: result.uatError } : {}), // degraded runs only
```

  All pre-existing fields (`status`, `change`, `archive`, `gates`, `merged`) unchanged. The block is shared with dry-run, so `dry_run` payloads carry `uatPath: null` — additive and harmless; the spec constrains only the `finalized` payload.
- **Human mode**, non-dry-run success branch, after the `Specs merged:` line (line 169):

```ts
if (result.uatPath) console.log(`  UAT script: ${result.uatPath}`)
if (result.uatError) console.error(color(`Warning: UAT generation failed: ${result.uatError}`, 33))
```

  No line when disabled (`uatPath === null`, no `uatError`). Warning is yellow (`color(..., 33)` from `../helpers.js`, already imported) on stderr; exit status untouched (no `process.exit` path involved).
- **Untouched:** error JSON shapes `incomplete_artifacts` (lines 63-69), `conflict` (82-87), `gates_failed` (100-106), `finalize_locked` (line 196), `finalize_error` (line 200); all exit codes; the dry-run human branch (148-158); the auto-commit block (177-193) — it already adds `spec/archive/${result.archiveName}` wholesale, so the swept-in `UAT.md` commits automatically.

### 4. `src/templates/artifacts/uat.md` (new)

Exactly four placeholders, all filled by code on every run. Full content:

```markdown
# UAT: {change_name}

- **Change**: {change_name}
- **Generated**: {generated_date}
- **Source**: {source_tier}

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
Do not edit this document to make a step pass.

## Acceptance steps

{uat_steps}
```

Ships to `dist/templates/artifacts/uat.md` via the existing `copy-templates` script (`package.json` line 18 already does `cp -r src/templates/artifacts dist/templates/artifacts`) — **no build-script changes**. `tests/template-deploy-sync.test.ts` needs no registration (artifacts family is explicitly excluded there).

### 5. `src/schemas/project-config.ts` (modified)

```ts
export const UatConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

export type UatConfig = z.infer<typeof UatConfigSchema>
```

Placed after `DocsConfigSchema` (line 39). Registered on `ProjectConfigSchema` next to `docs` (line 97):

```ts
uat: UatConfigSchema.default({}),
```

`.strict()` rejects unknown keys within `uat`; `z.boolean()` rejects non-boolean `enabled`; `.default({})` + inner `.default(true)` keeps existing configs that omit `uat` valid with generation enabled. `ConfigLoader` needs no change — it parses with `ProjectConfigSchema`, so `config.uat.enabled` appears on every `load()`.

### 6. Tests (new + extended)

- **`tests/uat-generator.test.ts`** (new): tier-1 mapping (per-story numbering, Setup/Do/Observe, checkbox per AC, ITC preamble, command-hint extraction incl. rejection cases like `` `UAT.md` `` and `` `uat.enabled: false` ``); delta folding (fulfills grouping, lowest-US on multi-fulfills, exact-normalized dedupe, dangling → Additional scenarios, REMOVED skipped); tier fallback (sentinel→spec, missing both→intent+summary, all empty→floor; content-based tier-2 detection with garbage spec.md); annotation predicate (each clause fires; 15-char floor; US-id context guard; absent when gates empty / summary missing; structurally absent at tier 3); error ladder (malformed stories.md demotes with warning, never throws); determinism (two runs, fixed `generatedAt`, `Buffer.from(a).equals(Buffer.from(b))`); no-AI (no provider import in module graph — assert by construction/mock absence).
- **`tests/uat-template-contract.test.ts`** (new, modeled on `tests/verify-template-contract.test.ts`): template contains all four placeholders `{change_name}` `{generated_date}` `{source_tier}` `{uat_steps}` and the `## Reporting failures` heading with the log-a-metta-issue instruction; no `{{` tokens; full-substitution round trip via `TemplateEngine.render` leaves none of the four placeholders; grep guard that no `src/**/*.ts` file contains the skeleton sentinel `## Reporting failures` as a string literal.
- **`tests/finalizer.test.ts`** (extended): Step 5b writes UAT.md pre-archive and it lands in the archive dir; `uatPath` semantics matrix (success+enabled → archive path; disabled → null; dry-run → null; each abort path → null; no-projectRoot construction → null); no stray `UAT.md` in `spec/changes/<name>/` after incomplete-artifacts / conflict / gate-failure / dry-run runs; degradation (template dir removed → finalize succeeds, archive exists, `uatPath: null`, `uatError` set, no UAT.md in archive).
- **`tests/cli-finalize.test.ts`** (extended): success JSON contains `uatPath` string and all pre-existing fields; disabled config → `uatPath: null`, no `uatWarning`, no human UAT line; degraded → `uatWarning` present, exit 0; error payloads unchanged (no `uatPath`).
- **`tests/config-loader.test.ts`** (extended): omitted `uat` → `{ enabled: true }`; explicit `uat: { enabled: false }` honored; unknown key in `uat` block rejected; `enabled: "yes"` rejected.

## Data Model

### `FinalizeResult` delta (`src/finalize/finalizer.ts:11-24`)

```ts
export interface FinalizeResult {
  changeName: string
  archiveName: string
  specMerge: MergeResult
  gates: GateResult[]
  gatesPassed: boolean
  docsGenerated: string[]
  refreshed: boolean
  incompleteArtifacts?: Array<{ id: string; status: ArtifactStatus }>
  /** Post-archive path to the generated UAT.md; null when generation was
   *  disabled, skipped (dry-run / abort paths / no projectRoot), or degraded. */
  uatPath: string | null
  /** Set only when UAT generation failed and finalize degraded. */
  uatError?: string
}
```

Semantics matrix (normative):

| Path | `uatPath` | `uatError` |
|---|---|---|
| Success, `uat.enabled: true` | `join(specDir, 'archive', archiveName, 'UAT.md')` | absent |
| Success, `uat.enabled: false` | `null` | absent |
| Dry-run | `null` | absent |
| Abort: incomplete / conflict (either) / gates | `null` | absent |
| Degraded (template load / render / write threw) | `null` | error message |

### Config

`UatConfig = { enabled: boolean }` (default `true`), strict; `ProjectConfig.uat: UatConfig` always present after parse via `.default({})`.

### Document model (internal to the generator)

```ts
interface UatStep {
  label: string            // 'Step 1.2' — per-story/per-group numbering N.K
  title?: string           // scenario name for scenario-derived steps
  setup?: string           // GIVEN-role text
  doText: string           // WHEN-role text (+ up to 2 appended `Run:` hints)
  observe: string          // THEN-role text (compound THENs stay one line)
  machineVerified?: string // evidence string; line rendered only when present
}
interface UatGroup {
  heading: string          // '### US-1: <title>' | '### <requirement name>' | synthetic
  preamble?: string        // '*Independent test:* <ITC>' (tier 1 only)
  trace?: string           // '*Fulfills: US-1, US-2*' (tier 2 only)
  steps: UatStep[]
}
```

Rendered step block shape (serialized in TS — the data-driven part; the frame lives in the template):

```markdown
### US-1: Story title

*Independent test:* Running `metta finalize` on a complete change leaves a UAT.md ...

#### Step 1.1: Scenario or AC-derived title
- **Setup**: <given>
- **Do**: <when> (Run: `metta finalize --json`)
- **Observe**: <then>
- **Machine-verified** — summary.md references "US-1"; gates all passed (tests, lint)
- [ ] Pass
```

Derived text always renders inline after bold labels (never at line start) so source text containing `####` or `- [ ]` cannot distort structure. Numbering is per-story/per-group (`Step N.K` where N is the 1-based group ordinal, K the 1-based step ordinal within the group) so inserting a step in one story never renumbers another.

### Tier-1 assembly mapping (from stories.md, kind `stories`)

| Source | Output | Rule |
|---|---|---|
| `Story.id` + `Story.title` | `### US-N: <title>` group | Array order (parser enforces monotonic US-1..US-n) |
| `Story.independentTestCriteria` | `*Independent test:* <ITC>` preamble | Verbatim; inline code preserved by parser |
| Each `AcceptanceCriterion` | One step, in order | 1:1, lossless |
| `ac.given` / `ac.when` / `ac.then` | Setup / Do / Observe | Verbatim; compound THEN stays one Observe line |
| Backticks in AC text, else story ITC | `Run:` hint on Do line | Extraction regex above; AC-local wins; ITC hint attaches only to the story's first step and only when no AC in the story yielded a command; max 2 hints/step |
| — | `- [ ] Pass` | Constant, every step |

**Delta folding:** parse `spec.md` with `parseDeltaSpec` — **never** `parseSpec`, which returns silently-empty on delta files (`spec-parser.ts:83` sees no plain `Requirement:` H2s). Include scenarios from deltas with `operation !== 'REMOVED'`. Group under stories via `requirement.fulfills` (exposed by `parseFulfillsLine`, `spec-parser.ts:23-40`, for both `Fulfills:` and `**Fulfills:**` forms); multi-fulfills attaches to the **lowest-numbered** listed story only. Scenario-derived steps append after AC-derived steps under the story heading, titled with the scenario name. Dedupe: drop a scenario step iff `norm(WHEN+THEN)` exactly equals `norm(ac.when + ac.then)` of an already-emitted AC step in the same story — exact-normalized only, never similarity-scored. Scenarios with empty/dangling `fulfills` group under a trailing `## Additional scenarios` section.

### Tier fallback tree

```
Tier 1: parseStories(changeDir/stories.md)
  kind 'stories'                        → full script (tier: 'stories')
  kind 'sentinel'                       → Tier 2 (no warning; expected)
  StoriesParseError (ENOENT)            → Tier 2 (no warning; expected for quick tier)
  StoriesParseError (malformed) / other → Tier 2 + warning
Tier 2: readFile(changeDir/spec.md) → parseDeltaSpec
  file missing (ENOENT)                 → Tier 3 (no warning)
  read error                            → Tier 3 + warning
  ≥1 scenario in non-REMOVED deltas     → reduced script A (tier: 'spec')
  zero such scenarios (incl. garbage)   → Tier 3 + warning  [content-based check —
                                          parseDeltaSpec NEVER throws]
Tier 3: intent.md '## Proposal' + summary.md highlights
  any content                           → reduced script B (tier: 'intent-summary')
  both empty/unreadable                 → floor script + warning (tier: 'floor')
```

Reduced script A groups by requirement (`### <requirement.name>`, document order), steps from the role-split scenario steps, `*Fulfills: ...*` trace line when non-empty. Reduced script B: intent `## Proposal` extraction via remark (collect nodes after the H2 titled `Proposal`, case-insensitive, until the next heading of depth ≤ 2; top-level list items → steps; else depth-3 headings → step titles; else paragraphs, cap 10) plus summary highlights (first non-heading paragraph after the H1 as preamble; top-level list items under the first H2 matching `/what changed|changes|behavior|files changed|checks?/i`, cap 10; else first list in the document). Tier-3 steps are confirmation prompts: Do = `Confirm: <bullet>`, Observe = `behaves as described`. Floor script: one group, one step — "Review the archived change artifacts and confirm the described behavior works" + checkbox. The chain **never** returns "skip": when `uat.enabled`, a UAT.md always exists on the success path.

`{source_tier}` display strings (exact): `stories` → `user stories (stories.md)`; `spec` → `spec scenarios (spec.md)`; `intent-summary` → `intent + summary (reduced)`; `floor` → `floor script (no structured sources)`.

### Machine-verified annotation

Let `S = norm(summary.md full text)` (empty string when missing/unreadable — never an error) and `gatesOk = gates.length > 0 && gatesPassed` (in-memory Step-4 results; zero configured gates vacuously "pass" and MUST NOT count as evidence). A step is annotated iff `gatesOk` AND at least one of:

1. scenario-derived step: `S.includes(norm(scenario.name))` and `norm(scenario.name).length >= 15`;
2. any step: `S.includes(norm(requirement.name))` for the deriving requirement, same 15-char floor;
3. AC-derived step: raw summary matches `/\bUS-N\b/` for the step's story id AND the physical line containing the match also matches `/verif|test|pass|green|covered|✓|check/i`.

Evidence string: `machine-verified — summary.md references "<matched name | US-N>"; gates all passed (<comma-joined gate names>)`. Absent silently otherwise. **Structurally skipped** for tier-3 and floor scripts (steps there derive *from* summary.md — self-referential matching would annotate everything).

## API Design

### Module API

- `generateUat(input: UatGeneratorInput): Promise<UatGeneratorResult>` — sole public entry of `src/finalize/uat-generator.ts` (shapes above). Contract: source problems demote and warn; only template load/render failures and write-adjacent errors reject the promise. Barrel export from `src/index.ts` alongside the existing finalize exports.
- `Finalizer.finalize(changeName, dryRun)` — signature unchanged; `FinalizeResult` extended as specified. The finalizer never writes to the console; degradation travels on the result (`uatError`), consistent with the existing surface-in-CLI discipline.
- `UatConfigSchema` / `UatConfig` exported from `src/schemas/project-config.ts`.

### CLI surface (`metta finalize`)

`--json` success payload (`finalized`):

```json
{
  "status": "finalized",
  "change": "<name>",
  "archive": "<date>-<name>",
  "gates": [ ... ],
  "merged": [ ... ],
  "uatPath": "/abs/spec/archive/<date>-<name>/UAT.md"
}
```

`uatPath` is always present: the path string on success, `null` on disabled/degraded (and on `dry_run` payloads, additively). `uatWarning: "<message>"` appears **only** on degraded runs. Error payloads (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`) and exit codes 1/2/3/4/5 are byte-for-byte unchanged and never gain `uatPath`.

Human mode success adds one line after `Specs merged:`:

```
  UAT script: /abs/spec/archive/<date>-<name>/UAT.md
```

and, on degradation only, a yellow stderr line `Warning: UAT generation failed: <reason>` with exit 0. Disabled → neither line.

### Generated document API (the UAT.md contract)

Header (change name, generated date, source tier, `## Reporting failures` with metta-issue instructions) is fully self-describing for archive audit — no live-change dependency. Body: `## Acceptance steps` → story/requirement groups → `#### Step N.K` blocks with Setup/Do/Observe/optional Machine-verified/`- [ ] Pass`, optional `## Additional scenarios`, optional `### Generation notes` (assembly warnings).

## Dependencies

**Internal (all existing; consumed read-only unless noted):**

- `src/specs/stories-parser.ts` — `parseStories`, `StoriesParseError` (unmodified).
- `src/specs/spec-parser.ts` — `parseDeltaSpec`, `ParsedDelta`, `ParsedRequirement` (unmodified).
- `src/templates/template-engine.ts` — `TemplateEngine` (unmodified; function-callback substitution inserts assembled body text literally, so braces/`$` in source text are safe — single-pass determinism holds).
- `src/artifacts/artifact-store.ts` — `writeArtifact` (write path), `archive` return value (path derivation). Unmodified.
- `src/config/config-loader.ts` — lazily imported, shared instance across Steps 5b/7 (unmodified).
- `src/schemas/gate-result.ts` — `GateResult` type.
- `src/util/errors.ts` — `getErrorMessage` (new import in finalizer.ts).
- `unified` + `remark-parse` — already dependencies; used by the generator for intent/summary extraction (house pattern; zero new deps).
- `copy-templates` build step — delivers the new template unmodified.

**External:** none added. Explicitly **not** used: the Anthropic SDK (determinism requirement forbids AI calls), `doc-generator.renderTemplate` (orphaned dead code, second template syntax — rejected in research-rendering.md). No vendor lock-in introduced anywhere in this change.

## Risks & Mitigations

1. **Non-atomic write** — `writeArtifact` → `StateStore.writeRaw` is a plain `writeFile`; a mid-write crash could sweep a truncated UAT.md into the archive. *Mitigation:* assemble and render the entire document in memory; `writeArtifact` is the last statement in the try; the catch calls `state`-level cleanup via a best-effort delete of the partial file (`StateStore.deleteIfExists`). Residual risk negligible for a single-string write.
2. **Reviewer "fixes" the generator to read gates.yaml** — which does not exist at Step 5b. *Mitigation:* explicit note in Approach; the `UatGeneratorInput` type has no file-path field for gates, only in-memory `gates`/`gatesPassed`; test asserts annotation works with no gates.yaml on disk.
3. **`parseDeltaSpec` never throws** — a try/catch-only tier-2 check would emit an empty reduced script for garbage spec.md. *Mitigation:* tier-2 acceptance is content-based (≥1 scenario across non-REMOVED deltas), pinned by a dedicated test with garbage input.
4. **Annotation false positives** (short names, incidental US-id mentions). *Mitigation:* 15-char normalized floor, US-id verification-context line guard, `gates.length > 0` requirement; the rendered annotation carries its evidence string so a reader can judge; honest "cross-reference" wording, never "per-step test run".
5. **Tier 2 unexercised by dogfooding** — no sentinel-stories-with-spec change exists in current archives; quick tier produces neither stories nor spec. *Mitigation:* synthetic fixtures in `tests/uat-generator.test.ts` (sentinel stories.md + delta spec.md).
6. **Determinism leaks** — `Date.now()`, fs ordering, `Object.keys` over maps. *Mitigation:* `generatedAt` injected; all iteration over parser arrays (document order); byte-identical-twice unit test with fixed date is the tripwire.
7. **Skeleton drift into code** (template prose migrating into the assembler). *Mitigation:* contract test asserts the four placeholders and the `## Reporting failures` sentinel live in the template file and that no `src/**/*.ts` contains the sentinel literal.
8. **`uatPath` required-field ripple** — all six `FinalizeResult` return literals must change. *Mitigation:* compiler-enforced; no test constructs `FinalizeResult` literals directly (verified in research), so only new assertions are needed.
9. **Missing template at runtime** (stale dist). *Mitigation:* `TemplateEngine.load` throws a clear multi-path message; this is exactly the degradation trigger — finalize still succeeds, `uatError` reports it, and the finalizer/CLI tests pin that path.
10. **Shared ConfigLoader coupling** between Steps 5b and 7. *Mitigation:* shared *instance*, independent try/catches — a `load()` failure in Step 5b degrades UAT only; Step 7 retries its own `??=` construction and keeps its silent-skip contract.
