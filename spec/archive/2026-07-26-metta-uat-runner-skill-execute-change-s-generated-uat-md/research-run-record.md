# Research: Run-record and archive semantics for the UAT runner

Research question: pin down the exact UAT.md mutation mechanics (checkbox reset, checkbox flip, run-record append) and the archived-entry edit policy, grounded in the generator's actual emitted structure and the spec-store's archive conventions.

All paths relative to the worktree root unless absolute.

## 1. Findings: the exact emitted UAT.md structure

Source: `src/finalize/uat-generator.ts` (renderer at lines 427-451) and the header template `src/templates/artifacts/uat.md` (lines 1-15).

The document, top to bottom:

1. **Header** (template lines 1-15): `# UAT: <change_name>`, then bullets `- **Change**:`, `- **Generated**: <YYYY-MM-DD>`, `- **Source**: <tier display>`, then `## Reporting failures` (fixed prose, lines 7-11, containing "Do not edit this document to make a step pass"), then `## Acceptance steps`, then the rendered body in the `{uat_steps}` slot (line 15).
2. **Group headings** inside the body:
   - Tier 1: `### US-N: <title>` (`uat-generator.ts:313`) plus optionally a trailing **H2** `## Additional scenarios` for dangling delta scenarios (`uat-generator.ts:346`). Note: the acceptance region is *not* bounded by "next H2" — `## Additional scenarios` is an H2 inside it.
   - Tier 2: `### <requirement name>` (`uat-generator.ts:370-373`).
   - Tier 3 / floor: `### Intent proposal`, `### Summary highlights`, `### Manual review` (`uat-generator.ts:389-409`).
3. **Steps**: `#### Step G.S` or `#### Step G.S: <title>` (`uat-generator.ts:436`), then single-line bullets `- **Setup**: ...` (optional), `- **Do**: ...`, `- **Observe**: ...`, optional `- **Machine-verified** — ...`, and finally the checkbox line emitted as exactly `- [ ] Pass` followed by a blank line (`uat-generator.ts:438-442`). No indentation, no variation.
4. **`### Generation notes`** (H3), appended after the last step only when warnings exist (`uat-generator.ts:448-451`), as `- <warning>` bullets. This is always the **last** content of a freshly generated document when present.
5. The rendered body is `trimEnd()`-ed (`uat-generator.ts:445`) and the file ends with `- [ ] Pass\n` (verified: `tail -c` on `spec/archive/2026-07-26-roadmap-feature/UAT.md` shows a single trailing newline, no trailing blank line) — or with the Generation-notes bullets when warnings exist.

### 1a. Does anything else in the document ever contain `- [ ]` / `- [x]`?

Yes — **mid-line, inside step field text**. This is not hypothetical: `spec/archive/2026-07-25-fix-four-warning-level-findings-uat-generation-change-s/UAT.md` lines 40, 74, and 79 contain the literal strings `- [ ] Pass` (backtick-quoted) inside `- **Do**:` lines (that change was itself about UAT injection hardening, so its steps quote checkbox syntax). Any change touching UAT tooling — including *this* one — will generate steps whose Do/Observe text quotes `- [ ] Pass` / `- [x] Pass`.

**A naive global substring replace of `- [x] Pass` to `- [ ] Pass` is therefore unsafe**: it would rewrite quoted checkbox text inside step fields, violating the "Generated step content is never altered" scenario (spec.md lines 99-102).

Two structural guarantees make a safe reset possible:

- `flattenField` (`uat-generator.ts:423-425`) collapses all embedded newlines in every field string, so generated step text can **never** produce a whole line equal to `- [x] Pass` — quoted checkbox text always appears mid-line after a `- **Do**: `/`- **Observe**: ` prefix. A line-anchored match (`^- \[x\] Pass$`) cannot touch it.
- The only content the generator emits *after* the last checkbox is `### Generation notes` (H3). Run-record sections appended by the runner will use an **H2** heading (`## UAT run — ...`), giving an unambiguous terminator for the acceptance region: everything from the start of file to the first `## UAT run` heading (or EOF) is generator-owned; everything after is runner-owned history.

Residual hazards a line anchor alone does not cover: a run record's failure-details block could legitimately contain a fenced code block quoting a full `- [x] Pass` line, and prior run tables use pass/fail words that must never be rewritten. Hence the reset must be **region-bounded AND line-anchored**, not either alone.

### 1b. Append point and regeneration semantics

- **Append point: end of file.** The first run record goes after the last generator content (last checkbox or the Generation-notes bullets), separated by one blank line; subsequent records go after the previous record. `### Generation notes` (H3) stays inside the acceptance region and needs no special handling — the H2 run heading closes it in markdown outline terms.
- **Does finalize ever regenerate an existing UAT.md?** Effectively no, with one narrow edge. Step 5b (`src/finalize/finalizer.ts:165-193`) generates UAT.md into the **live** change dir (`writeArtifact`, line 183, via `StateStore.writeRaw`, `src/state/state-store.ts:76-80`, a plain `writeFile` that overwrites unconditionally), then Step 6 archives via rename (`finalizer.ts:196`; `ArtifactStore.archive`, `src/artifacts/artifact-store.ts:121-131`, `move` = `fs.rename`). Once archived, the change dir no longer exists under `spec/changes/`, so finalize can never touch that UAT.md again. The edge: if finalize fails **between** Step 5b and the archive rename and is later re-run, Step 5b regenerates and silently overwrites the live UAT.md — destroying any run record appended to a live document in that window. Git history recovers the content, but the runner/skill should not pretend this window doesn't exist (see Open risks).
- **Important precedent — the archive already receives post-rename writes**: Step 6b writes `gates.yaml` **into the archive directory after the rename** (`finalizer.ts:199-213`). "Preserved verbatim" (`docs/workflows/state.md:225`) describes the *original artifact set* surviving the move untouched; it has never meant "no file in an archive entry is ever written after archival."

### 1c. Does anything checksum or validate archive contents?

No. Verified by search:

- `hashSpec` (`src/specs/spec-parser.ts`) is used only by `SpecLockManager` (`src/specs/spec-lock-manager.ts:46`) to hash **living** specs into `spec/specs/<cap>/spec.lock`. Archives are never hashed.
- `contentHash` in `src/context/context-engine.ts:51-53` digests live change artifacts for context manifests (display/staleness), not archive validation.
- `src/gates/` and `src/state/` contain no references to `spec/archive` at all. The only code that writes to an archive entry is finalizer Step 6b (gates.yaml); the only documented reader is the `/metta-progress` history view (`docs/workflows/state.md`, gates.yaml section). No code parses archived UAT.md.

Editing an archived UAT.md breaks no invariant enforced anywhere in the codebase.

### 1d. Date format and runner identity

- The generator's `Generated` field is `YYYY-MM-DD`: `generatedAt` is documented as `'YYYY-MM-DD'` (`uat-generator.ts:17`) and the finalizer supplies `new Date().toISOString().slice(0, 10)` (`finalizer.ts:179`). The run heading should match: `## UAT run — 2026-07-26`. For same-day re-runs the headings duplicate, which is acceptable (sections are chronological and each carries a unique timestamp bullet); putting a full timestamp in the heading was considered and rejected — it breaks the "match the Generated field format" symmetry and makes the region-terminator regex fussier for no gain. Inside the section, record the full instant using the same convention as gates.yaml's `finalized_at` (`finalizer.ts:205`, full ISO-8601): `- **Completed**: 2026-07-26T14:03:22.117Z`.
- **Runner identity — concrete and honest proposal**: a `- **Runner**:` bullet of the form `metta-uat-runner agent via /metta-uat, model: <self-reported model name or "unknown">`. The agent name is a fact; the invocation path is a fact; the model is *self-reported* from the agent's own system context (agents run at the inherited session model per the Model Routing Deferral requirement, spec.md lines 185-199, and have no API to query their model authoritatively) — so it must be labeled as self-reported, and `unknown` is the honest fallback. Do **not** record a session id (not reliably exposed to subagents) or a human name (the git commit made by the orchestrator already records committer identity — that is the authoritative "who", and duplicating it in-document would just drift).

## 2. Recommended mutation strategy

Three options considered:

| Option | Description | Verdict |
|--------|-------------|---------|
| A. Global substring replace | replace `- [x] Pass` with `- [ ] Pass` everywhere in the file | **Rejected** — corrupts quoted checkbox text mid-line in step fields (proven collision, section 1a) and could rewrite quoted lines inside prior run records |
| B. Line-anchored, whole-file | Replace only lines matching `^- \[x\] Pass$` anywhere | Safe against mid-line quotes, but still touches runner-owned history if a run record ever contains a full quoted checkbox line (e.g. fenced code in failure details) |
| C. Region-bounded + line-anchored | Only lines matching `^- \[x\] Pass$` **before** the first `^## UAT run — ` heading | **Recommended** — both hazards eliminated; region terminator is unambiguous because the generator emits no H2 after `## Acceptance steps` except `## Additional scenarios`, which contains only step content, never run headings |

### Stepwise algorithm (what the runner agent does to the document)

1. **Read** the target UAT.md in full.
2. **Locate the region boundary**: the first line matching `^## UAT run — ` exactly at line start. If absent, the boundary is EOF. Everything before the boundary is the *acceptance region* (generator-owned); everything at/after is *run history* (append-only, never modified).
3. **Reset (idempotent re-run step)**: within the acceptance region only, rewrite every line that is exactly `- [x] Pass` to `- [ ] Pass`. Touch nothing else — not mid-line occurrences, not Setup/Do/Observe/Machine-verified text, not Generation notes, and nothing at or after the boundary. (Applies trivially as a no-op on a first run.)
4. **Execute steps**: for each `#### Step G.S`, perform Do, compare against Observe. On a genuine pass, Edit that step's own `- [ ] Pass` line (disambiguate by the step heading immediately above it — Edit's uniqueness requirement is satisfied by including the heading + field lines in the old-string context) to `- [x] Pass`. On fail or skip, leave it unchecked and record the detail for the run record.
5. **Append the run record at EOF**: ensure exactly one blank line after the current last non-empty line, then append:

   ```
   ## UAT run — <YYYY-MM-DD>

   - **Runner**: metta-uat-runner agent via /metta-uat, model: <self-reported or "unknown">
   - **Completed**: <full ISO-8601>
   - **Result**: N pass / N fail / N skip (of N steps)

   | Step | Outcome | Note |
   |------|---------|------|
   | 1.1  | pass    |      |
   | 1.2  | fail    | expected X, observed Y (detail below) |
   | 1.3  | skip    | requires interactive TTY |

   ### Failures

   #### Step 1.2
   - **Expected**: <Observe text, quoted>
   - **Observed**: <what actually happened>
   ```

   Outcome words in the table are `pass` / `fail` / `skip` — deliberately **not** checkbox syntax, so run records never introduce `- [x]`-shaped lines of their own. Failure detail should quote checkbox syntax only inside inline code or fenced blocks if ever needed; with option C even a bare quoted line is harmless (it is past the boundary), but the convention keeps option B viable as a belt-and-braces fallback.
6. **Never**: reorder/rewrite/delete any prior `## UAT run` section; alter any Setup/Do/Observe/Machine-verified text; write results to any other file (spec.md lines 110-126).
7. Edit-tool first for every mutation; on harness refusal, the honest heredoc fallback to the exact same path, noting the refusal in the run record (per the runner agent contract, spec.md line 55).

The skill (orchestrator) commits afterwards; the diff of a correct run shows only `[ ]` to `[x]` flips (and resets) in the acceptance region plus one appended H2 section — a property that is directly checkable in tests and in the archived-run scenario (spec.md lines 207-211).

## 3. Archived-entry policy recommendation

**Policy A — edit the archived UAT.md in place (bounded to checkbox flips + appended run records). Recommended.**

| | Policy A: in-place, bounded | Policy B: sibling file / issues only |
|---|---|---|
| Answers "did acceptance ever run?" months later | Yes — one file, self-contained (finalize-ship spec's own audit scenario, `spec/specs/finalize-ship/spec.md:339-343`, reads UAT.md itself from the archive) | Only if the reader knows to look for the sibling / trawl `spec/issues/` |
| Consistency with change spec | Matches — the UAT Run Record requirement (spec.md line 112) already forbids writing results "to any other file or path" | Contradicts the drafted spec outright |
| Archive-write precedent | Exists — finalizer Step 6b already writes `gates.yaml` into the archive post-rename (`finalizer.ts:199-213`) | A sibling file would *also* be an archive write, so B gains nothing on purity |
| Breaks validation/checksums | Nothing checksums archives (section 1c) | Same |
| Immutability convention | "Preserved verbatim" (`docs/workflows/state.md:225`) and "immutable historical records" (`spec/archive/2026-04-14-metta-issue-metta-backlog-slas/spec.md:48`) protect the *original artifact set* — generated step content stays byte-for-byte intact under A's bounds; run outcomes are new history being completed, not old history being rewritten | Strictest reading satisfied, at the cost of splitting one logical record across files |
| Diff auditability | git shows exactly the sanctioned delta per run | Diff noise split across files; checkbox state in the archived doc stays permanently blank and misleading |

The decisive points: (1) the checkboxes are *in* the document — leaving an archived script permanently unchecked while truth lives elsewhere makes the archived artifact actively misleading, the opposite of "preserved"; (2) the codebase already writes into archive entries after archival with no ill effect; (3) nothing validates archive bytes, so A's only cost is a philosophical narrowing of "verbatim" that the intent already argues for honestly (intent.md section 4: run records complete the archive rather than falsify it). Policy B's only real advantage — untouched original bytes — is preserved under A anyway for everything the generator emitted, which is checkable by diff. The `docs/workflows/state.md:225` sentence should get a one-clause touch-up during execution ("preserved verbatim; UAT run records and checkbox state are the sanctioned exception") so documentation matches behavior.

Failures found while running an archived UAT still flow to `/metta-issue` via the orchestrator (spec.md lines 151-165) — issues are the *actionable* channel; the run record is the *historical* one. They are complements, not alternatives.

## 4. Why git history alone is not the run history

Rejected. Git commits record *that bytes changed*, not *acceptance semantics*: an unchecked box after a run is indistinguishable from "never ran", "ran and failed", and "ran and skipped" without a run record, and reconstructing per-step outcomes would require diff archaeology across commits that may interleave unrelated changes. The finalize-ship spec's audit scenario (`spec/specs/finalize-ship/spec.md:339-343`) explicitly requires the document to answer the acceptance question when opened "months later" with "no dependency on live change context" — a property git log does not provide to someone reading the file through a viewer, an export, a copied spec store, or a shallow clone. Git remains the transaction log (per the constitution's persistence model) and the recovery mechanism; the in-document run record is the readable, portable source of truth. The two are layered, not redundant.

## 5. Open risks

1. **Finalize re-run overwrite window** (section 1b): a re-run of a finalize that failed between Step 5b and the archive rename regenerates UAT.md and destroys live-document run records. Narrow window, recoverable via git. Mitigation options for design: none needed beyond documenting it (recommended — touching finalizer is out of scope per intent.md), since a UAT run against a not-yet-archived change in a broken finalize state is already an unusual sequence.
2. **Same-day duplicate run headings**: two runs on one date produce two identical `## UAT run — <date>` headings. Sections remain distinguishable by order and by the `**Completed**` ISO timestamp bullet. Accepted; revisit only if tooling ever needs to address sections by heading uniquely.
3. **Model self-report honesty**: the runner's `model:` field is self-reported and unverifiable; the recommendation labels it as such with `unknown` fallback. Reviewers must not treat it as an authenticated claim.
4. **Edit-tool uniqueness on checkbox flips**: `- [ ] Pass` occurs dozens of times per document; the agent contract must require including the step heading and field lines in the old-string so each Edit is unambiguous. A careless single-line Edit would fail (non-unique) or, worse with replace-all semantics, flip every box. The agent template should state this explicitly.
5. **Header wording conflict**: until the `src/templates/artifacts/uat.md` "Do not edit this document" sentence is reworded (already mandated by spec.md lines 104-107), existing archived UAT.md headers will carry the old prohibition verbatim while the runner sanctionedly edits them. The runner agent's contract should note that the *new* header wording governs semantics and the old sentence in already-generated documents is superseded by the finalize-ship spec, so the runner does not refuse to operate on pre-change archives.
