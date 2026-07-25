# Design: roadmap-feature

## Approach

Compose the roadmap feature entirely from mechanisms that already exist in this repo, with exactly one novel mechanism (the guard's `ALLOWED_BARE` check). The feature is four layers, each mirroring a proven sibling:

1. **Store layer** — a new `RoadmapStore` class in `src/roadmap/roadmap-store.ts`, structurally cloned from `src/backlog/backlog-store.ts`: pure `parseRoadmap`/`formatRoadmap`/`validateReorder` functions (functional core) wrapped by a thin class that owns all I/O through `StateStore.readRaw`/`writeRaw` (imperative shell). Zod validation (`RoadmapSchema`) runs after every parse and before every serialize, satisfying the constitution's validate-every-state-read/write rule for a raw markdown file whose `readRaw`/`writeRaw` primitives are schema-less.
2. **CLI layer** — `registerRoadmapCommand(program)` in `src/cli/commands/roadmap.ts`, cloned from `src/cli/commands/backlog.ts`: same error envelope `{error: {code, type, message}}`, same exit code 4, same `assertOnMainBranch` + `--on-branch` escape hatch, same `autoCommitFile` discipline. Backlog existence checks and title resolution stay at the CLI layer (`ctx.backlogStore.exists`/`show`), matching the `backlog done` precedent — `RoadmapStore` never depends on `BacklogStore` (composition at the `CliContext` seam, no store-to-store coupling).
3. **Coupling layer** — a tiny shared pure helper `buildPromoteHandoff` in `src/cli/promote-handoff.ts`, extracted from `backlog promote` and consumed by both `backlog promote` and `roadmap next`. This is the only construction that satisfies "any future change to promote's activation semantics automatically applies to `roadmap next`": one edit point, two inheritors. `backlog promote`'s output is recomposed around the helper byte-identically, so existing backlog CLI tests prove the "backlog behavior verbatim" requirement.
4. **Governance layer** — additive entries in the two-tier guard: `roadmap add/reorder/next` join `BLOCKED_TWO_WORD` (Tier 2, session credential), the bare read-only `metta roadmap` view gets a new `ALLOWED_BARE` branch in `classify()`, `metta-session-mint.mjs` gains the `metta-roadmap` scope entry, and a new `/metta-roadmap` skill (templated file, never inlined in TS) mints the credential and routes the user.

### Design decisions (ADR summaries)

- **ADR-1: Line-parsed markdown, not remark, not YAML** (settled in research). `spec/roadmap.md` is a line-oriented store file like `spec/backlog/<slug>.md`; plain regex parse + canonical line writer gives deterministic byte-for-byte guarantees that remark-stringify round-tripping cannot. Rationale and rejected alternatives: research Q1.
- **ADR-2: Typed error classes over message sniffing for the new discriminators.** `RoadmapValidationError` carries `type: 'duplicate_entry' | 'invalid_reorder'`; the CLI maps `instanceof` to the envelope. `branch_guard` keeps the existing `Refusing to write` message-prefix detection for consistency with `backlog add`. Rationale: constitution mandates typed error hierarchies; prefix-sniffing two new discriminators would be fragile.
- **ADR-3: Test path deviation from the spec's literal text — resolved.** The spec names `test/roadmap/roadmap-store.test.ts`, but vitest's include glob is `tests/**/*.test.ts` and there is no `test/` directory; the literal path would never be collected. **Decision: `tests/roadmap-store.test.ts`** (flat, mirroring `tests/backlog-store.test.ts`), satisfying the requirement's substance — a 1:1 test file for the store that actually runs.
- **ADR-4: Dangling top entry on `roadmap next` — resolved.** The spec is silent on `next` when the top entry's backlog item was deleted out-of-band. **Decision: fail with the `not_found` envelope, exit 4, no pop, no write, no commit.** Rationale: "a failing invocation MUST NOT leave a partially written `spec/roadmap.md`"; silently popping would destroy roadmap intent on an error path. The entry remains visible (marked dangling) in the status view; the error message carries a remedy (see Risks R4).
- **ADR-5: `ALLOWED_BARE` guard branch.** No existing guard table can express "bare `metta roadmap` (optionally with flags) is read-only-allowed while `roadmap add/reorder/next` are Tier-2 blocked". A minimal new Set + one `classify()` check is added, fail-closed for `roadmap <any-unknown-word>`. Rationale and rejected flag-token alternative: research Q5.
- **Vendor-lock-in note:** the skill, guard, and mint pieces are Claude Code-specific — this matches the repo's established governance pattern and is additive only. The CLI itself (`metta roadmap ...`) remains fully tool-agnostic; nothing in the store or command layer depends on Claude Code.

## Components

New files (S = source, T = test):

| # | File | Kind | Responsibility |
|---|------|------|----------------|
| 1 | `src/roadmap/roadmap-store.ts` | S (new) | `RoadmapStore` class, pure parse/format/validate functions, Zod schemas, `RoadmapValidationError` |
| 2 | `src/cli/promote-handoff.ts` | S (new) | Shared `buildPromoteHandoff` pure helper |
| 3 | `src/cli/commands/roadmap.ts` | S (new) | `registerRoadmapCommand(program)` — group default action + `add`/`reorder`/`next` |
| 4 | `src/cli/commands/backlog.ts` | S (edit) | `promote` recomposed around `buildPromoteHandoff` — output byte-identical, no other change |
| 5 | `src/cli/index.ts` | S (edit) | Import + `registerRoadmapCommand(program)` alongside the other `register*Command` calls |
| 6 | `src/cli/helpers.ts` | S (edit) | Additive `roadmapStore: RoadmapStore` field on `CliContext`, constructed in `createCliContext` next to `backlogStore` (same `specDir`) |
| 7 | `src/index.ts` | S (edit) | Barrel export: `export * from './roadmap/roadmap-store.js'` (exports `RoadmapStore`, `RoadmapEntry`, `RoadmapEntrySchema`, `RoadmapSchema`, `RoadmapValidationError`) |
| 8 | `src/templates/hooks/metta-guard-bash.mjs` + `.claude/hooks/metta-guard-bash.mjs` | S (edit, byte-identical pair) | `BLOCKED_TWO_WORD` roadmap entry + `ALLOWED_BARE` classify branch |
| 9 | `src/templates/hooks/metta-session-mint.mjs` + `.claude/hooks/metta-session-mint.mjs` | S (edit, byte-identical pair) | `SKILL_SCOPES['metta-roadmap']` entry; "9 Tier-2 skill slugs" comments bumped to 10 |
| 10 | `src/templates/skills/metta-roadmap/SKILL.md` + `.claude/skills/metta-roadmap/SKILL.md` | S (new, byte-identical pair) | `/metta-roadmap` skill: mint-hook frontmatter, AskUserQuestion routing |
| 11 | `tests/roadmap-store.test.ts` | T (new) | Store unit tests (round-trip, empty, unsafe slug, duplicate, reorder validation, removeTop) — see ADR-3 |
| 12 | `tests/cli-roadmap.test.ts` | T (new) | CLI integration: envelopes, exit codes, branch guard, auto-commit, dangling view, empty no-op — modeled on `tests/cli-issue-backlog.test.ts` |
| 13 | `tests/cli-metta-guard-bash-integration.test.ts` | T (edit) | Blocked uncredentialed `roadmap add/reorder/next`, allowed bare `metta roadmap [--json]`, backlog/changes entries unchanged |

Template copy rules: `npm run copy-templates` already copies the whole `src/templates/skills` and `src/templates/hooks` directories to `dist/` — **no `package.json` change needed**. `tests/template-deploy-sync.test.ts` enforces byte-identity between `src/templates/...` and the deployed `.claude/...` copies; both halves of pairs 8–10 must be edited in lockstep.

### RoadmapStore public surface (component 1)

```ts
// Pure functional core (exported for direct unit testing)
export function parseRoadmap(content: string): RoadmapEntry[]
export function formatRoadmap(entries: RoadmapEntry[]): string
export type ReorderCheck =
  | { ok: true }
  | { ok: false; duplicates: string[]; missing: string[]; extra: string[] }
export function validateReorder(current: string[], proposed: string[]): ReorderCheck

// Typed error (constitution: custom error classes with typed hierarchies)
export class RoadmapValidationError extends Error {
  constructor(readonly type: 'duplicate_entry' | 'invalid_reorder', message: string)
}

// Imperative shell
export class RoadmapStore {
  constructor(private readonly specDir: string)   // creates private StateStore(specDir); file lives at join(specDir, 'roadmap.md')
  async list(): Promise<RoadmapEntry[]>            // missing file → [] (no create); parse → RoadmapSchema.parse → return
  async add(slug: string, note?: string): Promise<number>
      // assertSafeSlug(slug, 'roadmap slug') before any I/O; whitespace-only note treated as absent;
      // slug already present → throw RoadmapValidationError('duplicate_entry'); returns 1-based position
  async reorder(slugs: string[]): Promise<void>
      // assertSafeSlug on every arg, then validateReorder(currentSlugs, slugs);
      // failure → RoadmapValidationError('invalid_reorder', 'invalid reorder — duplicated: …; missing: …; unexpected: …');
      // success → map proposed order over Map<slug, entry> (notes preserved verbatim) → single writeRaw
  async removeTop(): Promise<RoadmapEntry | null>  // empty roadmap → null with NO write; otherwise pop entry 1, rewrite, return popped entry
}
```

Internals: a private `load(): Promise<RoadmapEntry[]>` (`state.exists('roadmap.md')` ? `RoadmapSchema.parse(parseRoadmap(await state.readRaw('roadmap.md')))` : `[]`) and a private `save(entries)` (`state.writeRaw('roadmap.md', formatRoadmap(RoadmapSchema.parse(entries)))`). Every mutating method is read-validate-then-single-full-write; no partial writes are possible.

### Promote-handoff helper (component 2)

```ts
export function buildPromoteHandoff(item: { title: string }): string {
  return `metta propose "${item.title}"`
}
```

`backlog promote` recomposition (byte-identical output): JSON `message: \`Run: ${buildPromoteHandoff(item)}\``; text `` `Promote '${slug}' by running: ${buildPromoteHandoff(item)}` ``. A dedicated module keeps `roadmap.ts` from importing a sibling command file.

### CLI command definitions (component 3)

```ts
export function registerRoadmapCommand(program: Command): void {
  const roadmap = program
    .command('roadmap')
    .description('Manage the ordered feature roadmap')
    .action(async () => { /* read-only status view — default action fires when no subcommand given */ })

  roadmap.command('add')
    .argument('<backlog-slug>', 'Backlog item slug')
    .option('--note <text>', 'Free-text note stored on the entry')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Append an existing backlog item to the end of the roadmap')
    .action(async (slug, options) => { /* … */ })

  roadmap.command('reorder')
    .argument('<slug...>', 'Complete new order — every current roadmap slug exactly once')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Rewrite the roadmap in the given order (full permutation required)')
    .action(async (slugs, options) => { /* … */ })

  roadmap.command('next')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Activate the top roadmap entry via the backlog promote path and pop it')
    .action(async (options) => { /* … */ })
}
```

The global `--json` flag is read via `program.opts().json` exactly as `backlog.ts` does (Commander's default non-positional option parsing already allows `metta roadmap add foo --json`, proven by the existing backlog tests). The default view performs no writes and never calls `assertOnMainBranch`.

### Skill (component 10)

Frontmatter (mirrors `metta-backlog`):

```yaml
---
name: metta:roadmap
description: Manage the ordered feature roadmap
allowed-tools: [Bash, AskUserQuestion]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-roadmap
---
```

Body: `AskUserQuestion` routes to `view | add | reorder | next`. Every mutating flow starts with the allow-listed `metta roadmap --json` (doubles as the mint-cycle primer the backlog skill documents, and supplies CLI-emitted slugs). `add` sources backlog slugs from `metta backlog list --json`; `reorder` sources current slugs from `metta roadmap --json`; `next` echoes the CLI's `metta propose "<title>"` handoff back to the user and never calls `metta propose` itself. Rule block: never invent slugs; always echo CLI output.

## Data Model

### `spec/roadmap.md` on-disk grammar (canonical, per `schemas/roadmap-file.md`)

```markdown
# Roadmap

1. `auth-refactor` — after schema freeze
2. `dark-mode`
```

Entry-line grammar: `<ordinal>. `\`` <slug> `\``[ — <note>]` where:

- `<slug>` matches `SLUG_RE` (`/^[a-z0-9][a-z0-9-]{0,59}$/` from `src/util/slug.ts`), wrapped in backticks.
- The note separator is space + em dash (U+2014) + space; the note is everything after the **first** separator to end of line, verbatim (embedded ` — ` inside a note round-trips). Notes are single-line; empty/whitespace-only notes are absent.
- Line order is authoritative; ordinals are cosmetic and renumbered canonically on every write.
- Parse regex: `` const ENTRY_RE = /^\d+\.\s+`([a-z0-9][a-z0-9-]{0,59})`(?:\s+—\s+(.+))?\s*$/ ``
- Non-matching lines (heading, blanks) are ignored on parse; the writer always emits `# Roadmap` + blank line + numbered entries + trailing newline.

**Round-trip guarantees:** `parseRoadmap(formatRoadmap(entries))` is identity on schema-valid entries (order, slugs, notes verbatim). `formatRoadmap` is deterministic, so `write ∘ read` of a canonical file is byte-identical, and any invocation that fails before the write leaves the file byte-for-byte untouched (single full-content `writeRaw`; validation always precedes it).

### Zod schemas (validation on every read and write path)

```ts
export const RoadmapEntrySchema = z.object({
  slug: z.string().regex(SLUG_RE),
  note: z.string().min(1).optional(),
})
export const RoadmapSchema = z.array(RoadmapEntrySchema)
export type RoadmapEntry = z.infer<typeof RoadmapEntrySchema>
```

- Read path: `readRaw` → `parseRoadmap` → `RoadmapSchema.parse` → return. Missing file → `[]` without creating it.
- Write path: `RoadmapSchema.parse` → `formatRoadmap` → `writeRaw`. Only schema-validated data is ever serialized.

### Error discriminators

| `type` | Origin | Meaning |
|--------|--------|---------|
| `not_found` | CLI layer (`backlogStore.exists` false on `add`; `backlogStore.show` throw on `next`; unsafe-slug `Invalid …` errors also map here — an unsafe slug is by definition not a backlog item) | Referenced backlog item does not exist |
| `duplicate_entry` | `RoadmapValidationError` from `RoadmapStore.add` | Slug already on the roadmap |
| `invalid_reorder` | `RoadmapValidationError` from `RoadmapStore.reorder` | Args are not an exact permutation (message enumerates `duplicated / missing / unexpected` slugs) |
| `branch_guard` | `assertOnMainBranch` throw, detected by the existing `message.startsWith('Refusing to write')` prefix (consistent with `backlog add`) | Mutation attempted off the configured main branch without `--on-branch` |
| `roadmap_error` | defensive fallback for unexpected I/O/git errors, mirroring backlog's `backlog_error` | Anything else |

CLI mapping order in each catch block: `instanceof RoadmapValidationError` → `err.type`; `Refusing to write` prefix → `branch_guard`; `Invalid …slug…` prefix → `not_found`; else `roadmap_error`. All map to exit 4.

### CLI JSON projection (status view)

`position` (1-based, derived from array index, never stored) and `title` (resolved per entry via `BacklogStore.show`; a failed `show` yields `title: null` + `dangling: true` instead of crashing) are computed at the CLI layer. `dangling` is present (as `true`) only on dangling entries; `note` is `null` when absent.

## API Design

All commands: global `--json` flag; JSON success/error bodies via `outputJson` (stdout); text errors via `console.error` (stderr); exit 0 on success, exit 4 on every failure listed. Handler operation order is normative.

### `metta roadmap` (default action — read-only)

- No writes, no `assertOnMainBranch`, works on any branch.
- Order: `createCliContext()` → `roadmapStore.list()` → per entry `backlogStore.show(slug)` (catch → dangling).
- JSON success: `{ "roadmap": [ { "position": 1, "slug": "auth-refactor", "title": "Auth refactor", "note": "after schema freeze" }, { "position": 2, "slug": "old-idea", "title": null, "note": null, "dangling": true } ] }`; empty roadmap → `{ "roadmap": [] }`.
- Text success: one line per entry — `  1. auth-refactor                 Auth refactor — after schema freeze`, dangling entries render `(dangling — backlog item missing)` in place of the title. Empty: `Roadmap is empty. Add entries with: metta roadmap add <backlog-slug>`. Exit 0 in every case, including dangling entries.

### `metta roadmap add <backlog-slug> [--note <text>] [--on-branch <name>]`

- Order: context → `configLoader.load()` → `assertOnMainBranch(projectRoot, config.git?.pr_base ?? 'main', options.onBranch)` → `backlogStore.exists(slug)` (false → `not_found`) → `roadmapStore.add(slug, options.note)` (throws `duplicate_entry`) → `autoCommitFile(projectRoot, join(projectRoot, 'spec', 'roadmap.md'), 'chore: add roadmap entry <slug>')`.
- JSON success: `{ "slug": "foo", "position": 3, "committed": true, "commit_sha": "<sha>" }` (uncommitted: `"committed": false` and text mode prints the `reason`, matching `autoCommitFile` semantics — the mutation still succeeds).
- Text success: `Added to roadmap at position 3: foo` + `  Committed: <sha7>` / `  Not committed: <reason>`.
- Errors (exit 4): `{ "error": { "code": 4, "type": "not_found" | "duplicate_entry" | "branch_guard", "message": "…" } }`; text mode → same message on stderr. `spec/backlog/` is never written.

### `metta roadmap reorder <slug...> [--on-branch <name>]`

- Non-interactive; never prompts. Order: context → config → `assertOnMainBranch` (**before** reading roadmap state, so off-main rejections are `branch_guard` even for invalid permutations) → `roadmapStore.reorder(slugs)` (safe-slug + Set-diff permutation validation, notes preserved, single write only after validation passes) → `autoCommitFile(…, 'chore: reorder roadmap')`.
- JSON success: `{ "reordered": ["c", "a", "b"], "committed": true, "commit_sha": "<sha>" }`.
- Text success: `Roadmap reordered: c, a, b` + commit line.
- Errors (exit 4): `invalid_reorder` (message enumerates offending slugs, e.g. `invalid reorder — missing: b`) or `branch_guard`. A rejected invocation leaves `spec/roadmap.md` byte-for-byte untouched.

### `metta roadmap next [--on-branch <name>]`

- Order: context → config → `assertOnMainBranch` → `roadmapStore.list()` →
  - **empty** → JSON `{ "next": null }` / text `Roadmap is empty — nothing to activate.`; exit 0; **no write, no commit**;
  - `backlogStore.show(top.slug)` — **throw (dangling top, ADR-4)** → `not_found` envelope (`message` includes the remedy: restore `spec/backlog/<slug>.md` or `metta roadmap reorder …` it off the top), exit 4, **no pop, no write, no commit**;
  - success → `roadmapStore.removeTop()` → `autoCommitFile(…, 'chore: pop roadmap entry <slug>')`.
- JSON success: `{ "next": "foo", "message": "Run: metta propose \"Foo feature\"", "committed": true, "commit_sha": "<sha>" }` — the `message` is composed with `buildPromoteHandoff`, promote-style.
- Text success: `Next up: 'foo' — activate by running: metta propose "Foo feature"` + `  Removed from roadmap.` + commit line. The command never invokes `metta propose` itself.

### Guard classification (hook edits)

- `BLOCKED_TWO_WORD` gains `['roadmap', new Set(['add', 'reorder', 'next'])]`; the existing scope-key branch automatically yields `roadmap:add` / `roadmap:reorder` / `roadmap:next` — no scoping-logic change.
- New `const ALLOWED_BARE = new Set(['roadmap'])` and, in `classify()` after the `ALLOWED_TWO_WORD` lookup and before `BLOCKED_SUBCOMMANDS`: `if (ALLOWED_BARE.has(inv.sub) && (!inv.third || inv.third.startsWith('-'))) return 'allow'`. Allows `metta roadmap` and `metta roadmap --json`; `roadmap add/reorder/next` still hit `BLOCKED_TWO_WORD`; `roadmap <anything-else>` stays `unknown` → fail-closed. Bare `metta backlog` remains `unknown`-blocked as today.
- `metta-session-mint.mjs`: `SKILL_SCOPES['metta-roadmap'] = ['roadmap:add', 'roadmap:reorder', 'roadmap:next']`; the two "9 Tier-2 skill slugs" comments become 10. TTL/rotation untouched.

## Dependencies

**External:** none added. Uses existing runtime deps only — `zod` (schemas), `commander` (CLI). No remark for this file (ADR-1). No new npm packages, no build-script changes (`copy-templates` already covers the skills and hooks directories).

**Internal (all pre-existing, consumed as-is):**

- `src/state/state-store.ts` — `StateStore.readRaw`/`writeRaw`/`exists` (raw file I/O).
- `src/util/slug.ts` — `SLUG_RE`, `assertSafeSlug`.
- `src/cli/helpers.ts` — `createCliContext`, `assertOnMainBranch`, `autoCommitFile`, `outputJson`, `getErrorMessage`.
- `src/backlog/backlog-store.ts` — **read-only** consumption of `exists` and `show` from the CLI layer; the file is not modified and `spec/backlog/` is never written by any roadmap operation.
- `src/cli/commands/backlog.ts` — modified only to consume `buildPromoteHandoff`; output byte-identical (locked by existing tests).
- Guard/mint hooks and skill templates — additive edits per the byte-identical template/deployed pairing enforced by `tests/template-deploy-sync.test.ts`.

**Spec/requirement traceability:** store layer ⇢ "RoadmapStore + single markdown file" requirement; CLI layer ⇢ status-view, add, reorder, next, branch-discipline, and error-contract requirements; coupling layer ⇢ "same path promote uses" requirement; governance layer ⇢ guard-tiering, skill, and orchestrator-routing requirements; wiring edits (5–7) ⇢ "additive CLI context and barrel exports" requirement. Research decisions Q1–Q6 are honored throughout; the two research flags are closed by ADR-3 and ADR-4.

## Risks & Mitigations

- **R1 — Promote refactor silently changes backlog output.** The "backlog behavior verbatim" requirement fails if recomposition around `buildPromoteHandoff` alters a byte. *Mitigation:* the helper returns exactly the `metta propose "<title>"` fragment already embedded in both promote output strings; the existing backlog CLI test suite locks the exact JSON `message` and text line, so any drift fails CI.
- **R2 — `ALLOWED_BARE` over-allows or drifts between hook copies.** A new classify branch in a security hook is the one novel mechanism. *Mitigation:* the branch is gated on `inv.sub` membership in a one-element Set AND `third` absent-or-flag, placed before `BLOCKED_SUBCOMMANDS` but after the two-word allow lookup; `roadmap <word>` remains fail-closed `unknown`. Guard integration tests add explicit cases (bare allowed, `--json` allowed, three mutations blocked uncredentialed, backlog/changes entries unchanged), and `tests/template-deploy-sync.test.ts` fails if the `src/templates/hooks` and `.claude/hooks` copies diverge.
- **R3 — Hand-edited `spec/roadmap.md` lines that miss the grammar are silently ignored.** A user typing a hyphen-minus instead of the em dash, or an unbackticked slug, produces a line the parser drops. *Mitigation:* the read-only view is the same parser the store uses — what `metta roadmap` shows is exactly what mutations will preserve, so a dropped line is immediately visible; every mutation rewrites the file canonically, re-normalizing surviving entries; the format is documented in `schemas/roadmap-file.md`. Accepted residual risk: a malformed hand-edited entry is lost on the next mutation (the file is declared `RoadmapStore`-owned).
- **R4 — Dangling top entry wedges `roadmap next`.** With ADR-4 (no pop on `not_found`) and no `roadmap remove` subcommand in scope, a deleted-out-of-band backlog item at position 1 makes `next` fail repeatedly. *Mitigation:* the `not_found` message names both remedies (restore the backlog file, or `roadmap reorder` the dangling slug off the top); the status view marks the entry dangling so the state is diagnosable at a glance. A `roadmap remove` subcommand is deliberately out of scope for this change and should be logged as a backlog candidate at ship time.
- **R5 — Partial-write or concurrent-write corruption.** *Mitigation by construction:* every mutation is read → validate (Zod + safe-slug + permutation/duplicate checks) → one full-content `writeRaw`; a failure anywhere before the write leaves the file byte-for-byte untouched (asserted in tests via before/after byte comparison), and `autoCommitFile` refuses to commit over an otherwise-dirty tree, keeping git as the recovery log.
- **R6 — Vendor coupling.** The skill/guard/mint pieces bind the governance layer to Claude Code. *Flagged, accepted:* this is the repo-wide pattern for every existing skill; the CLI surface is fully usable without Claude Code, so no functional lock-in is introduced.
