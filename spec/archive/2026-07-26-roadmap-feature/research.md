# Research: roadmap-feature

## Decision: Line-parsed markdown ordered list + BacklogStore-mirrored class store + extracted promote-handoff helper

### Approaches Considered

1. **Markdown ordered list parsed with pure line functions, `RoadmapStore` class mirroring `BacklogStore`, shared `buildPromoteHandoff` helper extracted from `backlog promote`, additive guard/mint allowlist entries** (selected) — maximally consistent with every existing pattern in the repo: `BacklogStore`'s formatItem/parseItem pure functions over `StateStore.readRaw/writeRaw`, the backlog CLI's error-envelope + `assertOnMainBranch` + `autoCommitFile` discipline, and the guard's table-driven two-word allowlists. The only novel mechanism is a small `ALLOWED_BARE` check in the guard's `classify()` for the bare read-only `metta roadmap` view, which no existing table can express.
2. **remark-parse AST round-tripping for `spec/roadmap.md`** — rejected. remark is used in this repo for structurally rich documents (spec-parser, stories-parser, constitution-parser), not for line-oriented store files; `BacklogStore` parses its markdown with plain string ops. remark-stringify would also reformat content on write, making the spec's "byte-for-byte untouched on failure / deterministic rewrite" guarantees harder to reason about than a canonical line writer.
3. **YAML state file (`.metta/roadmap.yaml`) via `StateStore.read/write` with schema** — rejected. The intent explicitly settles on "a single markdown file `spec/roadmap.md` — no new YAML state file"; the roadmap is a human-facing spec document, and `StateStore.readRaw/writeRaw` + module-level Zod validation satisfies the constitution's validate-every-read/write rule without a second persistence format.
4. **Shelling out to `metta backlog promote` from `roadmap next`** — rejected. Self-spawning the CLI is brittle (PATH, dist vs src), doubles process cost in tests, and interleaves two JSON envelopes. A shared in-process helper achieves the required coupling cleanly.

### Rationale

Every requirement in the spec names an existing mechanism to reuse (BacklogStore shape, `StateStore.readRaw/writeRaw`, `assertSafeSlug`, `assertOnMainBranch`, `autoCommitFile`, the error envelope, the guard's `BLOCKED_TWO_WORD` table, the `metta-backlog` skill). The selected approach is the composition of those mechanisms with the fewest novel parts. The six research questions below record the concrete decisions, each with the alternative considered.

---

### Q1 — `spec/roadmap.md` file format and validation

**Decision: markdown ordered list, plain line-based parse/format pure functions, Zod validation on both paths.** Full format, entry regex, and schema are in [Data Model: roadmap-file](schemas/roadmap-file.md).

- Format: `# Roadmap` heading, then `1. `slug`` lines with an optional `` — note`` suffix (em-dash separator, note verbatim to end of line). Line order is authoritative; ordinals are cosmetic and renumbered on every write.
- Parse/format are pure functions in `src/roadmap/roadmap-store.ts` (`parseRoadmap`, `formatRoadmap`), exactly like `parseItem`/`formatItem` in `src/backlog/backlog-store.ts` — functional core, I/O at the store edge.
- Zod: `StateStore.readRaw/writeRaw` carry no schema, so the store applies `RoadmapSchema` (array of `{slug: SLUG_RE-matching string, note?: non-empty string}`) after parse and before format. This is how the constitution's "Zod on every state read/write" is satisfied for a raw markdown file — the schema wraps the raw I/O at the store boundary.
- Missing file: `readRaw` throws ENOENT → `list()` returns `[]` without creating the file (spec scenario "Missing roadmap file reads as an empty roadmap").
- Alternatives: remark-parse and YAML (rejected above); markdown frontmatter block holding YAML entries — rejected as two syntaxes in one file with no benefit over either pure form.

### Q2 — RoadmapStore design

**Decision: class mirroring `BacklogStore`, no BacklogStore dependency inside the store.**

```ts
export class RoadmapStore {
  constructor(private readonly specDir: string) // creates private StateStore(specDir)
  async list(): Promise<RoadmapEntry[]>                      // ENOENT → []
  async add(slug: string, note?: string): Promise<number>    // returns 1-based position; throws RoadmapValidationError('duplicate_entry')
  async reorder(slugs: string[]): Promise<void>              // throws RoadmapValidationError('invalid_reorder')
  async removeTop(): Promise<RoadmapEntry | null>            // pops entry 1; null on empty roadmap (no write)
}
```

- File path is `roadmap.md` relative to `specDir` → `spec/roadmap.md`, matching how `BacklogStore` addresses `backlog/<slug>.md`.
- Every slug crossing the boundary goes through `assertSafeSlug` from `src/util/slug.js` before any I/O (spec scenario: `../etc/passwd` throws with the file untouched).
- **Backlog existence checks stay at the CLI layer.** `roadmap add` calls `ctx.backlogStore.exists(slug)` before `ctx.roadmapStore.add(...)`, and the status view resolves titles via `ctx.backlogStore.show` per entry (catch → `dangling: true`). This mirrors the existing precedent: `backlog done` does its `exists` check in `src/cli/commands/backlog.ts`, not inside the store. Alternative — injecting `BacklogStore` into `RoadmapStore` — was rejected: no store in the repo depends on another store, and the CLI context already composes both.
- **Typed errors instead of message sniffing.** `RoadmapValidationError extends Error` with `readonly type: 'duplicate_entry' | 'invalid_reorder'` (constitution: custom error classes with typed hierarchies). The CLI maps `instanceof RoadmapValidationError` → envelope `type`; `branch_guard` keeps the existing message-prefix detection (`Refusing to write`) for consistency with `backlog add` (src/cli/commands/backlog.ts line 79). Alternative — replicating backlog's prefix-sniffing for all types — rejected as fragile for the two new discriminators.
- Alternative — functional module of free functions — rejected: constitution says classes for stateful modules, the spec mandates a class, and `CliContext` wiring expects an instance.

### Q3 — `roadmap next` reuse of the promote activation path

What `backlog promote` actually does (src/cli/commands/backlog.ts lines 85-104): `ctx.backlogStore.show(slug)` → emit `{promoted: slug, message: 'Run: metta propose "<title>"'}` (JSON) or `Promote '<slug>' by running: metta propose "<title>"` (text); not-found → envelope `type: 'not_found'`, exit 4. There is no other side effect — the "activation path" is resolve-then-handoff.

**Decision: extract a shared pure helper.** New tiny module `src/cli/promote-handoff.ts`:

```ts
export function buildPromoteHandoff(item: { title: string }): string {
  return `metta propose "${item.title}"`
}
```

`backlog promote` is refactored to compose its existing output strings around this helper (output byte-identical — existing backlog CLI tests prove "behavior verbatim" per the spec's Backlog-untouched scenario), and `roadmap next` uses the same helper for its handoff message. This is the only construction that satisfies the requirement "any future change to promote's activation semantics automatically applies to `roadmap next`" — a future change edits the helper once and both commands inherit it.

- Alternative — call-site duplication (copy the template literal into roadmap.ts) — rejected: fails the automatic-coupling requirement outright and invites drift.
- Alternative — export the helper from `backlog.ts` itself — workable, but a dedicated module keeps `roadmap.ts` from importing a sibling command file; either is acceptable, dedicated module preferred.
- `roadmap next` operation order: `assertOnMainBranch` → `list()` → empty ⇒ `{"next": null}` / friendly text, exit 0, no write → `backlogStore.show(top.slug)` → on success `removeTop()` + `autoCommitFile` → emit `{next: slug, message: 'Run: metta propose "<title>"', committed, commit_sha}`.
- **Flag for planner (spec is silent):** when the *top* entry is dangling, `show` throws → recommend the `not_found` envelope, exit 4, **no pop, no write** — consistent with "a failing invocation MUST NOT leave a partially written spec/roadmap.md". The entry stays visible (dangling) in the status view.

### Q4 — Reorder full-permutation validation

**Decision: Set-based diff pure function with detailed failure reporting.**

```ts
type ReorderCheck = { ok: true } | { ok: false; duplicates: string[]; missing: string[]; extra: string[] }
export function validateReorder(current: string[], proposed: string[]): ReorderCheck
```

Algorithm (O(n)): (1) collect duplicates in `proposed` via a seen-Set; (2) `missing` = current slugs absent from the proposed Set; (3) `extra` = proposed slugs absent from the current Set; ok iff all three are empty (length equality is implied). The failure branches map to one `RoadmapValidationError('invalid_reorder')` whose message enumerates the offending slugs (`duplicated: a; missing: b; unexpected: d`) — this makes the spec's three rejection scenarios (omission, addition, duplicate) individually assertable while sharing the single `invalid_reorder` discriminator.

- No-partial-write guarantee: `reorder` reads + parses current entries, runs `assertSafeSlug` on each arg and then `validateReorder`, and only on success maps the proposed order over a `Map<slug, entry>` (notes preserved verbatim) → `formatRoadmap` → one `writeRaw`. `writeRaw` is a full-content write, so a rejected invocation never touches the file — byte-for-byte identical, as the scenario demands.
- Ordering vs branch guard: the CLI calls `assertOnMainBranch` **before** reading roadmap state, so on a non-main branch the rejection is `branch_guard` even for an invalid permutation (spec: "for reorder, the guard rejection occurs before permutation validation").
- Alternative — sort-and-compare both arrays — equivalent correctness, rejected because it can't distinguish duplicate/missing/extra for the error message. Alternative — positional-index args (`reorder 3 1 2`) — rejected; the spec settled on slug args, which are self-descriptive and safe-slug-validated.

### Q5 — Guard hook, mint scope, and skill frontmatter

All hook edits land in **both byte-identical copies** — `src/templates/hooks/*.mjs` (source of truth) and `.claude/hooks/*.mjs` (deployed) — because `tests/template-deploy-sync.test.ts` enforces byte-identity and rejects orphan deployed files. Same for the new skill directory.

**`metta-guard-bash.mjs` — exact edits:**

1. `BLOCKED_TWO_WORD` (line ~49): add `['roadmap', new Set(['add', 'reorder', 'next'])]`. The existing scope-key branch (line ~217: ``blockedTwo && inv.third → `${inv.sub}:${inv.third}` ``) then automatically produces `roadmap:add` / `roadmap:reorder` / `roadmap:next` keys for the Tier-2 credential check — **no logic change needed for scoping**.
2. Bare read-only view: today `metta roadmap` (no third word) classifies **`unknown` → blocked**, because `ALLOWED_SUBCOMMANDS` can't be used (`classify()` returns `allow` on `inv.sub` alone, which would also allow `roadmap add`) and `ALLOWED_TWO_WORD` requires a third word (`metta roadmap --json` has `third === '--json'`, bare has `undefined`). **Decision: add a small `ALLOWED_BARE = new Set(['roadmap'])` plus one check in `classify()`, placed after the `ALLOWED_TWO_WORD` lookup and before `BLOCKED_SUBCOMMANDS`:** `if (ALLOWED_BARE.has(inv.sub) && (!inv.third || inv.third.startsWith('-'))) return 'allow'`. This allows `metta roadmap` and `metta roadmap --json`, still hits `BLOCKED_TWO_WORD` for `add`/`reorder`/`next`, and leaves `roadmap <anything-else>` as `unknown` (fail-closed). Existing backlog/changes entries are untouched (bare `metta backlog` stays `unknown`-blocked as today). Alternative — allow-listing flag tokens like `['roadmap', Set(['--json'])]` in `ALLOWED_TWO_WORD` — rejected: flags aren't stable tokens and bare invocation would still be blocked.

**`metta-session-mint.mjs`:** add `'metta-roadmap': ['roadmap:add', 'roadmap:reorder', 'roadmap:next']` to `SKILL_SCOPES` (and bump the "9 Tier-2 skill slugs" comment to 10). Nothing else — TTL, rotation, and validation are scope-agnostic.

**Skill `SKILL.md` frontmatter** (new `src/templates/skills/metta-roadmap/SKILL.md` + deployed `.claude/skills/metta-roadmap/SKILL.md`, byte-identical; `npm run copy-templates` already copies the whole `src/templates/skills` dir, so no package.json change):

```yaml
---
name: metta:roadmap
description: Manage the ordered roadmap
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-roadmap
---
```

Body mirrors `metta-backlog`: `AskUserQuestion` routes to `view | add | reorder | next`; slugs only from CLI output (`metta roadmap --json`, `metta backlog list --json`); echo the `metta propose "<title>"` handoff from `next`. Note the mint-cycle trick documented in the backlog skill ("run an allow-listed command first so the mint hook completes a prior Bash cycle"): the roadmap skill gets this for free because every mutating flow naturally starts with the allow-listed bare `metta roadmap --json` view.

### Q6 — CLI wiring and test layout

- `src/cli/commands/roadmap.ts` — `registerRoadmapCommand(program)` with a **default action** on the group command for the read-only view (Commander: `.command('roadmap').action(...)` plus `.command('add')` etc. subcommands), registered in `src/cli/index.ts` alongside the other ~30 `register*Command` calls.
- `src/cli/helpers.ts` — additive `roadmapStore: RoadmapStore` field on `CliContext`, constructed in `createCliContext` next to `backlogStore` (same `specDir`).
- `src/index.ts` — barrel export of `RoadmapStore` (and `RoadmapEntry` type).
- **Test path correction for the planner:** the spec text says `test/roadmap/roadmap-store.test.ts`, but the repo has no `test/` directory — vitest's include is `tests/**/*.test.ts` (vitest.config.ts), and every store test is flat (`tests/backlog-store.test.ts`). A file at the spec's literal path would never be collected. **Recommend `tests/roadmap-store.test.ts`** (flat, mirrors `tests/backlog-store.test.ts`: `mkdtemp(join(tmpdir(), 'metta-roadmap-'))` per test, `rm` in `afterEach`) to satisfy the requirement's substance (1:1 test-to-source ratio). `tests/roadmap/roadmap-store.test.ts` would also be collected by the glob if the planner prefers literal-path fidelity, but it would be the only nested store test in the suite.
- CLI-level tests: `tests/cli-roadmap.test.ts` modeled on `tests/cli-issue-backlog.test.ts` (envelope shapes, exit codes, branch guard, auto-commit, dangling view, empty-roadmap no-op). Guard additions covered in `tests/cli-metta-guard-bash-integration.test.ts` (blocked uncredentialed mutations, allowed bare view, unchanged backlog entries); `tests/template-deploy-sync.test.ts` passes automatically once both hook/skill copies are updated in lockstep.

### Artifacts Produced

- [Data Model: roadmap-file](schemas/roadmap-file.md)
