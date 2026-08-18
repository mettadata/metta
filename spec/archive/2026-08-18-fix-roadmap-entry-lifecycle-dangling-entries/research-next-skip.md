# Research: `roadmap next` skip-and-warn + `--prune` (US-1, US-4)

Area: rewrite of the `next` handler head-resolution loop in
`src/cli/commands/roadmap.ts` (currently lines 134-185), superseding ADR-4's
fail-stop, plus the `--prune` flag, the machine-detectable replacement signal,
and the read-only-`next` scope call.

## 1. Current state (verified in code)

- **`next` today** (`src/cli/commands/roadmap.ts:134-185`): branch guard →
  `roadmapStore.list()` → empty no-op (`{"next": null}`) → `issuesStore.show(top.slug)`;
  on show failure the catch at lines 157-165 implements ADR-4: exit 4,
  `type: 'not_found'`, no pop, remedy text pointing at restore-or-`reorder`.
  On success: `buildPromoteHandoff({title})` → `roadmapStore.removeTop()` →
  `autoCommitFile(spec/roadmap.md, 'chore: pop roadmap entry <slug>')` →
  JSON `{ next, message, committed, commit_sha }` or sanitized text.
- **`IssuesStore.show`** (`src/issues/issues-store.ts:263-268`):
  `assertSafeSlug` → `readRaw('issues/<slug>.md')` → `parseIssueFile`.
  **It does NOT search `spec/issues/resolved/`** — archival moves the file to
  `issues/resolved/<slug>.md` (`archive`, lines 281-294) and `remove` deletes
  the original, so every resolved roadmapped item is dangling by construction.
  Cost of one `show` = one file read + frontmatter/markdown parse.
- **`RoadmapStore`** (`src/roadmap/roadmap-store.ts`): private `load`/`save`
  (Zod on both sides, single full `writeRaw`); public `list`, `add`, `reorder`,
  `removeTop`. `removeTop` (lines 154-160) is load → shift → save and its only
  production caller is `next`. **There is no primitive that can remove a
  middle entry or several entries in one write** — activating a non-head entry
  cannot be expressed with the current store surface.
- **ADR-4's home**: the archived design of the original change,
  `spec/archive/2026-07-26-roadmap-feature/design.md:17` (decision) and `:248`
  (risk R4, which already predicted this wedge and asked for `roadmap remove`
  as a backlog candidate). The *normative* fail-stop lives in the active spec
  `spec/specs/roadmap-feature/spec.md` ("roadmap next activates..." requirement,
  line 100, and the error-contract requirement, line 135, which lists "including
  a dangling top entry on `roadmap next`" under `not_found`).
- **Existing tests** (`tests/cli-roadmap.test.ts`, `describe('roadmap next')`,
  lines 228-316): happy pop + commit, empty no-op both modes, ANSI-sanitization
  split, and the ADR-4 dangling fail-stop test at lines 299-315 which this
  change must invert. Branch-discipline (line 338) and error-contract suites
  cover `next` off-main.

## 2. Skip loop shape and cost

**Shape (recommended):** resolve-then-mutate, fully sequential, all in the
handler:

1. Branch guard (unchanged, before any roadmap read — the modified
   branch-discipline requirement keeps this ordering).
2. `entries = await roadmapStore.list()`; empty → existing `{"next": null}`
   no-op verbatim.
3. Walk `entries` from index 0. For each entry, `try { issuesStore.show(slug) }`.
   Failure → push slug onto `skipped[]` and continue. Success → this is the
   activation candidate; capture `{ slug, title }` and stop.
4. No candidate (all dangling) → warnings + guidance, exit 0, **no store call,
   no commit — even with `--prune`** (spec line 11 mandates prune inert here).
5. Candidate found → `toRemove = options.prune ? [...skipped, candidate.slug] : [candidate.slug]`;
   one store call producing one write; one `autoCommitFile`.

**Cost:** one file read + parse per walked entry, stopping at the first healthy
entry. The default `metta roadmap` view already does `show` for *every* entry
on every invocation (roadmap.ts:52-57), so worst case (all dangling) equals the
cost profile users already pay for the status view. Roadmaps are tens of
entries at most; no batching or caching is warranted.

**Resolved-vs-vanished distinction (optional polish):** since `show` only looks
at `issues/<slug>.md`, a skipped slug could additionally be checked against
`issues/resolved/<slug>.md` (one `exists` call per skipped entry) to say
"resolved — prune it" vs "missing — restore or remove". The spec only requires
naming the slug and the two remedies, so this is a design-time nice-to-have;
recommend deferring unless design wants it (it costs one extra stat per skipped
entry and a second message variant).

## 3. Middle-entry removal needs a new store primitive

`removeTop()` cannot remove entry *i* > 0, and the CLI cannot compose
load/filter/save itself (`save` is private, and doing it in the CLI would break
the store-owns-the-file requirement). Options considered:

- **Option A — reuse the new `remove(target)` per slug.** With `--prune` and k
  skipped entries this is k+1 loads and k+1 writes. Violates the spec's "in the
  same write" mandate (spec.md line 9) and multiplies partial-failure windows.
  Rejected.
- **Option B — `RoadmapStore.removeSlugs(slugs: string[]): Promise<RoadmapEntry[]>`**
  (name per design; `removeEntries` also fine): single `load` → assert every
  slug present (defensive; `next` passes slugs it just read, so a miss means a
  concurrent write — throw `RoadmapValidationError('not_found', …)` per the
  extended discriminator) → filter → single `save` → return removed entries.
  The US-2 `remove(target)` subcommand primitive can be a thin wrapper over the
  same splice-and-save core, keeping one write path. **Recommended.**
- **Option C — push the whole skip loop into the store**
  (`roadmapStore.activateNext(resolver)`). Rejected: couples `RoadmapStore` to
  `IssuesStore` (or to an injected resolver callback), inverts the
  functional-core/imperative-shell layering, and buys nothing — the loop is
  pure iteration the CLI can own.

**`removeTop` fate:** after the rewrite it has zero production callers.
Recommend deleting it (plus its unit tests at `tests/roadmap-store.test.ts:167-180`)
in this change rather than leaving a dead mutation primitive; the modified spec
no longer names it. If design prefers minimal churn, keeping it is harmless but
should be an explicit ADR either way.

Pure-core opportunity: extract the skip computation as a pure function
(e.g. `planNextActivation(entries, resolvedSlugs) → { skipped, candidate }`) in
the roadmap module or CLI file so it unit-tests without I/O and — see §7 — so a
future preview mode reuses it unchanged.

## 4. Non-destructive default and `--prune` semantics

- **Default:** only `candidate.slug` is removed; skipped dangling entries stay
  byte-positionally in place (renumbered by the canonical writer — note the
  spec's "remain at their positions" is satisfied in *relative order*; ordinals
  above the removed entry shift down, which is the existing canonical-renumber
  behavior on any removal and matches the spec's own remove-by-position
  scenario at spec.md line 86-89).
- **`--prune`:** `toRemove = [...skipped, candidate.slug]` in one
  `removeSlugs` call → one `writeRaw` → one `autoCommitFile`. Commit message
  suggestion: `chore: pop roadmap entry <slug>` unchanged when nothing pruned;
  `chore: pop roadmap entry <slug> (pruned <n> dangling)` when pruning — keeps
  existing log-grep tests valid (`toContain` on the prefix).
- **Inert prune:** all-dangling + `--prune` performs no store call at all, so
  "no write, no commit" is trivially guaranteed rather than defended by a
  conditional.
- **Failure atomicity:** `removeSlugs` validates before its single save, so a
  thrown error leaves `spec/roadmap.md` untouched, satisfying the error-contract
  requirement's no-partial-write clause with no new machinery.

## 5. Output contract: warnings + machine signal

**JSON success envelope (additive to `{ next, message, committed, commit_sha }`):**

```json
{
  "next": "foo",
  "message": "Run: metta propose \"Foo feature\"",
  "skipped": ["ghost-a", "ghost-b"],
  "pruned": ["ghost-a", "ghost-b"],
  "committed": true,
  "commit_sha": "…"
}
```

- `skipped`: always present, roadmap order, `[]` when nothing skipped
  (spec scenario "Nothing skipped yields an empty skip signal").
- `pruned`: always present, `[]` without `--prune` or when nothing activated;
  equals `skipped` when `--prune` fired. Two arrays (rather than a boolean
  `pruned: true`) satisfy "MUST distinguish which of the skipped entries were
  pruned" and stay future-proof if pruning ever becomes selective.
- All-dangling JSON: `{ "next": null, "skipped": ["ghost-a", …], "pruned": [] }`
  plus a `message` guidance string — distinguishable from the empty roadmap's
  bare `{ "next": null }` by the non-empty `skipped`. Keeping the empty-roadmap
  output byte-identical to today (`{"next": null}`, no extra fields) preserves
  the existing test at cli-roadmap.test.ts:257 and the orchestrator-routing
  requirement's "clean empty signal"; alternatively add `skipped: []` there too
  for uniformity — additive either way, design's call. Lean: add
  `skipped: []`/`pruned: []` to the empty case as well, so consumers can
  key on one shape (the spec only pins `next: null` for empty; extra additive
  fields don't break it — but note the current test uses `toEqual`, so it must
  be updated to match).

**Text warnings — one line per skipped entry, naming slug + both remedies:**

```
Warning: skipping dangling roadmap entry 'ghost-a' — spec/issues/ghost-a.md not found. Remedy: metta roadmap remove ghost-a, or restore spec/issues/ghost-a.md
```

(with `--prune` actually firing: `Pruned dangling entry 'ghost-a'.` per entry,
or a summary line `Pruned 2 dangling entries.` — design detail.)

**Stream choice:** recommend **stderr** for warning lines, in *both* modes:
- keeps JSON stdout a single parseable document (non-negotiable — `outputJson`
  consumers `JSON.parse(stdout)` everywhere in the test suite);
- matches the CLI's existing convention that non-success prose goes to
  `console.error` while structured/success output goes to stdout;
- the spec scenarios say "the command's output contains the literal slugs" —
  stderr is command output; tests assert on `res.stderr`.
The alternative (stdout warnings in text mode only) makes text and JSON modes
emit warnings on different streams; rejected for script-predictability. This is
the one contract point design should ratify explicitly, since US-4's automation
story depends on where scripts must look: **JSON consumers use the `skipped`
field; text consumers grep stderr.**

Slugs are `SLUG_RE`-validated at parse time so no `stripControlSequences` is
needed on warning lines (unlike titles).

**All-dangling text guidance (after the per-entry warnings):** e.g.
`All N roadmap entries are dangling — nothing to activate. Remove them (metta roadmap remove <slug> or metta roadmap next --prune after restoring/removing) or restore the issue files.`
Exact wording is design's; requirement is only "clear guidance to remove or
restore".

**Help text:** the `next` description (roadmap.ts:137, currently "Activate the
top roadmap entry via the backlog promote path and pop it") must change to
describe skip behavior — this also happens to retire the wording flagged by
issue `roadmap-ts-137-cli-help-text-for-roadmap-next-still-says` to the extent
the rewrite forces it (intent explicitly allows exactly that much).

## 6. ADR-4 supersession record — where it lives

Three layers, only two of which get written:

1. **Normative (already drafted):** the change's spec delta rewrites the
   roadmap-feature requirement and the error-contract requirement with explicit
   "supersedes ADR-4" trace lines. On ship this merges into
   `spec/specs/roadmap-feature/spec.md` — that living spec is the binding
   record. This is the mechanism metta already uses (spec text governs;
   archived ADRs are historical).
2. **Decision record:** this change's own `design.md` should carry a new ADR
   ("ADR-n: supersede roadmap-feature ADR-4 fail-stop with skip-and-warn"),
   citing `spec/archive/2026-07-26-roadmap-feature/design.md:17` and noting
   that ADR-4's own risk R4 (design.md:248) predicted the wedge and requested
   the `remove` escape hatch this change delivers.
3. **Do not edit the archive.** `spec/archive/2026-07-26-roadmap-feature/design.md`
   is an immutable artifact of a shipped change; retro-annotating it has no
   precedent in this repo and the archive-edit precedent that does exist
   (UAT run records) is a deliberate, spec'd exception. Forward references
   (new ADR → old ADR) are sufficient.

## 7. Read-only-`next` question (issue `metta-roadmap-next-mutates-on-invocation-with-no-read-only`)

**The skip design does NOT make `next` read-only-by-default.** Activation is
still resolve → pop → commit; the skip loop only changes *which* entry pops.
Every successful bare `next` still writes `spec/roadmap.md` and commits. So
absorbing the issue does not "fall out" — it would be a second, independent
breaking change:

- flips the success contract of bare `next` (today's automation and the
  `metta-roadmap` skill expect the pop);
- touches the skill's `next` branch, the guard's Tier-2 `roadmap next` entry
  semantics (a read-only bare `next` arguably belongs with the unguarded reads,
  splitting the form on a flag — new guard parsing territory), and the
  "Orchestrators answer what next?" requirement (`{"next": null}` from a
  skill-wrapped `next` is part of the routing contract);
- and this change is *already* breaking the `next` failure contract (exit-4 →
  skip); stacking a second contract flip in one change doubles the migration
  surface for consumers like zeus.

**Recommendation: keep it out of scope, as intent already leans.** The issue
stays logged. But design should bank the composition win now, cheaply: keep the
walk as the pure `planNextActivation` function and keep the handler's phases
(resolve / report / mutate) separated, so a future `--pop`-gated or
`peek`-style mode is a flag check before the mutate phase — no rework of the
skip logic. Record that as a note in design.md, not as scope.

## 8. Test plan

`tests/cli-roadmap.test.ts` — rewrite/extend the `roadmap next` describe block
(scenario ↔ spec.md mapping):

1. **Dangling head skipped, healthy second activates** (spec.md:15-18): seed
   `ghost` + `foo`, `rm spec/issues/ghost.md`; assert exit 0, stderr warning
   contains `ghost`, `metta roadmap remove ghost`, and `spec/issues/ghost.md`;
   JSON `next: 'foo'`, `skipped: ['ghost']`, `pruned: []`; roadmap file
   contains `ghost` (position 1) and not `foo`; new commit
   `chore: pop roadmap entry foo`.
2. **Multiple consecutive dangling** (spec.md:20-23): `ghost-a`, `ghost-b`,
   `foo`; exactly one warning line per slug (count matches on stderr);
   `skipped: ['ghost-a','ghost-b']` in that order; both ghosts remain.
3. **`--prune` single write + single commit** (spec.md:25-28): git `rev-list --count`
   before/after asserts exactly one new commit; roadmap file contains none of
   the three slugs; JSON `pruned` equals `skipped`.
4. **All-dangling no-op** (spec.md:30-33): byte-for-byte roadmap file compare
   before/after, `git log` unchanged, exit 0, no `error` key in JSON, `next: null`,
   non-empty `skipped`; repeat **with `--prune`** asserting still no write/commit.
5. **Empty roadmap** (spec.md:35-38): existing test stands; update the
   `toEqual({ next: null })` assertion if the empty envelope gains
   `skipped`/`pruned` (see §5).
6. **Error-contract inversion** (spec.md:57-60): replaces the current
   fail-stop test (cli-roadmap.test.ts:299-315) — dangling head + healthy
   second with `--json` yields no `error` object, exit 0.
7. **Empty skip signal on healthy head** (spec.md:142-145): `skipped` present
   and `[]`; `next`/`message`/`committed`/`commit_sha` unchanged in shape
   (guards the additive-only promise).
8. **Branch guard unchanged** (spec.md:69-72): existing off-main `next` test
   stands; add that off-main + dangling head is still `branch_guard` (guard
   before roadmap read).
9. **Sanitization test** (existing, :268-297): stands as-is — titles still flow
   through the same JSON-faithful/text-sanitized split.

`tests/roadmap-store.test.ts` — new `removeSlugs` unit block: removes a middle
entry with canonical renumber + note preservation; removes multiple in one
write (spy/readFile once); unknown slug throws `RoadmapValidationError`
`not_found` with file untouched; empty-array call is a no-op (or rejected —
design decides; recommend no-op returning `[]` and `next` never calls it
empty). Delete the `removeTop` block if the primitive is deleted.

## 9. Recommendation

- **Loop:** CLI-owned sequential walk over `roadmapStore.list()` using
  `issuesStore.show` per entry, first-healthy-wins, with the skip computation
  extracted as a pure helper. Cost is a non-issue (status view already pays it
  for all entries).
- **Store:** add `RoadmapStore.removeSlugs(slugs)` — single load/validate/save,
  returns removed entries; build the US-2 `remove(target)` on the same core;
  delete `removeTop`.
- **`--prune`:** union of skipped + activated in one `removeSlugs` call, one
  commit; structurally inert when nothing activates.
- **Signal:** additive `skipped: string[]` (always) and `pruned: string[]`
  (always, `[]` unless prune fired) in JSON; one stderr warning line per
  skipped slug naming slug + both remedies in both output modes (stream choice
  to be ratified in design); all-dangling JSON is `next: null` + non-empty
  `skipped`.
- **ADR-4:** superseded by the merged spec text (already drafted in the change
  spec delta) plus a forward-referencing ADR in this change's design.md; the
  2026-07-26 archive is not edited.
- **Read-only call:** do **not** absorb
  `metta-roadmap-next-mutates-on-invocation-with-no-read-only`. Bare `next`
  remains a mutating activation; the issue stays open. Structure the handler
  (pure plan function + separated mutate phase) so a future `--pop`/preview
  flag is a trivial follow-up, and note that in design.md.
