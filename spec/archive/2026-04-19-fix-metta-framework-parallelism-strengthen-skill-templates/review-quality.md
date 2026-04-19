# Code Review (Quality): fix-metta-framework-parallelism-strengthen-skill-templates

## Verdict

PASS_WITH_WARNINGS

- Critical: 0
- Warnings: 4
- Suggestions: 4

Core implementation (`src/planning/*`, `src/cli/commands/tasks*.ts`) is well-structured, pure, well-commented, and type-safe under strict mode. Both SKILL.md pairs are byte-identical (spec requirement satisfied). Tests are meaningful and exercise real behavior, not just smoke. The warnings concern divergence from explicit `tasks.md` task descriptions (missing typed error classes and Zod schemas that the action copy promised) and one renderer annotation drift from the spec-sample format.

## Findings

### Critical (must fix)

None.

### Warnings (should fix)

1. **Missing `CycleError` / `ParseError` typed error classes** — `src/planning/parallel-wave-computer.ts:196` and `src/planning/tasks-md-parser.ts` throw plain `Error` instances. `tasks.md` Task 1.1 Action explicitly required "a typed `CycleError` with the involved task IDs" and Task 1.2 required "a typed `ParseError`". The barrel export in `src/planning/index.ts` also does not re-export these types even though Task 1.3's Action lists them. The current implementation still satisfies the spec's external contract (exit 4 + mention of cycle task IDs) because `src/cli/commands/tasks.ts:68` regexes the message for `/cycle/i` to map to the `cycle` error type — but downstream consumers that catch errors programmatically cannot discriminate cycle vs malformed vs parse failure without string sniffing. Either add the typed classes as planned, or update `tasks.md` / design docs to record the deliberate simplification.

2. **Missing Zod schemas for `Task`, `Batch`, `TaskGraph`** — `tasks.md` Task 1.1 Action explicitly requires "Zod schemas for `Task`, `Batch`, and `TaskGraph`" and the project conventions in `CLAUDE.md` call for "Validate all state and config with Zod schemas". The `parseTasksMd` output is currently an internal shape consumed only by `computeWaves`, so no runtime boundary crossed, but this is a noted deviation from both the task contract and the project convention. Either add the schemas or justify the omission in the summary.

3. **Cross-batch `dependsOn` edges are silently dropped** — `src/planning/parallel-wave-computer.ts:143` filters `t.dependsOn` through `byId.has(dep)`, which is scoped to the *current* batch only. This is correct for intra-batch cycles and implicitly works for back-references (batch N depending on batch N-1) because batches serialize via `waveStart` numbering, but a forward reference (batch 1 task declaring `Depends on: Task 2.1`) is silently discarded with no warning. A user typo could mask a real ordering bug. Consider either emitting a warning for unresolved `dependsOn` targets (task 1.2's soft-warn model) or documenting this behavior explicitly in the module docblock.

4. **Renderer annotation loses file-path information vs the spec exemplar** — `src/cli/commands/tasks-renderer.ts:45` emits ` (shares files with ${closestPrior})` — a generic "files" token and a task id with no `Task` prefix. The module docblock at lines 7-10 advertises the format `(shares <file> with 2.1)` including the concrete file path. The implementation docblock at line 41-43 explains the simplification ("Without access to the original Task graph we cannot identify the exact shared file path"), which is honest, but the header example is now misleading to anyone reading the file top-down. Either pipe the `TaskGraph` (or a derived shared-file map) through to the renderer so the concrete path can be shown, or update the top-of-file example comment to match what is actually emitted.

### Suggestions (nice to have)

1. **Unused `createCliContext` overhead in `tasks.ts`** — `src/cli/commands/tasks.ts:35` constructs the full `CliContext` (ArtifactStore, WorkflowEngine, GateRegistry, IssuesStore, BacklogStore, GapsStore, SpecLockManager, StateStore, TemplateEngine, InstructionGenerator) but only reads `ctx.projectRoot`. This matches the pattern in sibling commands (see `gate.ts`), so consistency argues for leaving it, but a lightweight helper returning just `projectRoot` would save a non-trivial amount of allocation on a command that is intended to be invoked in a hot CI loop. Not blocking.

2. **Spec scenario `mixed_batch_produces_correct_wave_grouping` has no direct test** — `spec.md` line 131 defines a five-task mixed batch (A, B, C disjoint; D and E each share with A). The closest unit test (`tests/parallel-wave-computer.test.ts:63`) uses a three-task variant. A five-task topology would tighten coverage of the "B and C in wave 1 with D and E later" semantics.

3. **Spec scenario `plan_output_is_tty_safe` has no explicit ANSI assertion** — `tests/cli-tasks-plan.test.ts` sets `NO_COLOR=1` but never asserts the stdout contains no `\x1b\[` sequences. Adding one line (`expect(stdout).not.toMatch(/\x1b\[/)`) would lock the renderer's no-ANSI contract against future regressions.

4. **Hedge word `usually` in SKILL.md discovery section** — `src/templates/skills/metta-propose/SKILL.md:60` ("Soft ceiling: 1–2 open-ended rounds usually suffice") and `src/templates/skills/metta-quick/SKILL.md:42` (same phrase). These fall outside the pre-batch self-check block that the spec protected, so they are technically spec-compliant (spec scenario `self_check_uses_imperative_language` scopes the hedge-word ban to "the self-check directive"). Still, "usually suffice" weakens the neighboring MUST/SHALL voice and could be tightened to a concrete number without losing meaning.

## Notes on Scope Items Checked

- **Code duplication**: No meaningful duplication introduced. Union-find and Kahn's live in one file; the markdown parser reuses the project's `unified + remark-parse` pattern consistent with `constitution-parser.ts`, `spec-parser.ts`, and `stories-parser.ts`.
- **Dead code**: None observed. `splitLeadingBold`, `parseBatchHeading`, `parseTaskHeading`, `parseFilesField`, `parseDependsOn`, `parseTaskItem` are all reachable from `parseTasksMd`.
- **Naming consistency**: `computeWaves`/`parseTasksMd`/`renderHumanPlan`/`renderJsonPlan` all camelCase; `Task`/`Batch`/`TaskGraph`/`Wave`/`BatchPlan`/`WavePlan` all PascalCase; filenames kebab-case. Matches project conventions.
- **Skill-template edits — conciseness**: The pre-batch self-check blocks use RFC 2119 language exclusively (MUST, SHALL, SHALL NOT), state the rule inversion ("parallel is the default"), and require written file-path justification for any sequential choice. Anti-examples use stable fenced-block markers (` ```wrong ` / ` ```right `). Both propose and quick copies are byte-identical (confirmed via `diff`). No hedge words slipped through the self-check directives themselves.
- **Skill-template edits — style**: Minor — the example labels use the exact strings `wrong` and `right` that the spec asks for; no stylistic inconsistencies between propose and quick copies.
- **Test coverage**: Tests are meaningful. `parallel-wave-computer.test.ts` exercises cycle detection, alphabetical tiebreak, cross-batch independence, dependsOn without file overlap, empty files. `tasks-md-parser.test.ts` exercises nested-bullet files, checkbox markers, cross-batch depends, missing fields, empty doc, and a real archived fixture. `cli-tasks-plan.test.ts` is a genuine integration test against the built `dist/cli/index.js`, with error-envelope parsing and a real archive fixture round-trip.
- **TypeScript conventions**: All imports use `.js` extensions (Node16 ESM). Strict mode clean (`tsc --noEmit` exits 0). No `any` in the new modules. No Zod usage in the new modules (see Warning 2).
