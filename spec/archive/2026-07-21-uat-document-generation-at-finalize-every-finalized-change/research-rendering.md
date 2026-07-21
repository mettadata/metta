# Research: UAT.md Rendering Strategy

**Change:** `uat-document-generation-at-finalize-every-finalized-change`
**Topic:** How to render `UAT.md` — template engine strategy under the constitution's rule "Templates as external files — never string literals in TypeScript" (`spec/project.md` lines 29, 37, 58).
**Date:** 2026-07-21

## Constraint from the delta spec

The change's own spec (requirement **UAT Template Externality**, `spec.md` lines 160–174) already pins the mechanism: rendering MUST go through the existing `TemplateEngine` (single-brace `{key}` substitution) over a new external file `src/templates/artifacts/uat.md`, delivered to dist by the unmodified `copy-templates` script. This research therefore (a) validates that decision against the alternatives, (b) resolves the open tension — whether programmatically-assembled step blocks injected as one placeholder violate the no-string-literal-templates rule — and (c) fixes the exact placeholder contract and test plan.

## Existing patterns survey

### TemplateEngine (`src/templates/template-engine.ts`, 44 lines)

- `substitute()` is a single pass of `template.replace(/\{(\w+)\}/g, ...)`. No loops, no conditionals.
- Unmatched placeholders are **preserved** (`context[key] ?? match`) — by design, because artifact templates like `verify.md` are prompt-side documents whose placeholders (`{scenario_checklist}`, `{gate_results_summary}`, `{implementation_summary}`) are filled by the AI agent, not by code. `InstructionGenerator.generate` substitutes only `change_name`/`capability_name` (`src/context/instruction-generator.ts` lines 75–82); nothing in `src/` ever populates `scenario_checklist`.
- Substitution uses a **function callback**, so replacement values are inserted literally — a value containing `{word}` or `$&` is never re-scanned or interpreted. Injecting a large assembled body through one placeholder is safe and single-pass deterministic.

Implication: `uat.md` would be the first artifact template that TypeScript fills **completely and deterministically** (no AI pass). The engine supports this without modification; the contract test just needs to assert full substitution rather than placeholder preservation.

### doc-generator (`src/docs/doc-generator.ts`)

- `renderTemplate()` (public, lines 399–469) implements a hand-rolled Handlebars subset: `{{#each}}` (one nesting level), `{{#if}}`, `{{#unless}}`, `{{var}}`.
- **Zero call sites.** Neither the four generators inside `DocGenerator` nor anything else in `src/` or `tests/` calls `renderTemplate` or `loadTemplate` (verified by grep). All four doc types are assembled with `lines.push(...)` + `join('\n')` (e.g. `generateArchitecture` lines 159–177). The `src/templates/docs/*.md.hbs` files ship to dist but are dormant.

### Precedent for markdown assembly in TypeScript

The codebase builds markdown fragments — and in some cases whole documents — from parsed data in TS today:

- `src/finalize/spec-merger.ts` — `renderRequirementBody()` (line 335) emits `` `### Scenario: ${s.name}\n${steps...}` `` when re-serializing merged requirements; same pattern at lines 151, 184.
- `src/issues/issues-store.ts` (lines 18–31) — serializes the **entire issue document** (`# title`, `**Status**:`, `**Severity**:`, body) via `lines.push`.
- `src/docs/doc-generator.ts` — all four generated docs are 100% `lines.push` assembly, headings included.
- Also: `backlog-store.ts`, `gaps-store.ts`, `tasks-renderer.ts`, `check-constitution.ts`.

**Defensible reading of the constitution rule.** As practiced in this codebase, "no string literal templates" means: a *template document* — a whole-file skeleton with static instructional prose and placeholder slots — must live in a file under `src/templates/`, never inline in TS. It does **not** prohibit *data serialization*: emitting markdown structure driven item-by-item by parsed data (scenario headings in spec-merger, issue metadata lines in issues-store). The boundary the codebase actually enforces is: **static skeleton and prose in the template file; per-item repeating blocks serialized in code.** Option A sits exactly on that boundary. The delta spec's own scenario encodes the same reading: "no TypeScript source file contains **the template body** as a string literal" — the body, not every markdown fragment.

## Options

### Option A — TemplateEngine + skeleton `uat.md`, assembler builds `{uat_steps}` in TS

The template file holds everything static: title, header fields, failure-reporting instructions, section heading. A pure assembler function (functional core) turns parsed stories/scenarios into the story-grouped, numbered, checkboxed step blocks and injects them as one placeholder value.

**Pros**
- Matches the delta spec's UAT Template Externality requirement verbatim.
- Zero engine changes; zero blast radius on the 12 existing artifact templates and their consumers (`InstructionGenerator`, `tests/verify-template-contract.test.ts`, `tests/template-engine.test.ts`).
- Consistent with every existing serializer (spec-merger, issues-store, doc-generator's live path).
- The assembler is a pure function over parsed inputs → trivially unit-testable, byte-determinism testable, satisfies "functional core, imperative shell".
- Tier fallback (3 source tiers with different groupings) and the conditional machine-verified annotation are plain TypeScript logic — no template conditionals needed.

**Cons**
- Step block shape (`- [ ]`, `**Do**:` etc.) lives in code, so changing step formatting means a code change, not a template edit. Acceptable: the block shape is load-bearing structure (the spec pins checkboxes, numbering, grouping), not user-customizable prose.

### Option B — `.md.hbs` + doc-generator-style `renderTemplate`

**Assessment: rejected.**
- `renderTemplate` is public but **orphaned** — no call sites anywhere, including inside `DocGenerator` itself. Reusing it means adopting dead code: extracting it to a shared module, writing its first-ever direct test suite, and owning the quirks of a hand-rolled Handlebars subset (single nesting level, no `{{#if}}` inside `{{#each}}` bodies except property lookup, no whitespace control — which makes byte-identical output across template edits fragile).
- It would introduce a second template syntax (`{{key}}`) into `src/templates/artifacts/`, which today is uniformly single-brace.
- It directly contradicts the delta spec requirement that rendering go through `TemplateEngine` single-brace substitution.
- The machine-verified annotation ("present only when derivable") plus three tier layouts would push the template toward nested conditionals the subset engine cannot express cleanly.

### Option C — extend TemplateEngine with a repeatable-section helper

E.g. `{#each stories}...{/each}` blocks in `substitute()`.

**Assessment: rejected.**
- Blast radius: `substitute()` runs over **every** artifact template rendered by `InstructionGenerator` for every workflow step. Any new block syntax must be proven inert against all 12 existing templates (which deliberately contain unsubstituted `{placeholder}` text destined for AI agents) and against `tests/template-engine.test.ts`'s "preserves unmatched placeholders" contract.
- Loops alone are insufficient — the optional machine-verified annotation needs conditionals, and the three-tier fallback needs branching, so Option C decays into Option B's engine with extra steps.
- `TemplateContext` is typed `string | undefined`; loops need array values, forcing a type change on a shared interface for one consumer.
- 44 lines of engine is a feature. Growing it for a single artifact violates proportionality.

## Recommendation

**Option A.** It is what the delta spec already mandates, it is the cheapest, it matches every existing serialization pattern in the codebase, and the "string literal" tension dissolves under the codebase's own established reading of the rule (spec-merger and issues-store are the controlling precedents). Structure the implementation as:

- `src/templates/artifacts/uat.md` — skeleton (static prose only).
- A pure assembler (e.g. `src/finalize/uat-assembler.ts` or similar, per the plan phase) producing `{ uat_steps, source_tier, ... }` from parsed artifacts.
- The generator constructs `TemplateEngine([artifactsDir])` where `artifactsDir` is resolved the same way `src/cli/commands/finalize.ts` already resolves builtin dirs (`new URL('../../templates/gates', import.meta.url).pathname`, lines 36–41) — i.e. `new URL('../../templates/artifacts', import.meta.url).pathname` — matching how `tests/verify-template-contract.test.ts` constructs its engine.

## Proposed `uat.md` placeholder contract

Exactly four placeholders, all filled by code on every run (no placeholder may survive rendering):

| Placeholder | Value | Notes |
|---|---|---|
| `{change_name}` | change slug | header, self-describing for archive audit |
| `{generated_date}` | `YYYY-MM-DD` | injected clock value so tests can hold it fixed (byte-determinism scenario) |
| `{source_tier}` | one of `user stories (stories.md)` / `spec scenarios (spec.md)` / `intent + summary (fallback)` | records which fallback tier produced the script |
| `{uat_steps}` | assembled story-grouped step blocks | single injection point for the assembler output |

### Template sketch (static skeleton — lives only in the file)

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

### Assembler block shape (serialized in TS — the repeating, data-driven part)

Per story group (tier 1) or per synthetic group (tiers 2–3):

```markdown
### US-1: <story title>

#### Step 1
- **Do**: <derived from Independent Test Criteria / scenario WHEN>
- **Expect**: <derived from THEN clauses>
- **Machine-verified**: <evidence ref>        <- line present only when derivable
- [ ] Pass
```

This satisfies the UAT Document Format requirement: numbered steps (`#### Step N`, numbering global and monotonically increasing across groups for unambiguous issue reports), story-grouped headings keyed by `US-N`, literal `- [ ]` checkbox per step, optional annotation line. Determinism notes: preserve `stories.md`/`spec.md` document order; the substitution callback guarantees source text containing braces or `$` passes through untouched.

## Test implications

1. **`tests/uat-template-contract.test.ts`** (modeled on `tests/verify-template-contract.test.ts`):
   - Reads `src/templates/artifacts/uat.md` directly and asserts it contains each of the four contract placeholders and the failure-reporting sentinel phrase (e.g. `log a metta issue`).
   - Asserts the template contains no `{{` tokens (pins single-brace syntax; guards against handlebars drift).
   - Round-trip: `new TemplateEngine([ARTIFACTS_TEMPLATE_DIR]).render('uat.md', fullContext)` and asserts **none** of the four contract placeholders remain — the inverse of verify.md's preserve-for-the-agent behavior, and it catches adding a placeholder to the template without wiring it in the generator (TemplateEngine preserves unmatched keys, so an unwired placeholder is visible in output).
   - Optional literal-inlining guard for the spec scenario "no TypeScript source file contains the template body as a string literal": grep `src/**/*.ts` for a distinctive skeleton sentinel (e.g. `## Reporting failures`).
2. **`tests/template-deploy-sync.test.ts`** — **no change needed and no break.** It auto-discovers only the `agents`/`skills`/`hooks`/`statusline` families; the header comment (lines 15–17) explicitly excludes artifacts: "Workflows/gates/artifacts/docs are intentionally EXCLUDED: they are copied to `dist/templates/` by the build (`copy-templates`) and have no separately committed deployed copy." A new `uat.md` requires no registration anywhere.
3. **`copy-templates`** (`package.json` line 18) — copies `src/templates/artifacts` recursively with `cp -r`; a new file is swept with zero build-script changes, satisfying the "Template ships to dist via the existing copy step" scenario. No test currently asserts dist contents post-build; the contract test's source-dir assertions plus the unchanged copy step cover it.
4. **`tests/template-engine.test.ts`** — unaffected; optionally extend the "loads built-in artifact templates" case with a `uat.md` load, but the dedicated contract test makes that redundant.
5. **Assembler/generator unit tests** (separate from the template contract): story grouping, global numbering, checkbox presence, annotation present/absent, three tier fallbacks, and byte-determinism (two runs, fixed injected date, `Buffer.equals`).

## Risks

- **Skeleton drift into code.** Future edits could migrate header prose into the assembler. Mitigation: the contract test's sentinel assertions plus the optional grep guard.
- **Missing template at runtime** (e.g. stale dist). `TemplateEngine.load` throws with a clear multi-path message; this is exactly the trigger for the spec's UAT Generation Failure Degradation path (warn, `uatPath: null`, finalize still succeeds) — no extra handling needed in the renderer itself.
- **Source text distorting structure.** Story/scenario text beginning a line with `####` or containing `- [ ]` could visually confuse a group. Low likelihood; mitigate in the assembler by rendering derived text inline after bold labels (never at line start), as sketched above.
- **Format-change friction.** Step block shape changes require code + assembler-test changes rather than a template edit. Accepted tradeoff: the block shape is spec-pinned structure, and Options B/C buy template-side flexibility only at the cost of a second engine or a mutated shared engine.
