# Research: `roadmap remove <position|slug>` (US-2)

Area: the manual remove primitive — `RoadmapStore.remove(target)` + `metta roadmap remove` CLI subcommand.

Sources read: `src/roadmap/roadmap-store.ts`, `src/cli/commands/roadmap.ts`, `src/util/slug.ts`,
`tests/roadmap-store.test.ts`, `tests/cli-roadmap.test.ts`, change `intent.md` + `spec.md`.
All findings are in-repo facts; no external documentation questions arose, so no web grounding was required.

## 1. Current state (verified)

- `RoadmapStore` (`src/roadmap/roadmap-store.ts:91-161`) exposes `list`, `add`, `reorder`, `removeTop`. There is **no targeted remove**.
- **`reorder` does NOT accept positions** — its contract is slugs only, full exact permutation
  (`validateReorder`, lines 70-87; CLI `<slug...>` argument at `roadmap.ts:107`). So `remove` introduces
  the first position-addressed operation in the roadmap surface; there is no precedent to mirror
  anywhere in `src/cli/commands/` (grep for position-based targeting found none).
- Canonical write path: `save()` → `RoadmapSchema.parse` → `formatRoadmap` (lines 105-110).
  `formatRoadmap` renumbers ordinals from 1 unconditionally (`index + 1`, line 61) — **renumbering after a
  splice is free**; no extra logic needed. Existing tests already assert renumber-on-write
  (`roadmap-store.test.ts:184-196` hand-edited-ordinals test, `:174-175` removeTop renumber).
- Failure atomicity is structural: every store method validates before calling `save`, so a thrown
  error leaves `spec/roadmap.md` byte-for-byte untouched (asserted repeatedly in existing tests).
  `remove` gets this for free as long as the target lookup precedes `save`.
- Error contract (`roadmap.ts:10-25`): `exitWithError` emits `{error: {code: 4, type, message}}` /
  stderr; `mapRoadmapError` maps `instanceof RoadmapValidationError` → `err.type` **first**, then the
  `Refusing to write` prefix → `branch_guard`, then `Invalid … slug` → `not_found`, else `roadmap_error`.
- `RoadmapValidationError.type` union today: `'duplicate_entry' | 'invalid_reorder'` (lines 33-41).
- CLI mutating-verb pattern (`add`, `reorder`): `program.opts().json` → `createCliContext()` →
  `configLoader.load()` → `assertOnMainBranch(root, config.git?.pr_base ?? 'main', options.onBranch)`
  **before any store read** (comment at `roadmap.ts:115-116`; test `cli-roadmap.test.ts:332-336` pins
  guard-before-validation) → store call → `autoCommitFile(root, join(root,'spec','roadmap.md'), msg)` →
  JSON `{…verb payload, committed, commit_sha}` / text with `Committed:`/`Not committed:` lines →
  catch-all `mapRoadmapError` + `exitWithError`.
- `removeTop` (`roadmap-store.ts:154-160`): pops entry 1, returns it, `null` on empty with no write.
  Sole caller: the current `next` handler (`roadmap.ts:168`).
- Slug grammar fact that drives disambiguation: `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/`
  (`src/util/slug.ts:5`) — **an all-digit string like `"2"` or `"2024"` is a valid slug** (`toSlug('2024')`
  produces one), so `<position|slug>` is genuinely ambiguous and needs a deterministic rule.

## 2. Q&A per the assignment

### 2.1 Signature and disambiguation

The spec names a single primitive: "backed by a new `RoadmapStore.remove(target)`". Three shapes considered:

**Option A — `remove(target: string | number)`; CLI disambiguates (recommended).**
CLI rule: argument matching `/^\d+$/` is parsed as a 1-based position (number); anything else is a slug (string).
Store branches on `typeof target`.
- Pros: matches the spec's named primitive; keeps the parse decision at the imperative edge
  (functional-core discipline — the store never guesses about CLI text); the rule is one sentence:
  *all-digit input is always a position*. Deterministic; matches the spec scenario where `remove 9` on a
  3-entry roadmap is `not_found` (no "fall back to slug" second-guessing).
- Cons: an all-digit slug (`2024`) cannot be addressed by slug — must be removed by its position (visible
  in the default `roadmap` view). Acceptable: real issue slugs are title-derived and effectively never
  all-numeric; the escape hatch (position) always exists.

**Option B — two methods `removeAt(position)` / `removeBySlug(slug)`.**
- Pros: no union type; each method trivially typed.
- Cons: contradicts the spec's named `remove(target)` primitive; duplicates the splice/save/not-found
  plumbing; CLI still needs the same disambiguation rule, so nothing is actually simpler.

**Option C — `remove(target: string)`, store disambiguates internally.**
- Cons: pushes CLI text-parsing semantics into the store; store unit tests would have to encode the
  digit rule; rejected.

Sub-decisions under Option A:
- **Regex `/^\d+$/`, not `/^[1-9]\d*$/`**: `remove 0` then flows as position 0 → out of `1..length` →
  typed `not_found` with a clear positional message, rather than being treated as the (legal) slug `"0"`.
  One uniform rule: all digits ⇒ position.
- **Do NOT call `assertSafeSlug` on the string branch.** Unlike `add`/`reorder`, `remove` never writes
  the target string into the file and builds no filesystem path from it, so the safety rationale is
  absent. A garbage string (`../evil`, `UPPER`, 70-char) simply matches no entry and falls into the
  same typed `not_found` as a well-formed-but-absent slug — one uniform failure with a better message
  than the `Invalid roadmap slug` prefix-sniff path. (If reviewers prefer symmetry with `add`/`reorder`,
  adding `assertSafeSlug` still lands on `not_found` via the existing `mapRoadmapError` prefix branch —
  either way the envelope is `not_found`; the typed path is just cleaner and spec-literal: "a slug not
  on the roadmap … MUST fail … via a typed discriminator".)
- **Return value**: `Promise<{ entry: RoadmapEntry; position: number }>` — the removed entry (slug for
  the commit message and JSON) plus the 1-based position it held (useful in text output and JSON, and
  cheap since the lookup computes the index anyway). Throwing on miss (never returning null) matches
  `add`/`reorder` error style; the null-return style is `removeTop`'s and stays there.

Store body sketch (for design, not implementation): `load()` → find index
(`typeof target === 'number' ? target - 1 (bounds-checked)` : `entries.findIndex(slug match)`) →
miss ⇒ `throw new RoadmapValidationError('not_found', …)` → `entries.splice(index, 1)` → `save(entries)`.

### 2.2 Typed error for a missing target

Extend the existing discriminator union — exactly what intent §1 and the spec's error-contract
requirement prescribe:

```ts
type: 'duplicate_entry' | 'invalid_reorder' | 'not_found'
```

`mapRoadmapError` needs **zero changes**: the `instanceof RoadmapValidationError` branch already runs
first and forwards `err.type` verbatim, so a thrown `('not_found', "No roadmap entry matches '<target>'")`
lands in the envelope as `type: 'not_found'`, exit 4. The class name (`RoadmapValidationError`) is
slightly loose for a not-found, but the spec explicitly says "extending the `RoadmapValidationError`
discriminator pattern"; a parallel `RoadmapNotFoundError` class would add an export, a second
`instanceof` branch, and a barrel change for no contract benefit. Distinct messages for the two miss
shapes ("position 9 out of range 1..3" vs "no entry with slug 'nope'") cost nothing and aid remedy.

### 2.3 Renumbering guarantees

Fully covered by the existing canonical writer: `save` → `RoadmapSchema.parse` → `formatRoadmap`, which
emits `# Roadmap` + blank + entries numbered `index + 1` + trailing newline. Splice-then-save therefore
satisfies the spec scenario (`a,foo,c` → remove 2 → `1. a / 2. c`) with no new formatting code. Edge:
removing the last remaining entry writes the header-only file `# Roadmap\n\n` (empty-array
`formatRoadmap`) — legal, parses back to `[]`; worth one store test to pin it. Notes on surviving
entries are preserved verbatim because entries are spliced, never rebuilt (same guarantee `reorder`
relies on).

### 2.4 CLI wiring (mirrors `add`/`reorder`)

```
roadmap.command('remove')
  .argument('<target>', '1-based position or entry slug')
  .option('--on-branch <name>', …)          // same escape hatch
  .description('Remove a roadmap entry by position or slug')
```

Handler order (normative, pinned by the branch-discipline scenario "guard rejection occurs before
target validation"):
1. `configLoader.load()` → `assertOnMainBranch(…, options.onBranch)` — **before** any roadmap read.
2. Disambiguate: `/^\d+$/.test(target) ? Number(target) : target`.
3. `ctx.roadmapStore.remove(parsed)` → `{ entry, position }`.
4. `autoCommitFile(ctx.projectRoot, join(root,'spec','roadmap.md'), `chore: remove roadmap entry ${entry.slug}`)`.
5. JSON: `{ removed: entry.slug, position, committed, commit_sha }` — follows the per-verb payload-key
   convention (`add`→`slug`/`position`, `reorder`→`reordered`, `next`→`next`); `removed` is
   self-describing and satisfies "reporting the removed slug and the commit outcome". Text:
   `Removed from roadmap (was position N): <slug>` + the standard `Committed:`/`Not committed:` lines.
6. Single catch → `mapRoadmapError` → `exitWithError` — identical to `add`/`reorder`.

Deliberate non-actions: **no** `issuesStore` call anywhere in the handler (spec: "MUST NOT read or
modify any file under `spec/issues/`" — this is what makes dangling removal work, and it differs from
`add`, which checks `issuesStore.exists` first). Read-only default view stays guard-exempt; untouched.

### 2.5 Interaction with `removeTop` — subsume or keep?

**Keep both in this change; expect `removeTop` to die in the `next`-rewrite area, not here.**
- `remove` cannot cleanly subsume `removeTop` today: `removeTop` returns `null` on empty with no write
  (the current `next` handler depends on that), while `remove` throws `not_found`. Shimming
  `removeTop = remove(1) with a catch` trades a two-line method for error-semantics coupling.
- More decisively: the rewritten `next` (sibling research area) can't use *either* single-entry
  primitive — the `--prune` requirement mandates removing the activated entry **plus** all skipped
  dangling entries "in the same write and the same auto-commit", so `next` will need a batched
  operation (e.g. a `removeSlugs(slugs[])` bulk splice or an internal filtered `save`). Once that
  lands, `removeTop` has zero callers → delete it **in that area's plan** as dead code (it is exported
  only via the class; no external consumers found).
- Verdict for this area: implement `remove(target)` standalone; do not modify `removeTop`; leave a
  design note that the next-verb area owns `removeTop`'s retirement.

### 2.6 Test plan

Store — `tests/roadmap-store.test.ts`, new `describe('remove()')` (follows existing per-method blocks;
seed via `store.add` in `beforeEach` like the `reorder` block):
1. Remove by position (middle of `a,foo,c`) → returns `{entry, position: 2}`; `list()` and raw file
   content assert exact canonical renumber (`1. a`, `2. c`) — mirrors the `reorder` raw-content assertion style.
2. Remove by slug → notes on surviving entries preserved verbatim (seed entries with notes).
3. Remove the only entry → file becomes `# Roadmap\n\n`; `list()` → `[]`.
4. Position out of range (`0` and `length+1`) → `RoadmapValidationError` with `type: 'not_found'`;
   file byte-for-byte unchanged (read-before/read-after pattern from the add/reorder tests).
5. Slug not present → same typed `not_found`, file unchanged.
6. Empty roadmap (no file) → `not_found` **and file still not created** (`existsSync` false —
   `load()` returns `[]` without creating; matches the `list()`/`removeTop` empty tests).
7. (Store-level disambiguation is the CLI's job, so no digit-rule test here; `remove(2)` vs
   `remove('2')` behave per their types.)

CLI — `tests/cli-roadmap.test.ts`, new `describe('roadmap remove')` plus extensions to the two shared
blocks:
1. By position: seed 3 entries, `--json roadmap remove 2` → exit 0,
   `{removed, position: 2, committed: true, commit_sha}` truthy; raw `spec/roadmap.md` renumbered
   exactly; `git log --format=%s` contains `chore: remove roadmap entry <slug>` (auto-commit assertion,
   same pattern as the add/reorder/next tests).
2. By slug on a **dangling** entry: seed, `rm spec/issues/<slug>.md` (pattern at
   `cli-roadmap.test.ts:88`, `:302`), remove by slug → exit 0, entry gone, and nothing under
   `spec/issues/` touched (issue file not recreated; assert dir listing / `existsSync`).
3. Text mode: `Removed from roadmap` + `Committed:` lines.
4. `not_found` envelope: `--json roadmap remove nope` then `--json roadmap remove 9` on a 3-entry
   roadmap → both exit 4, `error.type === 'not_found'`, file byte-identical after both (direct
   transcription of the spec scenario).
5. Branch discipline: extend the existing `blocks add, reorder and next off-main` test with
   `remove` — and pass an *invalid* target so the test also pins guard-before-target-validation
   (`branch_guard`, not `not_found`), mirroring the reorder comment there; optionally an
   `--on-branch` happy path (the existing escape-hatch test can stay reorder-only or gain remove).
6. Error contract: add the `remove`-not_found case to the four-type envelope-shape test
   (`cli-roadmap.test.ts:360-383`) so all five failure shapes share `{code: 4, type, message}`.
7. Optional (documents the digit rule): seed a backlog item titled `2024` (slug `2024`), put it on the
   roadmap, run `roadmap remove 2024` → `not_found` (position 2024 out of range) proving all-digit ⇒
   position; then `roadmap remove 1` removes it. Low value/cute — include only if design wants the
   rule pinned by a test.

1:1 test-ratio note: both touched sources already have their paired test files; no new files needed.

## 3. Recommendation

Implement **Option A**:

- `RoadmapStore.remove(target: string | number): Promise<{ entry: RoadmapEntry; position: number }>` —
  number = 1-based position, string = slug; miss throws
  `RoadmapValidationError('not_found', …)` with a target-shape-specific message; splice → existing
  `save()` (renumbering free); no `assertSafeSlug` on the string branch (no path/file is built from it);
  `removeTop` untouched — its retirement belongs to the `next`-rewrite area once `--prune` forces a
  batched removal primitive there.
- Extend the `RoadmapValidationError` type union with `'not_found'`; `mapRoadmapError` unchanged.
- CLI subcommand `remove <target>` with `--on-branch`, guard before any roadmap read, disambiguation
  rule `/^\d+$/` ⇒ position, `autoCommitFile` with `chore: remove roadmap entry <slug>`, JSON
  `{ removed, position, committed, commit_sha }`, shared catch → envelope. No `spec/issues/` access.
- Tests per §2.6 (6 store cases, 6 CLI cases + shared-block extensions).

Risks / notes for design:
- All-digit slugs become position-only addressable — deterministic, documented tradeoff; escape hatch
  is the position shown by the default `roadmap` view.
- This area's `remove()` must NOT be reused as the mechanism for `next --prune` (would violate the
  single-write/single-commit requirement); the next-verb area needs its own batched removal.
- `removed`/`position` JSON keys are a new additive surface — freeze them in the spec delta so UAT and
  automation can rely on them.
