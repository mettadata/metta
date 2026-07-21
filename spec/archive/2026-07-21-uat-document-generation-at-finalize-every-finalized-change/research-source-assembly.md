# Research: UAT Source Assembly — Deriving Steps from Change Artifacts

**Change:** `uat-document-generation-at-finalize-every-finalized-change`
**Topic:** How the assembler derives UAT steps — data availability, parser contracts, tier fallback mechanics, machine-verified annotation derivation, error handling.
**Scope note:** This document covers source assembly only. Template rendering, config toggle, and CLI output surfacing are covered by sibling research docs.

---

## 1. Data availability audit (what actually exists at generation time)

### 1.1 Parser contracts (verified against source)

| Parser | Location | Signature | Output shape | Throws? |
|---|---|---|---|---|
| `parseStories` | `src/specs/stories-parser.ts` | `(path) => Promise<StoriesDocument>` (does its own `readFile`) | Discriminated union: `{kind:'stories', stories: Story[]}` or `{kind:'sentinel', justification}` | **Yes, frequently.** `StoriesParseError` on: file missing (ENOENT), missing required story fields, zero acceptance criteria, invalid priority, duplicate/non-monotonic/non-numeric US ids, no stories and no sentinel. Non-ENOENT fs errors rethrow raw. |
| `parseSpec` | `src/specs/spec-parser.ts` | `(markdown) => ParsedSpec` (caller reads file) | `{title, requirements: ParsedRequirement[]}` | Effectively never — remark parses anything; unrecognized content yields empty/partial structures. |
| `parseDeltaSpec` | `src/specs/spec-parser.ts` | `(markdown) => ParsedDeltaSpec` | `{title, deltas: [{operation: 'ADDED'\|'MODIFIED'\|'REMOVED'\|'RENAMED', requirement: ParsedRequirement}]}` | Effectively never. Garbage input → `{title:'', deltas:[]}`. Tier detection must check **content emptiness**, not exceptions. |

`ParsedRequirement` (both spec parsers): `{id, name, text, keyword, scenarios: [{name, steps: string[]}], hash, fulfills: string[], warnings: string[]}`.

**Key confirmation — `fulfills[]` IS exposed.** `parseFulfillsLine` (spec-parser.ts:23-40) matches both `Fulfills: US-1, US-2` and `**Fulfills:** ...` paragraph lines in `parseSpec` AND `parseDeltaSpec`, populating `requirement.fulfills` with validated `US-\d+` tokens (malformed lines → `fulfills: []` + a warning). So delta scenarios can be joined to stories **by requirement-level `fulfills`** — no text matching needed for grouping. Granularity caveat: `fulfills` is per-requirement, not per-scenario; every scenario under a requirement inherits the same US set.

Scenario steps are flat strings with their GIVEN/WHEN/THEN/AND prefixes preserved, e.g. `"GIVEN a standard-tier change with all required artifacts complete, ..."` — the assembler must split roles itself (Section 3.2).

Inline code survives both parsers: `extractText` in both files renders `inlineCode` nodes as `` `value` `` (stories-parser.ts:20, spec-parser.ts:66). Backtick-based command extraction therefore works on parsed text — no need to re-read raw markdown.

### 1.2 Artifact presence per tier (verified against workflow YAMLs and real archives)

| Artifact | full/standard | quick (aliased from `trivial` too — `workflow-engine.ts:24`) |
|---|---|---|
| `intent.md` | yes | yes |
| `stories.md` | yes (may be sentinel for infra changes) | **no** — quick.yaml has no stories artifact |
| `spec.md` (delta) | yes | **no** — quick.yaml has no spec artifact |
| `summary.md` | yes (verifier output) | yes |
| `gates.yaml` | — see 1.3 | — see 1.3 |

Verified against real archives: `spec/archive/2026-07-17-fix-metta-install-deploys-hooks-hardcoded-list-omitting/` (quick: `gates.yaml intent.md summary.md` only) vs `2026-07-17-model-tier-routing-orchestration-agents-top-tier-models/` (standard: full artifact set including `stories.md`). So for real quick changes the practical path is **tier 3** (intent + summary); tier 2 fires mainly for standard changes with sentinel stories, or future workflows that produce spec without stories.

### 1.3 Critical ordering constraint: gates.yaml does not exist yet

`Finalizer.finalize` (src/finalize/finalizer.ts) runs gates at **Step 4** (in-memory `GateResult[]`), archives at **Step 6** (`artifactStore.archive`), and only writes `gates.yaml` at **Step 6b — into the archive dir, after the move**. The UAT spec requires UAT.md to be written after the real merge (Step 5b) and **before** archive (Step 6). Therefore at generation time:

- `gates.yaml` **does not exist on disk anywhere**. The requirement's "consult gates.yaml" can only be satisfied by consuming the **same in-memory data that becomes gates.yaml**: the Step-4 `gates: GateResult[]` and `gatesPassed: boolean`. The finalizer must pass these into the assembler.
- `summary.md` DOES exist on disk in `spec/changes/<name>/` (it is a workflow artifact, completeness-gated before finalize proceeds).
- `GateResult` shape (`src/schemas/gate-result.ts`): `{gate, status: 'pass'|'fail'|'warn'|'skip', duration_ms, output?, failures?}`. Gate names are suite-level (`tests`, `lint`, `typecheck`, `build`) — **no per-scenario information whatsoever**.

Also note: on the successful-finalize path gates have already passed (or zero gates were configured, which counts as pass). So "gates all passed" is nearly always true at generation time and is a weak discriminator on its own — see Section 5.

### 1.4 summary.md is freeform, with one semi-reliable convention

`verify.md` template (`src/templates/artifacts/verify.md`) *instructs* the verifier to include `## Spec Scenarios`, `## Gate Results`, `## Summary` sections, but summary.md is agent-authored prose and drifts. Sampled archives show:

- Standard-tier summaries often carry a `## Spec Scenarios` table mapping scenario/requirement names to test names (e.g. `2026-04-28-fix-finalize-stage-.../summary.md` — "Spec Scenarios — all green" table).
- Quick-tier summaries use ad-hoc `## Check N` sections, verdict lines, story-id mentions like "US-5 (Rung-2 reuse) verified" (`2026-07-17-model-tier-routing.../summary.md`).
- No schema, no guaranteed section. **Any summary-based cross-reference must be substring matching over the whole normalized document, not section parsing.**

---

## 2. Step derivation mapping — options

### Option A — AC-driven steps, ITC as story preamble + command-hint source (recommended)

Each acceptance criterion becomes exactly one numbered step. The story's Independent Test Criteria renders as an italic preamble line under the story heading AND is mined for backtick commands that are appended as `Run:` hints to steps whose own when-text carries no command.

- Pros: 1:1 AC→step is fully deterministic and lossless; observe-text maps cleanly from `then`; ITC commands genuinely flow into do-text (satisfying the "what-to-do derives from ITC including named CLI invocations" scenario); no artificial steps that duplicate the ACs they summarize.
- Cons: the ITC sentence itself is not independently checkable (it's a preamble, not a checkbox); a strict reading of "what-to-do derives from ITC" leans on the command-hint flow plus preamble.

### Option B — ITC as the story's lead step, ACs as follow-on steps

Step N.1 per story: do = ITC text; observe = "the stated criterion holds". Steps N.2+ from ACs.

- Pros: ITC is literally a checkable step; strongest literal compliance with the format scenario.
- Cons: ITC is a compressed restatement of the ACs — the lead step duplicates the steps below it; its observe-text is vacuous because ITCs are single sentences fusing action and outcome ("Running `metta finalize` ... leaves a UAT.md ... containing numbered steps") that cannot be split deterministically without fragile sentence surgery.

### Option C — spec scenarios as primary source even at tier 1, stories only for grouping

- Pros: scenario steps already come pre-split into GIVEN/WHEN/THEN strings.
- Cons: contradicts the spec ("acceptance criteria ... MUST be read from stories.md"; fallback chain says stories → full script); loses ITC and story narrative; delta spec may omit behavior covered only in ACs. Rejected.

**Recommendation: Option A**, with one refinement from B: when a story's ACs contain **no** extractable command but its ITC does, the ITC command hint attaches to the story's first step, so every story with a named CLI invocation surfaces it in a step's do-text.

### 2.1 Exact mapping rules (tier 1)

| # | Source field | UAT output | Rule |
|---|---|---|---|
| M1 | `Story.id` + `Story.title` | `## US-N: <title>` group heading | Stories in array order (parser enforces monotonic US-1..US-n). |
| M2 | `Story.independentTestCriteria` | Preamble line under heading: `*Independent test:* <ITC text>` | Verbatim; markdown inline code preserved by parser. |
| M3 | `AcceptanceCriterion` (one per AC, in order) | One numbered step `### Step <g>.<k>` with checkbox | Global or per-story numbering — recommend per-story (`1.1, 1.2 … 2.1`) so insertion in one story doesn't renumber all. |
| M4 | `ac.given` | Step line `Setup: <given>` | Verbatim, first letter capitalized. |
| M5 | `ac.when` (+ command hints, rule M7) | Step line `Do: <when>` | Verbatim. |
| M6 | `ac.then` | Step line `Observe: <then>` | Verbatim. Compound THENs (parser folds `**Then** X **And** Y`-style tails into one `then` string) stay one observe-line — do not split. |
| M7 | Backtick spans in `ac.given/when/then`, else story ITC | Appended `Run:` hint on the Do line | Extraction regex in 2.2. AC-local commands win; ITC commands attach only to the story's first step and only when no AC in the story yielded a command. |
| M8 | — | `- [ ] Pass` checkbox line per step | Constant. |

All rules are pure string transforms over parser output — no clock, no fs, no AI → byte-determinism holds given fixed inputs.

### 2.2 CLI-invocation extraction regex

Two-stage, operating on parser-emitted text (backticks preserved per 1.1):

```
stage 1 (span capture):   /`([^`\n]+)`/g
stage 2 (command filter): /^[A-Za-z][\w./-]*(?:\s+\S+)+$/
```

Stage 2 keeps only multi-token spans starting with a word-ish token — `metta finalize --json`, `npm run build`, `node dist/cli/index.js install --git-init` pass; single-token spans like `` `UAT.md` ``, `` `spec/changes/<name>/` ``, `` `uat.enabled: false` `` (colon after first token fails `[\w./-]*` at the boundary before whitespace? — no: `uat.enabled:` fails stage 2 because `:` is outside the first-token class, so the token regex does not match from start; verified intent) are rejected. Known false negatives: single-word commands (`ls`) — acceptable; ITCs in this codebase always name multi-token invocations (sampled: `metta finalize`, `grep -l "model: sonnet" ...`, `metta instructions`). Known false positives: prose-ish spans like `` `docs: DocsConfigSchema.optional()` `` — starts `docs:` → rejected; `` `parse({}).docs` `` — single token → rejected. The filter is intentionally conservative: a missed hint costs nothing (the ITC preamble still shows the command), a wrong `Run:` line actively misleads.

Dedupe hints per step: first match wins; render at most 2 command hints per step to avoid noise.

---

## 3. spec.md delta scenarios as additional coverage

### 3.1 What the change dir holds

At finalize the change dir contains the **delta** spec (`## ADDED: Requirement: ...` headings) — `parseDeltaSpec`, not `parseSpec`, is the correct entry point for `spec/changes/<name>/spec.md`. (`parseSpec` would see zero `Requirement:` headings in a delta file and return empty requirements — a silent-empty trap; the assembler must not "helpfully" try `parseSpec` first.)

Include scenarios from deltas with `operation !== 'REMOVED'` (ADDED, MODIFIED, RENAMED all describe live behavior; REMOVED scenarios describe behavior that no longer exists and must not become acceptance steps).

### 3.2 Splitting flat scenario steps

Scenario steps are strings like `"GIVEN a ..."`, `"WHEN ..."`, `"THEN ..."`, `"AND ..."`. Role split:

```
/^(GIVEN|WHEN|THEN|AND)\b\s*/i
```

Fold rule: `AND` inherits the role of the preceding step (`GIVEN+AND` → Setup; `THEN+AND` → additional observe line). Unprefixed steps inherit the previous role; a scenario with no THEN-role step gets observe-text `"(no explicit observable stated — confirm the scenario description holds)"` rather than being dropped.

### 3.3 Folding into the story-grouped document — dedupe options

Delta scenarios frequently restate story ACs (compare US-1 AC 1 in this change's own stories.md against the "Successful finalize writes UAT.md" scenario — same behavior, different words). Options:

**Option A — group by `fulfills`, exact-normalized dedupe only (recommended).**
- Scenarios whose requirement's `fulfills` names a story present in stories.md are appended under that story's heading, after the AC-derived steps, as steps titled with the scenario name (multi-story `fulfills` → attach to the **lowest-numbered** story only, to avoid duplicating the scenario under several headings).
- Scenarios with empty/dangling `fulfills` group under a trailing `## Additional scenarios` section.
- Dedupe predicate: drop a scenario-derived step iff `norm(scenario WHEN+THEN)` equals `norm(ac.when + ac.then)` for some AC already emitted in the same story, where `norm` = lowercase, strip backticks/`**`/punctuation, collapse whitespace. Exact-normalized match only.
- Pros: grouping is structural (fulfills), not fuzzy; dedupe can never wrongly delete coverage (only literal restatements die); fully deterministic.
- Cons: near-duplicate wording survives → some redundancy in the document. Acceptable for a checklist; redundancy is cheaper than lost coverage.

**Option B — similarity-scored dedupe (token Jaccard ≥ 0.6).**
- Pros: kills most near-duplicates.
- Cons: threshold tuning, hard-to-explain drops, false-positive risk deletes real coverage, harder to test. Deterministic but brittle. Rejected.

**Option C — no folding: all delta scenarios under one "Spec scenario coverage" appendix.**
- Pros: trivially simple; zero dedupe question.
- Cons: violates the format requirement's traceability intent ("grouped under headings for the user stories they derive from") when `fulfills` data is sitting right there. Rejected.

**Recommendation: Option A.**

---

## 4. Tier fallback chain — decision tree and reduced shapes

```
START (uat.enabled, finalize success path)
│
├─ Tier 1: read stories.md via parseStories(changeDir/stories.md)
│   ├─ returns kind 'stories'        → FULL SCRIPT (Sections 2–3), done
│   ├─ returns kind 'sentinel'       → warn? no — expected; fall to Tier 2
│   ├─ throws StoriesParseError
│   │    ├─ "not found" (ENOENT)     → fall to Tier 2 (silent; expected for quick tier)
│   │    └─ any other parse error    → record warning, fall to Tier 2
│   └─ throws other (fs/EACCES etc.) → record warning, fall to Tier 2
│
├─ Tier 2: read spec.md raw; parseDeltaSpec(markdown)
│   ├─ file missing                  → fall to Tier 3 (silent for quick tier)
│   ├─ read error                    → record warning, fall to Tier 3
│   ├─ deltas (op ≠ REMOVED) contain ≥1 scenario
│   │                                → REDUCED SCRIPT A, done
│   └─ zero scenarios (incl. empty-parse garbage)
│                                    → record warning ("spec.md present but no scenarios"), fall to Tier 3
│
└─ Tier 3: intent.md Proposal bullets + summary.md highlights
    ├─ both extractions yield content → REDUCED SCRIPT B, done
    ├─ one yields content             → REDUCED SCRIPT B from that one + warning
    └─ both empty/unreadable          → FLOOR SCRIPT + warning
```

The chain never returns "skip": the floor script (header + one generic step: "Review the archived change artifacts and confirm the described behavior works" + checkbox) guarantees "a UAT.md MUST exist after a successful finalize" even for pathological changes. Only template-load/render/write failures escape the assembler — those are the finalizer-level degradation path (separate requirement, out of assembly scope).

### 4.1 Reduced Script A (spec scenarios, no stories)

- No US grouping available. Group by **requirement**: `## <requirement.name>` per delta requirement (ADDED/MODIFIED/RENAMED, document order), scenarios as numbered steps using the Section 3.2 split (Setup/Do/Observe/checkbox). Command hints via the same regex over step text.
- If a requirement's `fulfills` is non-empty, render it as a trace line (`*Fulfills: US-1, US-2*`) even though no stories parsed — the US ids still exist in the delta text and aid audit.

### 4.2 Reduced Script B (intent + summary)

**intent.md Proposal extraction — remark, not regex (recommended).** The intent template (`src/templates/artifacts/intent.md`) fixes `## Proposal` as an H2. Extraction rule:

1. `unified().use(remarkParse)` over intent.md (same dependency and pattern as both existing parsers — zero new deps, consistent with codebase convention).
2. Collect nodes after the H2 whose text equals `Proposal` (case-insensitive, trimmed) until the next heading of depth ≤ 2.
3. Bullets = every top-level `listItem`'s text (via an `extractText` clone). Real intents nest structure under `###` subsections inside Proposal (verified: archived `metta-fix-issues` intent has `### CLI command`, tables, paragraphs) — depth-3 headings within the section become step titles when no top-level list exists; if neither lists nor H3s exist, fall back to the section's paragraphs (each paragraph = one step, cap 10).
4. Each bullet → one step: Do = bullet text ("Confirm: <bullet>"), Observe = "behaves as described", checkbox. Honest framing: these are confirmation prompts, not derived GWT steps — the header of a reduced script should say so ("Reduced script — derived from intent/summary; steps are confirmation prompts").

Why not pure regex over raw markdown: bullets spanning wrapped lines, nested lists, and inline formatting make line-regex extraction lossy; remark is already the house pattern. (A regex fallback buys nothing since remark parses any text without throwing.)

**summary.md highlights extraction.** Deterministic rule: (a) first non-heading paragraph after the H1 (the lead), rendered as a preamble; (b) top-level list items under the first H2 whose title matches `/what changed|changes|behavior|files changed|checks?/i`, cap 10, each → one confirmation step. If no such section, take the first list in the document. Sampled quick summaries (`## Check 1 —`, `## Behavior` bullet lists) and standard summaries (`## What changed` bullets) both satisfy this. If nothing matches, summary contributes only the lead paragraph.

---

## 5. Machine-verified annotation — honest derivation

### What is actually provable

- **Gate results (in-memory Step-4 `GateResult[]`)**: suite-level only. `tests: pass` proves the whole test suite passed — it links to no scenario, story, or requirement. On the success path this is almost always true, so alone it justifies nothing per-step.
- **summary.md**: freeform prose. When the verifier followed the template, scenario/requirement names appear near test references; quick summaries mention behaviors and sometimes US ids. Substring presence of a *specific long name* is meaningful evidence the verifier engaged with that scenario; presence of a short token (`US-3`) is weaker but still deliberate.

Per-scenario *proof* is not derivable from these sources. The annotation is therefore a **cross-reference claim** ("the verification record mentions this item, and the gate suite passed"), and the document wording should reflect that (`✓ machine-verified per summary.md + gates` rather than implying a per-step test run).

### Concrete predicate (recommended)

Let `S` = `norm(summary.md full text)` (normalization as in 3.3; empty string when summary missing/unreadable — never an error). Let `gatesOk` = `gates.length > 0 && gatesPassed` (from the finalizer's in-memory Step-4 results; `gates.length > 0` matters because zero configured gates vacuously "pass" and must not count as machine evidence).

A step is annotated machine-verified iff `gatesOk` AND at least one of:

1. **Scenario-derived step:** `S.includes(norm(scenario.name))` and `norm(scenario.name).length ≥ 15` — scenario names are full sentences; the length floor kills accidental short-phrase collisions.
2. **Any step:** `S.includes(norm(requirement.name))` for the requirement the step derives from (scenario steps) — requirement names like "UAT Tier Fallback Chain" are distinctive; same 15-char floor.
3. **AC-derived step:** raw summary matches `/\bUS-N\b/` for the step's story id **and** the match line (the physical line containing it) also matches `/verif|test|pass|green|covered|✓|check/i`. The context guard prevents annotating on a mere narrative mention of the story id.

Evidence string rendered with the annotation, from whichever clause fired: `machine-verified — summary.md references "<matched name | US-N>"; gates all passed (<gate names>)`.

**Omit the annotation (silently, per spec) when:** summary.md missing or unreadable; `gates` empty; `gatesPassed` false (unreachable on the normal path but defensive); no clause matches; tier-3 scripts entirely (steps there derive *from* summary.md — self-referential matching would annotate everything; annotation is meaningless at tier 3 and should be structurally skipped).

Rejected alternatives: parsing summary's `## Spec Scenarios` table when present (higher precision but a second freeform-markdown dialect to parse, and absent from quick summaries — the substring rule subsumes it because table rows contain the scenario names); annotating everything when `gatesOk` (dishonest — suite pass ≠ scenario coverage; directly contradicts the "absent when not derivable" intent).

---

## 6. Error-handling ladder

Principle: **inside the assembler, source problems demote tiers; only rendering/writing escapes.** The assembler's public contract should be: never throws for missing/malformed *source* artifacts; returns `{tier, warnings[]}` alongside content.

| Rung | Failure | Handling |
|---|---|---|
| 1 | `parseStories` → `StoriesParseError` (ENOENT) | Expected for quick tier. Demote to Tier 2. No warning. |
| 2 | `parseStories` → `StoriesParseError` (malformed stories) | Demote to Tier 2 + warning `"stories.md failed to parse (<msg>); falling back to spec scenarios"`. Malformed = "does not parse to kind 'stories'" per the fallback requirement's own phrasing. |
| 3 | `parseStories` → non-StoriesParseError (EACCES, etc.) | Same as rung 2 — catch broadly during assembly; warn with the error message. |
| 4 | spec.md `readFile` ENOENT | Expected for quick tier. Demote to Tier 3. No warning. |
| 5 | spec.md read error / `parseDeltaSpec` yields zero non-REMOVED scenarios | Demote to Tier 3 + warning. (Remember: `parseDeltaSpec` signals garbage by emptiness, not exceptions.) |
| 6 | intent.md missing/unreadable or Proposal section empty | Continue with summary-only Reduced Script B + warning. |
| 7 | summary.md missing/unreadable | For Tier 3 content: intent-only script + warning. For annotation (any tier): `S = ''`, annotations silently absent — **no warning**, per the "absence MUST NOT fail or degrade generation" requirement. |
| 8 | Both tier-3 sources empty | Floor script + warning. Still a UAT.md. |
| 9 | Template missing, render error, write error | **Throw** out of the generator. The finalizer's try/catch (mirroring the existing Step-7 docs pattern at finalizer.ts:184-187, but capturing the message instead of swallowing) degrades to no-UAT + warning in output. Out of assembly scope; noted for the interface. |

Warnings accumulate into the assembler result and flow to the finalize output (human warning lines / JSON warning field) — they must NOT abort and must NOT downgrade exit status.

---

## 7. Assembler input/output shapes (what the finalizer must pass)

```ts
// src/finalize/uat-generator.ts (name illustrative)
export interface UatGeneratorInput {
  changeName: string
  changeDir: string            // absolute: join(specDir, 'changes', changeName)
  generatedAt: string          // ISO date, injected by finalizer — never Date.now()
                               // inside the generator (determinism requirement:
                               // "holding the generation date fixed")
  gates: GateResult[]          // Step-4 in-memory results — gates.yaml does NOT
  gatesPassed: boolean         //   exist on disk at this point (Section 1.3)
}

export interface UatAssemblyResult {
  markdown: string             // fully rendered (template rendering downstream of
                               // an intermediate model — see sibling template research)
  tier: 'stories' | 'spec' | 'intent-summary' | 'floor'
  warnings: string[]           // rung 2/3/5/6/8 messages for finalize output
}
```

The generator does its own reads of `stories.md` / `spec.md` / `intent.md` / `summary.md` from `changeDir` (read-only, via the existing parsers — `parseStories` takes a path; the spec parsers take markdown, so the generator owns those two `readFile`s). Passing parsed artifacts in from the finalizer instead was considered and rejected: the finalizer currently parses none of these files, so injection would just relocate the same reads and spread the error ladder across two modules.

`FinalizeResult` gains the reported path field (per the top-level requirement) — e.g. `uatPath: string | null` plus the warnings; exact output plumbing is the CLI-surface research topic.

Insertion point in `finalize()`: after the real merge write (line 137's `specMerge` success) and before `artifactStore.archive` (line 153), wrapped in try/catch per rung 9.

---

## 8. Risks

1. **gates.yaml wording vs. reality.** The requirement says "consult ... `gates.yaml`"; on the mandated ordering that file does not exist yet (Section 1.3). Consuming the in-memory `GateResult[]` — the exact data serialized to gates.yaml moments later — satisfies the intent. The design doc should state this explicitly so a reviewer doesn't "fix" the generator to read a nonexistent file (or reorder generation after archive, which breaks the sweep requirement).
2. **`parseDeltaSpec` never throws** — a tier-2 check written as try/catch-only would treat an empty/garbage spec.md as "has scenarios: none → but parsed fine" and could emit an empty reduced script. Tier detection must be content-based (`≥1 non-REMOVED scenario`).
3. **Annotation false positives** on short scenario/requirement names or incidental US-id mentions. Mitigations baked into the predicate (15-char floor, US-id context guard); residual risk acknowledged — the annotation is defined as best-effort cross-reference, and its wording carries the evidence so a reader can judge.
4. **Sentinel-with-spec is rare in practice** (no sentinel stories.md found in any current archive; quick tier produces neither stories nor spec). Tier 2 needs synthetic fixtures for testing — it will not be exercised by dogfooding alone.
5. **Multi-story `fulfills`** duplication: attach-to-lowest-US rule prevents the same scenario appearing under several story headings, at the cost of imperfect traceability for the other listed stories; the trace line still names all of them.
6. **Determinism leaks**: any use of `Date`, fs ordering, or `Object.keys` over parsed maps inside the generator. All proposed rules operate on parser array order (document order) and injected `generatedAt`; the byte-identical-twice scenario should be a direct unit test.
7. **Markdown-in-markdown**: AC text carries `**bold**` and backticks (parser preserves them); rendered into UAT.md they display as formatting, which is desirable — but step text containing template-brace `{` could collide with `TemplateEngine`'s `{key}` substitution if steps are substituted as one blob. Assembly should render the step body itself in TypeScript-composed markdown? No — template externality forbids body-as-literal; instead the template should hold the frame (header/instructions) with a single `{body}` slot, and the engine's substitution semantics on already-assembled body text must be checked for brace-escaping behavior (flagged for the template-research sibling).

---

## 9. Summary of recommendations

- **Tier 1 mapping:** Option A — one step per acceptance criterion (Setup/Do/Observe/checkbox), ITC as preamble + conservative backtick command-hint extraction (`/`([^`\n]+)`/g` filtered by `/^[A-Za-z][\w./-]*(?:\s+\S+)+$/`).
- **Delta folding:** `parseDeltaSpec` (never `parseSpec`) on the change's spec.md; group scenarios under stories via `requirement.fulfills` (confirmed exposed); exact-normalized dedupe only; dangling scenarios under "Additional scenarios"; skip REMOVED deltas.
- **Machine-verified predicate:** `gates.length > 0 && gatesPassed` AND (normalized summary contains scenario name ≥15 chars | requirement name ≥15 chars | `\bUS-N\b` on a verification-context line); absent silently otherwise; structurally skipped at tier 3.
- **Fallback:** four-outcome tree (stories → spec scenarios → intent+summary → floor) with content-based tier-2 detection; a UAT.md always exists on the success path.
- **Errors:** assembler never throws for source problems (warn-and-demote ladder); only render/write failures propagate to the finalizer's degradation catch.
- **Interface:** finalizer passes `{changeName, changeDir, generatedAt, gates, gatesPassed}`; generator reads artifacts itself; returns `{markdown, tier, warnings}`; insertion between merge write and archive in `finalize()`.
