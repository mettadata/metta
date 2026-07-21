# Tasks for uat-document-generation-at-finalize-every-finalized-change

Decomposition of `design.md` (authoritative) covering the 9 requirements in `spec.md`. Four sequential batches; tasks within a batch touch pairwise-disjoint files. `npm test` and `npx tsc --noEmit` must be green at the end of every batch.

Note on batch shape: the generator's unit tests render through the real template file (`src/templates/artifacts/uat.md`), so the generator task cannot run in parallel with the template task — it sits in Batch 2. The finalizer integration needs both the generator and the config schema (Batch 3), and the CLI needs the extended `FinalizeResult` (Batch 4).

## Batch 1 (no dependencies)

- [ ] **Task 1.1: UatConfigSchema and config-loader coverage**
  - **Files**: `src/schemas/project-config.ts`, `tests/config-loader.test.ts`
  - **Action**: In `src/schemas/project-config.ts`, add after `DocsConfigSchema` (currently line 39), per design.md §Components 5:
    ```ts
    export const UatConfigSchema = z.object({
      enabled: z.boolean().default(true),
    }).strict()

    export type UatConfig = z.infer<typeof UatConfigSchema>
    ```
    Register it on `ProjectConfigSchema` next to `docs` (currently line 97): `uat: UatConfigSchema.default({}),`. Do NOT modify `ConfigLoader` — it parses with `ProjectConfigSchema`, so `config.uat.enabled` appears on every `load()` automatically. Extend `tests/config-loader.test.ts` with four cases: (1) config omitting the `uat` key parses valid with `config.uat` equal to `{ enabled: true }`; (2) explicit `uat: { enabled: false }` is honored; (3) an unknown key inside the `uat` block is rejected with a Zod validation error (strict); (4) `uat: { enabled: "yes" }` (non-boolean) is rejected, not coerced.
  - **Verify**: `npx vitest run tests/config-loader.test.ts` passes; `npx tsc --noEmit` clean; `npm test` fully green (no other test constructs `ProjectConfig` in a way that breaks — `.default({})` keeps existing fixtures valid).
  - **Done**: `UatConfigSchema` and `UatConfig` are exported from `src/schemas/project-config.ts`; `ProjectConfig.uat` is always present after parse; all four new config tests pass; existing config-loader tests unchanged and green. Covers spec requirement "UAT Configuration Toggle" (schema half: omitted-key default, strict rejection scenarios).

- [ ] **Task 1.2: uat.md artifact template and template contract test**
  - **Files**: `src/templates/artifacts/uat.md` (new), `tests/uat-template-contract.test.ts` (new)
  - **Action**: Create `src/templates/artifacts/uat.md` with EXACTLY the content given in design.md §Components 4 — four placeholders (`{change_name}`, `{generated_date}`, `{source_tier}`, `{uat_steps}`), the `## Reporting failures` section directing readers to log a metta issue (`/metta-issue <description>`) referencing the file and step number and not to edit the document, and the `## Acceptance steps` heading above `{uat_steps}`. No build-script changes: `copy-templates` in `package.json` already copies `src/templates/artifacts` wholesale, and `tests/template-deploy-sync.test.ts` excludes the artifacts family (no registration needed). Create `tests/uat-template-contract.test.ts` modeled on `tests/verify-template-contract.test.ts`, asserting: (1) the template file contains all four single-brace placeholders; (2) it contains the `## Reporting failures` heading and the log-a-metta-issue instruction; (3) it contains no `{{` tokens; (4) a full-substitution round trip via `TemplateEngine.render('uat.md', ctx)` with all four keys supplied leaves none of the four placeholders in the output; (5) a grep guard: no file under `src/**/*.ts` contains the skeleton sentinel string `## Reporting failures` as a literal (template externality — prose must not migrate into code).
  - **Verify**: `npx vitest run tests/uat-template-contract.test.ts` passes; `npm run build` then check `dist/templates/artifacts/uat.md` exists and matches source; `npm test` green.
  - **Done**: Template exists with exactly four placeholders and self-describing header prose; contract test pins placeholders, sentinel, round-trip substitution, and the no-string-literal guard; template ships to dist via the unmodified copy step. Covers "UAT Template Externality" and the header portion of "UAT Document Format".

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: uat-generator module — tier ladder, assembly, annotation, determinism**
  - **Depends on**: Task 1.2 (renders through `src/templates/artifacts/uat.md`)
  - **Files**: `src/finalize/uat-generator.ts` (new), `tests/uat-generator.test.ts` (new), `src/index.ts`
  - **Action**: Implement `src/finalize/uat-generator.ts` exactly per design.md §Components 1, §Data Model, and §API Design:
    - Public surface: `UatGeneratorInput` (`changeName`, `changeDir`, injected `generatedAt` — NEVER read the clock, in-memory `gates: GateResult[]`, `gatesPassed`), `UatTier = 'stories' | 'spec' | 'intent-summary' | 'floor'`, `UatGeneratorResult` (`markdown`, `tier`, `warnings`), `generateUat(input): Promise<UatGeneratorResult>`. Add the barrel export to `src/index.ts` alongside the existing finalize exports.
    - Reads (read-only): `parseStories(join(changeDir,'stories.md'))`; own `readFile` of `spec.md` handed to `parseDeltaSpec` (NEVER `parseSpec` — silently empty on deltas); own `readFile` + remark extraction for `intent.md` `## Proposal` and `summary.md` highlights per design.md §Tier fallback tree. MUST NOT modify parser behavior or any source artifact. NO file-path input for gates — annotation consumes only the in-memory `gates`/`gatesPassed` (gates.yaml does not exist at generation time; do not "fix" this).
    - Pure helpers: `norm`, `extractCommands` (backtick span capture + `/^[A-Za-z][\w./-]*(?:\s+\S+)+$/` filter, max 2 hints/step, first-match dedupe), `splitScenarioSteps` (GIVEN/WHEN/THEN/AND role split with inheritance; missing THEN → `(no explicit observable stated — confirm the scenario description holds)`), `isMachineVerified`, and the four tier assemblers.
    - Tier-1 mapping per design table: `### US-N: <title>` groups in array order, `*Independent test:*` preamble, one step per AC (Setup/Do/Observe verbatim, compound THEN one line), `Run:` hints (AC-local wins; ITC hint only on the story's first step and only when no AC in the story yielded a command), constant `- [ ] Pass`. Numbering `Step N.K` per-group. Derived text always inline after bold labels.
    - Delta folding: non-REMOVED scenarios grouped under stories via `requirement.fulfills` (lowest-numbered story on multi-fulfills), appended after AC steps, deduped iff `norm(WHEN+THEN)` exactly equals an emitted AC step's in the same story; dangling fulfills → `## Additional scenarios`.
    - Tier fallback tree exactly as design.md (sentinel/ENOENT → tier 2 silently; malformed → demote + warning; tier-2 acceptance is CONTENT-BASED ≥1 non-REMOVED scenario since `parseDeltaSpec` never throws; tier 3 intent-Proposal + summary highlights with the extraction rules and caps in design.md; floor script last; never "skip"). `{source_tier}` display strings exactly as listed.
    - Machine-verified annotation: only when `gates.length > 0 && gatesPassed`, via the three predicate clauses (15-char normalized floor; `\bUS-N\b` + verification-context line guard); evidence string format per design; structurally skipped at tier 3/floor.
    - Warnings (rungs 2,3,5,6,8) render into the document as a trailing `### Generation notes` section inside `{uat_steps}` AND return in `result.warnings` — they do NOT extend `FinalizeResult`.
    - Rendering: `new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname]).render('uat.md', context)` with the four keys. Error contract: source problems demote-and-warn, never throw; only template load/render failures reject.
    Write `tests/uat-generator.test.ts` covering every group in design.md §Components 6: tier-1 mapping (numbering, Setup/Do/Observe, checkbox per AC, ITC preamble, command-hint extraction incl. rejection of `` `UAT.md` `` and `` `uat.enabled: false` ``); delta folding (grouping, lowest-US multi-fulfills, exact-normalized dedupe, dangling → Additional scenarios, REMOVED skipped); tier fallback (sentinel→spec, missing both→intent+summary, all empty→floor, garbage spec.md content-based demotion) using synthetic fixtures; annotation predicate (each clause fires; 15-char floor; US-id context guard; absent when gates empty or summary missing; absent at tier 3; works with no gates.yaml on disk); error ladder (malformed stories.md demotes with warning, never throws); determinism (two runs, fixed `generatedAt`, `Buffer.from(a).equals(Buffer.from(b))`); no-AI (no provider import in the module graph).
  - **Verify**: `npx vitest run tests/uat-generator.test.ts` passes; `npx tsc --noEmit` clean; `npm test` green.
  - **Done**: `generateUat` is the sole public entry, barrel-exported from `src/index.ts`; all tier, mapping, dedupe, annotation, warning, and determinism behaviors match design.md exactly; no Anthropic SDK import anywhere in the module; byte-identical output on identical inputs. Covers "UAT Source Material Assembly", "UAT Tier Fallback Chain", the body portion of "UAT Document Format", and the determinism/no-AI clauses of "UAT Script Generation At Finalize".

## Batch 3 (depends on Batch 2)

- [ ] **Task 3.1: Finalizer Step 5b integration, FinalizeResult extension, finalizer tests**
  - **Depends on**: Task 2.1 (imports `generateUat`), Task 1.1 (reads `config.uat.enabled`)
  - **Files**: `src/finalize/finalizer.ts`, `tests/finalizer.test.ts`
  - **Action**: Per design.md §Components 2 and §Data Model:
    - Extend `FinalizeResult` with required `uatPath: string | null` and optional `uatError?: string` (doc comments per design). Update ALL SIX return literals in `finalize()` — incomplete artifacts, dry-run-merge conflict, gate failure, caller dry-run, applying-merge conflict get `uatPath: null`; the compiler enforces coverage. These cannot be split across tasks.
    - Insert Step 5b between the applying-merge conflict return and the `// Step 6: Archive` comment, using the exact code block in design.md: `this.projectRoot` guard (silent skip → `uatPath: null`, keeps projectRoot-less test fixtures green), lazy-import shared `ConfigLoader` instance, `config.uat.enabled` check, `generateUat({ changeName, changeDir: join(this.specDir,'changes',changeName), generatedAt: new Date().toISOString().slice(0,10), gates, gatesPassed })`, `artifactStore.writeArtifact(changeName,'UAT.md', result.markdown)` as the LAST statement in the try; catch sets `uatError = getErrorMessage(err)` (new import from `../util/errors.js`) and does a best-effort `deleteIfExists` of the partial file, then finalize proceeds (warn-and-continue).
    - Refactor Step 7 to reuse the shared loader via `configLoader ??= ...` inside its OWN try/catch — independent degradation; Step 7's silent-skip contract unchanged.
    - After `archive()`: `const uatPath = uatGenerated ? join(this.specDir, 'archive', archiveName, 'UAT.md') : null` — derive from `archive()`'s return, never pre-compute `<date>-<name>`. Success literal gains `uatPath` and conditional `uatError` spread. The finalizer never writes to the console.
    Extend `tests/finalizer.test.ts` per design.md §Components 6: UAT.md written pre-archive and present in the archive dir next to the other artifacts; full `uatPath` semantics matrix (success+enabled → archive path; `uat.enabled: false` → null and no UAT.md anywhere; dry-run → null; each abort path → null; no-projectRoot construction → null); no stray `UAT.md` in `spec/changes/<name>/` after incomplete-artifacts, conflict, gate-failure, and dry-run runs; degradation (template dir removed → finalize succeeds, archive exists, `uatPath: null`, `uatError` set, no UAT.md in archive); annotation path works with no gates.yaml on disk (in-memory gate results only).
  - **Verify**: `npx vitest run tests/finalizer.test.ts` passes; `npx tsc --noEmit` clean (proves all six literals updated); `npm test` fully green — including `tests/cli-finalize.test.ts`, which must be unaffected since the CLI does not yet read the new fields and its JSON block spreads named fields only.
  - **Done**: Semantics matrix in design.md §Data Model holds verbatim; every failure/dry-run path exits upstream of Step 5b (no stray file, by construction, pinned by tests); degradation never converts finalize success to failure; `Finalizer.finalize` signature unchanged. Covers "UAT Script Generation At Finalize" (placement, sweep, result field), "No Stray UAT On Failed Finalize Paths", the finalize-skip half of "UAT Configuration Toggle", the never-skipped-when-enabled scenario of "UAT Tier Fallback Chain", and the finalizer half of "UAT Generation Failure Degradation".

## Batch 4 (depends on Batch 3)

- [ ] **Task 4.1: CLI finalize output — uatPath in JSON and human modes**
  - **Depends on**: Task 3.1 (reads `result.uatPath` / `result.uatError`)
  - **Files**: `src/cli/commands/finalize.ts`, `tests/cli-finalize.test.ts`
  - **Action**: Per design.md §Components 3 and §API Design: in the JSON success block add `uatPath: result.uatPath` (always present: string | null) and `...(result.uatError ? { uatWarning: result.uatError } : {})`; all pre-existing fields (`status`, `change`, `archive`, `gates`, `merged`) unchanged; the shared block means `dry_run` payloads carry `uatPath: null` — additive and acceptable. In human mode, in the non-dry-run success branch after the `Specs merged:` line: `if (result.uatPath) console.log(`  UAT script: ${result.uatPath}`)` and `if (result.uatError) console.error(color(`Warning: UAT generation failed: ${result.uatError}`, 33))` (yellow, stderr, exit status untouched). Touch NOTHING else: error JSON shapes (`incomplete_artifacts`, `conflict`, `gates_failed`, `finalize_locked`, `finalize_error`), all exit codes 1-5, the dry-run human branch, and the auto-commit block (which already commits the archive dir wholesale, sweeping UAT.md in). Extend `tests/cli-finalize.test.ts`: success JSON contains `uatPath` as a string pointing into the archive plus all pre-existing fields; `uat.enabled: false` config → `uatPath: null`, no `uatWarning`, no human `UAT script:` line; degraded run (e.g. template removed) → `uatWarning` present, payload remains the success shape, exit 0, human warning on stderr; each error payload byte-compatible with its pre-existing shape and free of `uatPath`.
  - **Verify**: `npx vitest run tests/cli-finalize.test.ts` passes; `npx tsc --noEmit` clean; `npm test` fully green.
  - **Done**: JSON success payload matches the design.md §API Design shape exactly; `uatWarning` appears only on degraded runs; disabled → null path and no human line; error shapes and exit codes byte-for-byte unchanged. Covers "UAT Path In Finalize Output" and the output-reporting half of "UAT Generation Failure Degradation".

## Requirement coverage

| Spec requirement | Task(s) |
|---|---|
| UAT Script Generation At Finalize | 2.1 (determinism, no AI call), 3.1 (Step 5b placement, archive sweep, `FinalizeResult` path field) |
| No Stray UAT On Failed Finalize Paths | 3.1 |
| UAT Source Material Assembly | 2.1 |
| UAT Document Format | 1.2 (self-describing header, reporting instructions), 2.1 (numbered story-grouped steps, checkboxes, annotation) |
| UAT Tier Fallback Chain | 2.1 (ladder + all tier scripts), 3.1 (UAT.md always exists in archive when enabled) |
| UAT Configuration Toggle | 1.1 (schema, defaults, strict rejection), 3.1 (disabled → skip generation, no path reported) |
| UAT Path In Finalize Output | 4.1 (JSON + human surfacing), 3.1 (`uatPath` value semantics) |
| UAT Template Externality | 1.2 (template + contract/grep guard + dist delivery), 2.1 (renders through `TemplateEngine`) |
| UAT Generation Failure Degradation | 3.1 (warn-and-continue, `uatError`, cleanup), 4.1 (`uatWarning` / human warning, success shape, exit 0) |
