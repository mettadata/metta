# Design: fix-follow-ups-backlog-milestones-rework-review-pr-85

## Approach

Six independent, targeted fixes in one hardening pass. Each fix lands at a single choke point so the defect class — not just the reported instance — is closed:

1. **Title sanitization** — a new pure helper `stripControlSequences()` in `src/util/sanitize-text.ts`, applied at the two terminal render edges named in the spec (backlog list, milestone issue list). Follows the `slug.ts` / `format-zod-error.ts` precedent: pure logic in `src/util/`, applied at the I/O edge (functional core, imperative shell). No new dependency.
2. **Commit scoping** — exact per-file pathspecs at all three `commitPaths` call sites in `src/cli/commands/backlog.ts`. `add`/`done` derive paths from the in-scope slug; `migrate` gets them from a new `changedPaths: string[]` field on `MigrationResult`, populated inside `migrateLegacyBacklog` — the only place that knows converted-vs-collision outcomes. `commitPaths` itself is unchanged (research approach A1).
3. **Test consolidation** — fold the nine describe-blocks unique to `src/issues/issues-store.test.ts` into `tests/issues-store.test.ts`, delete the src copy, and add `"src/**/*.test.ts"` to the tsconfig `exclude` so the whole class of compiled-test-in-`dist/` pollution is fixed structurally, not just this instance (research approach B1).
4. **Bare `metta backlog`** — add `'backlog'` to `ALLOWED_BARE` in both byte-identical guard-bash hook copies, and make `list` the `isDefault` subcommand of the backlog Commander group (release precedent, `release.ts:48`) so the allowed bare form is a genuine read-only view, not help text (research approach A2).
5. **Tier advisory cap** — cap the upscale recommendation at `standard` inside `renderBanner` (`src/complexity/renderer.ts`), the single choke point covering the one live leak (`instructions.ts:52`) and all future callers; the two self-capping sites in `complete.ts` need no change (research approach B1).
6. **Stale-docs sweep** — the 10-item must-fix inventory from research-guard-advisory-docs.md: refresh TOC row, worktree CLAUDE.md, guard-edit allowlist (both copies), five docs files, plus the `docs/workflows/state.md` section found by the sweep. Includes the required assertion flip in `tests/metta-guard-edit.test.ts:87-94`.

All six are additive-or-tightening; none changes the backlog/milestone data model shipped in PR #85. Composition throughout — no new classes, no inheritance; the one new module is a pure function.

### ADR-1: Sanitize only the two defect sites in this change (defer the other ~13)

**Context.** research-renderer-sanitization.md identifies ~15 render sites printing frontmatter-derived titles verbatim and recommends wrapping all of them, since the helper makes each fix a one-word wrap. However, the intent's Out of Scope explicitly states "only the two list renderers named in the issue are touched," and the spec requirement ("Backlog and milestone list renderers sanitize titles") states "Other CLI output surfaces are out of scope for this requirement" — with scenarios covering only those two surfaces.

**Decision.** Wrap exactly `src/cli/commands/backlog.ts:75` and `src/cli/commands/milestone.ts:176` in this change. The other ~13 sites (backlog show heading/body, milestone show heading/body, issue/fix-issue/gaps/fix-gap/roadmap/validate-stories sites per the research table) are **not** wrapped here.

**Rationale.** The spec delta is the verification contract; wrapping 13 additional surfaces would be unverified scope creep that directly contradicts two reviewed artifacts (intent Out of Scope, spec requirement text). The helper is deliberately designed so the follow-up is mechanical (one-word wrap per site, unit coverage already in place). The multi-line `description` sites additionally need a `keepNewlines` design decision (see research edge cases) that should not be rushed into this pass.

**Consequence.** The identical vulnerability remains live at the other sites until the follow-up ships. Mitigation: the orchestrator MUST log a backlog issue for "wrap remaining title/description render sites with stripControlSequences (incl. newline-preserving variant for bodies)" when this change ships — alongside the two other flagged follow-ups (roadmap-feature spec drift, `--json` C1 passthrough).

### ADR-2: Adopted research decisions (no re-litigation)

Reviewed all six research decisions for architectural soundness; none is wrong. Notable confirmations:

- **A1 commit scoping** relies on the empirically verified fact that `git add <deleted-path>` stages the deletion (Git >= 2.0) while leaving dirty siblings alone — so `backlog done` can stage both sides of the archive move by explicit path.
- **B1 renderer cap** keeps `full` as real persisted score data (`actual_complexity_score` stays authoritative); only display policy is clamped. Clamping at scoring time was correctly rejected as data falsification.
- **B1 tsconfig exclude** is safe because Vitest discovery is config-driven (`vitest.config.ts` include covers `src/**/*.test.ts`), not tsconfig-driven — the five remaining src-side test files keep running while ceasing to compile into `dist/`.
- **A2 default-to-list** is preferred over bare-A1 because an `ALLOWED_BARE` entry whose command prints help and exits non-zero would make the hook's "read-only status view" comment false; the release group already establishes the `isDefault` pattern.

## Components

### C1 — Sanitize helper (new)

| File | Change |
|---|---|
| `src/util/sanitize-text.ts` (new) | Export `stripControlSequences(text: string): string` — one regex (`CONTROL_SEQUENCE_RE`, private module constant), alternation order load-bearing (full ESC sequences before the bare-control class): `/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]|[\x00-\x1f\x7f-\x9f]/g`. Doc comment explains the ordering and covers CSI, OSC (unterminated-tolerant), DCS/SOS/PM/APC, two-byte Fe escapes, and C0/DEL/C1 bare controls. No `u` flag needed (range < U+00A0, no surrogate concern). |
| `src/cli/commands/backlog.ts` (line 75) | Wrap the interpolation: `${stripControlSequences(e.title)}`. Import via direct path `../../util/sanitize-text.js` (direct import is the util norm — no barrel export; `src/index.ts` only re-exports `archive-dirs`). |
| `src/cli/commands/milestone.ts` (line 176) | Same one-word wrap on `issue.title`. |
| `tests/sanitize-text.test.ts` (new) | Unit suite per research test plan: color CSI, cursor-move CSI, `\x1b[2J`, OSC title-set (BEL- and ST-terminated), unterminated OSC, OSC-8 hyperlink, DCS, raw `\x9b` C1 CSI, BEL/backspace/CR, lone trailing ESC, plain unicode/emoji passthrough, empty string. Maintains the 1:1 test ratio. |
| `tests/cli-issue-backlog.test.ts`, `tests/cli-milestone.test.ts` | Integration: seed an issue titled with `\x1b[31mEVIL\x1b[0m`, assert `backlog list` / `milestone show` stdout contains `EVIL` and no `\x1b` byte; assert the issue file on disk is byte-identical after render (spec scenario "does not rewrite the issue file"). |

Sanitization is render-only: `--json` paths keep emitting store-faithful strings (JSON.stringify already escapes `\x00–\x1f`).

### C2 — Commit scoping

| File | Change |
|---|---|
| `src/backlog/backlog-migrate.ts` | `MigrationResult` gains `changedPaths: string[]` (see Data Model). Initialize `changedPaths: []` in the result object (~line 197-202); after each successful `migrateItem` in both conversion loops (active ~223-232, done ~248-257), push the three project-relative posix display paths: `plan.targetDisplayPath`, the legacy origin display path, and the archive copy (`${ARCHIVED_TO}/<file>` / `${ARCHIVED_TO}/done/<file>`). Collision-skipped items push nothing. |
| `src/cli/commands/backlog.ts` | Line 181 (`add`): `commitPaths(ctx.projectRoot, [join('spec', 'issues', `${slug}.md`)], ...)`. Line ~269 (`done`): `[join('spec', 'issues', `${slug}.md`), join('spec', 'issues', 'resolved', `${slug}.md`)]` — deletion + creation, both staged explicitly. Line ~306 (`migrate`): pass `result.changedPaths`. `commitPaths` (lines 28-44) unchanged — its per-path swallow-on-failure `git add` semantics work identically for file pathspecs. |
| `tests/backlog-migrate.test.ts` | Lines 57 and 264: add `changedPaths: []` to the two full-object `toEqual` assertions; add positive assertions that conversion tests populate `changedPaths` with the expected triples. |
| `tests/cli-issue-backlog.test.ts` | Sweep-regression tests (one per command — `add`, `done`, `migrate`): seed a dirty unrelated file under `spec/issues/`, run the command, assert the file is absent from `git show --name-status HEAD` and still dirty in `git status --porcelain` (spec scenarios "Unrelated dirty file survives a backlog add" / "Done commits only the archived pair of paths"). Existing done-commit assertion at :571-589 (rename or D+A pair) remains satisfied. |

### C3 — Test consolidation + dist hygiene

| File | Change |
|---|---|
| `tests/issues-store.test.ts` | Append the nine describe-blocks unique to the src copy (parseIssue body tolerance; legacy frontmatter-less files; frontmatter-aware list/show; create-with-fields; createIdea; slug-collision guard; updateFrontmatter; listResolved; archive frontmatter carry-through + Shipped-in). Wrap the ported content in one scoping `describe` so the src copy's module-level `beforeEach`/`tmpDir` fixture does not clash with the existing suite's. Import path becomes `'../src/issues/issues-store.js'`; add `IssueSlugCollisionError` to the import; carry over helpers (`issuePath`, `resolvedPath`, `seedIssueFile`) and sync-fs imports. |
| `src/issues/issues-store.test.ts` | Delete. |
| `tsconfig.json` | `"exclude": ["node_modules", "dist", "tests", "src/**/*.test.ts"]` — removes all six src-side test files (this one plus the five under `src/config/` and `src/finalize/`) from `tsc` emit. No src module imports any `.test.ts`, so the build cannot break. Vitest runs are unaffected (config-driven include). |

Post-condition (spec scenario): after `tsc`, `dist/` contains no `*.test.js` / `*.test.d.ts` artifact; exactly one `issues-store.test` file exists in the tree.

### C4 — Guard-bash bare backlog + default subcommand

| File | Change |
|---|---|
| `src/templates/hooks/metta-guard-bash.mjs` | Add `'backlog'` to `ALLOWED_BARE` (line 77: `new Set(['roadmap', 'release', 'backlog'])`); update the block comment (lines 72-76) to mention backlog; leave the deliberate bare-`milestone` exclusion note (lines 41-44) intact. `classify()` line 136 already handles bare+flags, so `metta backlog --json` is covered and `backlog <unknown-word>` stays fail-closed. |
| `.claude/hooks/metta-guard-bash.mjs` | Identical edit, hand-mirrored — the two copies MUST remain byte-identical (`tests/hooks-byte-identity.test.ts`, `tests/cli-install.test.ts:305` enforce). |
| `src/cli/commands/backlog.ts` (line ~52) | `.command('list', { isDefault: true })` so the bare form renders the read-only list view instead of help + exit 1 (release precedent, `src/cli/commands/release.ts:48`). |
| `tests/metta-guard-bash.test.ts` | Mirror the release bare-form block (:809-882): bare `metta backlog` allowed; `metta backlog --json` allowed; `metta backlog frobnicate` fail-closed; existing Tier-2 gating tests for `backlog add/done/promote` unchanged and must stay green (spec scenario "Write forms remain gated"). |
| `tests/cli-issue-backlog.test.ts` (or `tests/backlog-view.test.ts`) | One case: bare `metta backlog` exits 0 and prints the list output. |

### C5 — Tier advisory cap

| File | Change |
|---|---|
| `src/complexity/renderer.ts` | Inside `renderBanner`, add `const MAX_UPSCALE_TIER: Tier = 'standard'` (module constant) and clamp the upscale branch (line 44-48): when `recRank > chosenRank` and `recommended` outranks `standard`, the rendered target is `standard`, staying truthful about the score — e.g. `Advisory: current quick, scored full -- upscale to standard recommended (full upscale not supported)`. **Edge case (must implement):** current = `standard`, scored = `full` — capped target equals current tier, so render the cap without recommending a move, e.g. `Advisory: current standard, scored full -- full tier not supported; staying at standard`. Downscale and agreement branches untouched; `renderStatusLine` untouched (factual readout, not an advisory). Update the function doc comment's output-forms list. |
| `src/cli/commands/complete.ts` | **No change** — both bespoke cap sites (362-370, 462-469) already comply and never route a full-score through `renderBanner`. Optional wording alignment is explicitly not done here to keep the diff scoped. |
| `tests/complexity-renderer.test.ts` | Update :82-86 (scored full / chosen trivial → now capped wording); add: scored full / chosen quick (capped to standard), scored full / chosen standard (cap-equals-current edge), scored standard / chosen quick (unchanged plain upscale — spec scenario "Standard-over-quick recommendation is unchanged"). Same commit as the renderer change. |

Fixes the one live leak at `src/cli/commands/instructions.ts:52` with zero edits to that file.

### C6 — Stale `spec/backlog/` sweep (10-item inventory)

Per the must-fix table in research-guard-advisory-docs.md:

| # | File | Edit |
|---|---|---|
| 1 | `src/cli/commands/refresh.ts:176` | Drop the Backlog TOC row; widen the Issues row description (line 175) to "Logged issues and backlog items (backlog is a frontmatter view)". Optionally add a `spec/milestones/` row while here. |
| 2 | Worktree root `CLAUDE.md` (managed TOC section) | Hand-edit inside the managed markers to match the regenerated output of #1 (remove the `spec/backlog/` row; widened Issues description). Hand-edit rather than running refresh, because AI sessions must not invoke the CLI directly and the refresh skill is out-of-band for this executor. Add `expect(result).not.toContain('spec/backlog/')` to `tests/refresh.test.ts` as a regression pin. |
| 3 | `src/templates/hooks/metta-guard-edit.mjs:130` **and** `.claude/hooks/metta-guard-edit.mjs:130` | `ALLOW_PREFIXES = ['spec/issues/']` (drop `'spec/backlog/'`); update the "issue/backlog bodies" comment (~124-127) to "issue bodies". Byte-identical pair, same enforcement as C4. **Test flip:** `tests/metta-guard-edit.test.ts:87-94` currently asserts exit 0 for a `spec/backlog/<slug>.md` write — invert to expect exit 2 (blocked). |
| 4-5 | `docs/workflows/README.md:20,23` | Reword per inventory: progress aggregates `spec/changes/` + `spec/issues/`; backlog skill reads/writes issue frontmatter and manages `spec/milestones/`. |
| 6 | `docs/workflows/skills.md:470-505` | Rewrite the `/metta-backlog` section against the current model (source of truth: `src/templates/skills/metta-backlog/SKILL.md` + `src/cli/commands/backlog.ts`): frontmatter flips / `--new` ideas, promote → `/metta-fix-issues`, done → `spec/issues/resolved/` with `--change` Shipped-in stamp, migrate for legacy, milestone subcommands. |
| 7 | `docs/internals/architecture.md:45` | Backlog module row → `backlog-view.ts` (pure view over issue frontmatter) + `backlog-migrate.ts`; `backlog-store.ts`/`BacklogStore` are deleted. |
| 8 | `docs/guide/troubleshooting.md:73` | Exceptions list → `.md` files under `spec/issues/` only; must land with #3 so docs match hook behavior. |
| 9 | `docs/internals/guard-hooks.md:223` (+ preamble ~217) | `ALLOW_PREFIXES` entry list → `spec/issues/` only; "enrichment of issue bodies". |
| 10 | `docs/workflows/state.md:270-288` | Replace the stale `spec/backlog/` section with the view model (`backlog: true` / `priority` / `order` / `milestone` frontmatter; done via `spec/issues/resolved/`; legacy dir only as `migrate` input); add a `spec/milestones/` subsection if state.md lacks one. |

Leave-alone list (verified legitimate): `backlog.ts` legacy/migrate comments, `backlog-migrate.ts` itself, both `metta-backlog` SKILL.md copies, normative `spec/specs/issue-logging/spec.md` MUST-NOT lines, `docs/api.md:973`, `docs/changelog.md`, `docs/proposed/09-cli-integration.md`, this change's own artifacts.

## Data Model

One public type change; no schema (Zod) or on-disk format changes anywhere.

```ts
// src/backlog/backlog-migrate.ts
export interface MigrationResult {
  nothingToDo: boolean
  converted: { active: number; done: number }
  collisions: MigrationCollision[]
  /** Display path of the provenance archive: 'spec/archive/backlog-legacy'. */
  archivedTo: string
  /**
   * Project-relative posix display paths of every file this migration created,
   * rewrote, or removed — target files, deleted legacy origins, and archive
   * copies. Empty when nothingToDo or when every item collided. Suitable as
   * git pathspecs with cwd = projectRoot.
   */
  changedPaths: string[]          // NEW — additive, populated at the single source of truth
}
```

- **Additive and backward-compatible** for readers; the two full-object `toEqual` test assertions are the only consumers that must change.
- Paths reuse the module's existing `SPEC_DISPLAY`-prefixed display-path convention (already posix, project-relative), so they double as git pathspecs without translation.
- Issue frontmatter, milestone files, `.metta/` state, and the complexity score shape are all untouched. The advisory cap is render-only: `recommended_workflow` and the persisted `actual_complexity_score` keep their true values (spec scenario "Scoring values are untouched by the cap").

## API Design

**New public function (internal API, direct import — no barrel export):**

```ts
// src/util/sanitize-text.ts
export function stripControlSequences(text: string): string
```

Pure, total, idempotent; strips ANSI CSI/OSC/DCS/Fe sequences and bare C0/DEL/C1 controls; passes ordinary printable text (including all code points >= U+00A0) through byte-for-byte. Newlines/tabs are stripped — correct for single-line padded list rows; a newline-preserving variant is deliberately deferred to the follow-up that covers multi-line description bodies (ADR-1).

**CLI surface changes:**

- Bare `metta backlog` now runs `list` (was: Commander group help, exit != 0). `metta backlog --json` follows the same path. All existing subcommands unchanged.
- Backlog/milestone non-JSON list output renders sanitized titles; `--json` output is byte-faithful to the store.
- Advisory banner wording changes only when a change scores `full` above its current tier (two new capped forms); agreement, downscale, and standard-over-quick forms are byte-identical to today.
- `metta refresh` TOC output loses the `spec/backlog/` row.

**Hook contract changes (guard surface):**

- guard-bash: `ALLOWED_BARE` = `{roadmap, release, backlog}`. Tier-2 gating for `backlog add/done/promote` is untouched — write forms still require the session credential.
- guard-edit: `ALLOW_PREFIXES` = `['spec/issues/']`. Out-of-band `.md` edits under `spec/backlog/` move from allowed to denied (intended tightening).

No changes to `commitPaths`'s signature or semantics, to any Zod schema, or to the `IssuesStore` API.

## Dependencies

**External:** none added. `strip-ansi` was considered and rejected in research (insufficient — no bare-C0 coverage — and an unjustified runtime dep). No vendor lock-in introduced anywhere in this change; all fixes are plain TypeScript/regex/git-CLI. Git >= 2.0 `git add <deleted-path>` semantics are relied on (verified empirically; Node >= 22 environments ship far newer git).

**Internal (build/test plumbing the executor must respect):**

- `npm run build` (`tsc && copy-templates && emit-build-stamp`) propagates `src/templates/hooks/*.mjs` edits to `dist/` automatically; the live `.claude/hooks/` copies are hand-mirrored and enforced by `tests/hooks-byte-identity.test.ts` + `tests/cli-install.test.ts:305`.
- Vitest include (`vitest.config.ts`) governs test discovery independently of the tsconfig exclude.
- Sequencing constraints: C6 #3 (guard-edit allowlist) and its test flip in the same commit; C6 #8 docs with #3; C5 renderer change with its test update in the same commit; C4 hook copies edited as a pair.
- Follow-ups the orchestrator must log at ship time (out of this change's scope, flagged in research): (a) remaining ~13 render sites + description bodies (ADR-1); (b) `spec/specs/roadmap-feature/spec.md` normative drift (still requires deleted `BacklogStore`) → its own gap/issue; (c) `--json` C1 (U+009B) passthrough; (d) relocating the five remaining src-side test files into `tests/`.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Guard-edit tightening blocks out-of-band `spec/backlog/` edits** (C6 #3) | Any workflow still hand-editing `.md` under the retired path is denied with exit 2. **This is the intended behavior** — the path is a dead store; legacy content is reachable only via `metta backlog migrate`. | Flipped test at `tests/metta-guard-edit.test.ts:87-94` pins the new deny; troubleshooting doc (#8) and guard-hooks doc (#9) land in the same change so the documented allowlist matches the enforced one. Surface this in the change summary as a deliberate breaking tightening. |
| Hook-copy divergence (C4, C6 #3 touch two byte-identical pairs) | CI failure, or worse, a template/live-hook behavior split | Byte-identity tests are the backstop; design mandates editing each pair as a unit in one commit. |
| Regex under- or over-stripping (C1) | Terminal injection survives, or legitimate titles are mangled | Alternation order documented as load-bearing in the module comment; dedicated unit suite covers CSI/OSC/DCS/C1/unterminated/unicode cases; integration tests assert hostile-title output and on-disk byte-identity. Truncated-CSI residue (`[31` text remains) is accepted — no live control characters survive. |
| Unwrapped render sites remain vulnerable (ADR-1) | Same injection vector at issue/gap/roadmap list surfaces | Explicitly accepted to honor spec/intent scope; helper designed for one-word follow-up wraps; follow-up backlog item is a ship-gate obligation (Dependencies). |
| `git add <deleted-path>` behavior assumption (C2) | `done` commit missing the deletion side on exotic git versions | Verified empirically on the target environment; regression test asserts the D+A pair in `git show --name-status`; `commitPaths` swallow-per-path semantics mean a pathological failure degrades to `committed: false`, never a bad commit. |
| Users relying on the accidental directory sweep (C2) | Unrelated dirty `spec/issues/` files now stay uncommitted | Unintended behavior per intent; sweep-regression tests document the new contract; noted in the change impact. |
| tsconfig exclude drops `tsc --noEmit` typechecking for five src-side test files (C3) | Type errors in those files surface only via Vitest, not `npm run lint` | Already true of everything under `tests/` today — this restores consistency; full relocation to `tests/` is the logged follow-up (d). |
| Advisory wording change breaks consumers parsing banner text (C5) | Scripts matching "upscale recommended" on full-scored changes miss the new form | Banner is human-facing advisory copy, not a machine contract (`--json` surfaces carry the raw score); renderer tests updated in the same commit; cap-equals-current edge explicitly specified so `standard`-tier users get a truthful no-move message. |
| Hand-edited CLAUDE.md TOC drifts from generator output (C6 #2) | Next `metta refresh` produces a diff against the hand edit | Hand edit mirrors the exact generator change in #1; `tests/refresh.test.ts` gains a `not.toContain('spec/backlog/')` pin so the generator side is locked. |
| Ported test fixtures clash during consolidation (C3) | `beforeEach`/tmpdir cross-talk, flaky suite | Ported blocks wrapped in a single scoping `describe` with their own setup, per the research port notes; full suite run is the acceptance gate ("no coverage lost, suite passes"). |
