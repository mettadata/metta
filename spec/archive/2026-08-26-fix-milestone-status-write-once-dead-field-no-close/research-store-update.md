# Research: Full store-level update (`MilestonesStore.update` + `milestone close` / `milestone update` CLI verbs + `abandoned` enum)

Change: `fix-milestone-status-write-once-dead-field-no-close`
Approach under evaluation: **Option 1 — full store-level update mirroring the sibling `IssuesStore` write-back pattern.**

All paths below are relative to the change root
`/home/utx0/Code/metta/.metta/worktrees/fix-milestone-status-write-once-dead-field-no-close/` unless absolute.

---

## 1. Existing patterns scanned

### 1.1 `MilestonesStore` today (`src/milestones/milestones-store.ts`)

- Read-only after create: `create` (:87-107), `list` (:109-127), `show` (:129-137), `exists` (:139-142). No write-back path.
- `create` is the validate-before-write template this approach extends: builds a plain frontmatter object, runs it through `validateFrontmatter` (:26-34, wrapping `MilestoneFrontmatterSchema.safeParse` with `formatZodError`), then serializes via `formatMilestone` (:66-72) and writes with `StateStore.writeRaw` (:106).
- `formatMilestone` (:66-72) uses `YAML.stringify` with the yaml default `keepUndefined: false` — an absent `target` is *omitted* from the block, never serialized as `target: null`. This is exactly the mechanism `--clear-target` needs: delete the key from the patched object and the serializer drops it.
- `parseMilestone` (:36-64) already round-trips file → validated frontmatter + body — `update` can reuse it verbatim for the read half.
- Not-found error text precedent: `show` throws `` `Milestone '${slug}' not found` `` (:132-134); the CLI maps `message.includes('not found')` → JSON error type `not_found` (`src/cli/commands/milestone.ts:183`).

### 1.2 The sibling `IssuesStore` write-back (`src/issues/issues-store.ts`)

The pattern this approach mirrors:

- `updateFrontmatter(slug, patch)` (:223-234): `assertSafeSlug` → `exists` check throwing `` `Issue '${slug}' not found` `` (:225-227) → `readRaw` → pure patch function (`applyFrontmatterPatch`) → byte-compare short-circuit (`if (patched === content) return { changed: false }`, :231) → `writeRaw`. Read → patch → validate → write, with the file untouched on any failure because validation happens inside the pure patch step *before* the write.
- `archive(slug, changeName?)` (:281-294) repeats the same exists-guard + readRaw + writeRaw shape.
- Auto-commit is **not** in the store — `IssuesStore` (and `MilestonesStore.create`) leave git to the CLI edge. `milestone create`'s commit block lives at `src/cli/commands/milestone.ts:77-87`: `git add spec/milestones` → `git commit -m 'chore: create milestone <slug>'` → `rev-parse HEAD`, with the whole block in a swallowing try/catch (`committed: false` reported when git is unavailable). This matches "functional core, imperative shell" and must be copied (or extracted) for the two new verbs.
- One deliberate divergence: issues patch frontmatter through the `yaml` Document API for minimal diffs (`src/issues/issue-frontmatter.ts` header comment, :6-24) because issue bodies/frontmatter may be hand-authored. Milestone frontmatter is a 3-key block always written by `formatMilestone`, so full re-serialization is fine (see §7 back-compat caveat).

### 1.3 Schema (`src/schemas/milestone-frontmatter.ts`)

- `status: z.enum(['open', 'closed']).default('open')` at :26 — the one-line enum extension point. `.strict()` object (:27) means unknown keys already fail loudly.
- `target` carries the regex + real-calendar-date refinement (:22-25); `update` re-validating the *full* patched frontmatter gets this for free (the spec's `target: '2026-02-30'` rejection scenario).

### 1.4 Renderers / rollup

- `src/milestones/milestone-rollup.ts:7` — `MilestoneRollup.status: 'open' | 'closed'` (duplicated literal union; should become `Milestone['status']`).
- Sort at :77-80: `if (a.status !== b.status) return a.status === 'open' ? -1 : 1` — correct for two states, **unstable for three** (`closed` vs `abandoned` comparison would order by whichever is `a`). Must become a rank comparator.
- Marker rendering is duplicated in three places, all `status === 'closed' ? '✓' : '▸'`:
  - `src/cli/commands/milestone.ts:121` (`milestone list`, uncolored)
  - `src/cli/commands/status.ts:33` (`printMilestoneSection`, `color('✓', 32)` / `color('▸', 36)`)
  - `src/cli/commands/progress.ts:216` (same colored form)
- `milestone show` prints `Status: ${item.status}` verbatim (`milestone.ts:166`) and passes `rollup.status` through to JSON (`milestone.ts:154`) — both handle `abandoned` automatically once the type widens; no code change needed there.

### 1.5 Guard hook + mint hook

- `.claude/hooks/metta-guard-bash.mjs`:
  - `ALLOWED_TWO_WORD` :60 — `['milestone', new Set(['list', 'show'])]` (read-only, no credential).
  - `BLOCKED_TWO_WORD` :79-81 — `['milestone', new Set(['create'])]` with the comment "Tier-2 scope key 'milestone:create', minted only by the metta-backlog skill".
  - Scope keys auto-derive at :902-905: a two-word blocked form produces `` `${sub}:${third}` `` — so adding `close`/`update` to the blocked set automatically yields scope keys `milestone:close` / `milestone:update`. No other guard logic changes.
- `.claude/hooks/metta-session-mint.mjs:35` — `SKILL_SCOPES['metta-backlog']` currently `['backlog:add', 'backlog:done', 'backlog:promote', 'backlog:migrate', 'milestone:create']`.
- **Byte-identity constraint:** `tests/hooks-byte-identity.test.ts` pins every `.claude/hooks/*.mjs` byte-identical to `src/templates/hooks/*.mjs`. Both copies of both hooks must be edited in lockstep or CI fails.
- The driving skill body also enumerates milestone actions: `.claude/skills/metta-backlog/SKILL.md:28` offers `create | list | show` — needs `close` and `update` branches so an authorized session can actually reach the new verbs.

### 1.6 Test harnesses

- `tests/milestones-store.test.ts` (136 lines): `mkdtemp(join(tmpdir(), 'metta-milestones-'))` per test, `seedMilestoneFile` helper writes raw file content directly (:20-23) — ideal for byte-snapshot assertions.
- `tests/cli-milestone.test.ts` (298 lines): `runCli` / `installFixture` / `execAsync` from `tests/helpers/cli.js`; `installFixture(tempDir)` provisions a git-initialized project so commit assertions work (`git log --format=%s` pattern at :63-65).
- `tests/milestone-rollup.test.ts` (148 lines): pure-function tests over `computeMilestoneRollups`.
- `tests/metta-guard-bash.test.ts` (1717 lines): `runHook` spawns the hook with a JSON event on stdin (:36-58); **zero** existing milestone-specific cases (verified by grep) — coverage today comes only from the generic two-word block/allow cases (`backlog add` block at :98, `backlog list` allow at :163).

---

## 2. Proposed store API shape

```ts
// src/milestones/milestones-store.ts
export interface MilestonePatch {
  name?: string
  target?: string        // set or change
  clearTarget?: boolean  // remove the key entirely (mutually exclusive with target)
  status?: Milestone['status']
  description?: string   // full body replacement
}

async update(slug: string, patch: MilestonePatch): Promise<Milestone>
```

Flow (read → patch → Zod re-validate → write; commit stays at the CLI edge):

1. `assertSafeSlug(slug)` — same guard as every other method (:22-24).
2. Exists check on `join('milestones', `${slug}.md`)`; throw `` `Milestone '${slug}' not found` `` (mirrors `show` :132-134 and `IssuesStore.updateFrontmatter` :225-227). Never creates a file.
3. `readRaw` + `parseMilestone` — the current file is itself validated on read (a corrupt file fails here, before any write).
4. Build the next frontmatter object:
   ```ts
   const next: Record<string, unknown> = {
     name: patch.name ?? current.name,
     ...(resolveTarget(patch, current)),   // target key present iff a value survives
     status: patch.status ?? current.status,
   }
   ```
   where `clearTarget: true` omits the key, `patch.target` replaces it, otherwise the current value (if any) carries through. `clearTarget` + `target` together is a programmer error — throw.
5. `validateFrontmatter(next, relPath)` — the **full** resulting frontmatter through `MilestoneFrontmatterSchema` before any I/O. A failing patch throws here; the file on disk is byte-identical by construction because nothing has been written.
6. `formatMilestone(validated, patch.description ?? current.description)` → `state.writeRaw`. `keepUndefined: false` guarantees a cleared target leaves no `target:` line (spec scenario "no `target` key (not `target: null`)").
7. Return the updated `Milestone` (parsed shape) so the CLI can emit status/fields in JSON without a second read.

Why a `clearTarget` boolean rather than `target: string | null`: the issue-side patch type (`IssueFrontmatterPatch = Partial<z.input<...>>`, `src/schemas/issue-frontmatter.ts:17`) never needed field *removal*; introducing `null` into the milestone patch would leak a YAML-serialization concern into the type and fight `YAML.stringify`'s `keepUndefined` behavior. A boolean maps 1:1 to the CLI's `--clear-target` flag and keeps the patch type free of null unions.

An empty patch (`update(slug, {})`) is a validated no-op rewrite at the store level; the *CLI* enforces "at least one field option required" (per spec) so the store stays simple and testable.

## 3. CLI wiring (`src/cli/commands/milestone.ts`)

### Shared commit helper

`create`'s commit block (:77-87) would otherwise be copy-pasted twice more. Extract:

```ts
async function commitMilestones(projectRoot: string, message: string):
  Promise<{ committed: boolean; commitSha?: string }>
```

— same `git add spec/milestones` → `commit` → `rev-parse`, same swallow-on-failure semantics. `create` refactors onto it (behavior-preserving).

### `metta milestone close <slug>`

```ts
milestone
  .command('close')
  .argument('<slug>', 'Milestone slug')
  .option('--abandoned', 'Mark abandoned instead of closed')
  .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
  .description('Close (or abandon) an open milestone')
```

Action flow, mirroring `create`'s structure (:57-100):

1. `createCliContext()`, load config, `assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)` — identical branch guard (:61-63).
2. `ctx.milestonesStore.show(slug)` — not-found surfaces here (exit 4, type `not_found` via the existing `:183` mapping).
3. Conflict check: if `current.status !== 'open'` → exit 4 with `{ error: { code: 4, type: 'milestone_conflict', message: 'Milestone '<slug>' is already <status>' } }` (message names the current status per spec). File untouched — no store call made.
4. `update(slug, { status: options.abandoned ? 'abandoned' : 'closed' })`.
5. `commitMilestones(ctx.projectRoot, 'chore: close milestone <slug>')` — one message for both closed and abandoned (spec pins `chore: close milestone <slug>` for the `--abandoned` scenario too).
6. JSON: `{ slug, status, committed, commit_sha }`; text: `Closed milestone: <slug>` / `Abandoned milestone: <slug>` + committed line, matching `create`'s output conventions (:89-94).

### `metta milestone update <slug>`

```ts
milestone
  .command('update')
  .argument('<slug>', 'Milestone slug')
  .option('--name <name>', 'Rename display name')
  .option('--target <date>', 'Set or change target date (YYYY-MM-DD)')
  .option('--clear-target', 'Remove the target date')
  .option('--description <text>', 'Replace the description body')
  .addOption(new Option('--status <status>', 'Set status explicitly').choices(['open', 'closed', 'abandoned']))
  .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
```

Notes:

- `Option.choices()` gives Commander-level rejection of bad `--status` values with a helpful message; Zod remains the authoritative write gate (defense in depth, consistent with "validate all state writes").
- `--target` vs `--clear-target` mutual exclusion via Commander's `.conflicts('clearTarget')` (Commander >= 9; the repo is on a modern Commander — verify version in `package.json` during planning) or a manual pre-check that exits 4.
- "No field options" check: if none of `name/target/clearTarget/description/status` present → exit 4 (`type: 'milestone_error'`, message "at least one field option is required"), no store call.
- Validation failures from the store (`Invalid milestone frontmatter … target …`) already carry field names via `formatZodError`; the catch block maps to exit 4 with the standard envelope — same shape as `create`'s catch (:95-100).
- Commit message: `chore: update milestone <slug>`.
- JSON: `{ slug, changed: ['target', 'status', …], committed, commit_sha }` (spec: "the fields changed").

`--json` parity comes free: both subcommands read `program.opts().json` exactly as `create`/`list`/`show` do (:58, :107, :134), and every error path uses `outputJson({ error: { code, type, message } })`.

## 4. Schema + rollup + renderer changes

1. `src/schemas/milestone-frontmatter.ts:26` → `status: z.enum(['open', 'closed', 'abandoned']).default('open')`. Zod's enum error already names the received value and allowed values (spec scenario "status: shipped rejected naming allowed values" — `formatZodError` renders it).
2. `src/milestones/milestones-store.ts:14` → `status: 'open' | 'closed' | 'abandoned'` (or derive: `status: MilestoneFrontmatter['status']` to kill the duplication permanently).
3. `src/milestones/milestone-rollup.ts`:
   - `:7` → `status: Milestone['status']`.
   - Sort `:77-80` → rank comparator:
     ```ts
     const rank = (s: Milestone['status']) => (s === 'open' ? 0 : 1)
     rollups.sort((a, b) => rank(a.status) - rank(b.status)
       || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
     ```
     For inputs containing only `open`/`closed` this is *behaviorally identical* to the current comparator (open→0, closed→1), preserving the spec's byte-compat requirement; `abandoned` joins the terminal group, slug-ascending within it.
   - Export a shared marker map so three render sites can't drift:
     ```ts
     export const MILESTONE_MARKERS = { open: '▸', closed: '✓', abandoned: '✗' } as const
     ```
4. Renderers (three sites): replace the ternary with the map lookup.
   - `src/cli/commands/milestone.ts:121` → `MILESTONE_MARKERS[r.status]` (uncolored).
   - `src/cli/commands/status.ts:33` and `src/cli/commands/progress.ts:216` → colored: `✓` stays green 32, `▸` stays cyan 36, `✗` red 31 (or grey 90 — subjective; recommend red 31 as visually distinct from grey target text at `progress.ts:217`). Glyph — not just color — differs, satisfying "visually distinguishable from both `▸` and `✓`" in no-color terminals.
   - `milestone show` (`milestone.ts:154`, `:166`): no change — status passes through as data.
   - `status`/`progress` JSON (`toMilestoneCountsRow`, `milestone.ts:39-42`): no change — status is already carried in the rollup row.

## 5. Guard hook + mint hook + skill

Four files, two logical edits, byte-identical pairs:

| Edit | Deployed | Template |
|---|---|---|
| `BLOCKED_TWO_WORD`: `['milestone', new Set(['create', 'close', 'update'])]` (line 81) + comment | `.claude/hooks/metta-guard-bash.mjs` | `src/templates/hooks/metta-guard-bash.mjs` |
| `SKILL_SCOPES['metta-backlog']`: append `'milestone:close', 'milestone:update'` (line 35) | `.claude/hooks/metta-session-mint.mjs` | `src/templates/hooks/metta-session-mint.mjs` |

No trust-model change: the guard's scope-key derivation (`metta-guard-bash.mjs:902-905`) and the two-band freshness logic are untouched — the new verbs ride the existing Tier-2 machinery exactly as `milestone create` does. `milestone list`/`show` stay in `ALLOWED_TWO_WORD` (:60), unchanged.

Plus: extend `.claude/skills/metta-backlog/SKILL.md` (milestone branch at :28) with `close` and `update` actions so the minted credential is actually reachable through the sanctioned skill flow. (Skill templates: check whether `SKILL.md` has a `src/templates/` counterpart during planning — the hooks do; skills are copied to `dist/` at build time per project conventions.)

## 6. Test plan

Near-1:1 ratio holds — every touched source file has an existing test file to extend; no new test files strictly required (optionally one new `tests/milestone-frontmatter.test.ts` for direct schema cases).

| Test file | New cases |
|---|---|
| `tests/milestones-store.test.ts` | `update` status patch preserves name/target/body; `clearTarget` removes the key (assert `readFile` content has no `target`); invalid patch (`target: '2026-02-30'`, empty name) throws naming the field AND file byte-identical to pre-call snapshot (use `seedMilestoneFile` + `readFile` before/after); not-found throws, `milestones/` dir gains no file; `abandoned` round-trips through `show`; reading a seeded `status: abandoned` file validates; seeded `status: shipped` file rejects naming allowed values; seeded pre-change `open`/`closed` files parse identically (back-compat pin). Temp-dir isolation: existing `mkdtemp`/`rm` beforeEach/afterEach (:11-18). |
| `tests/cli-milestone.test.ts` | `close` happy path: file frontmatter reads `status: closed`, `git log` contains `chore: close milestone <slug>` (pattern at :63-65), JSON `{ slug, status, committed, commit_sha }`; `close --abandoned` writes `abandoned`; close on already-`closed` → exit 4, conflict envelope, byte-identical file; close on missing slug → exit 4 `not_found`, no file created; branch-guard refusal without `--on-branch` (create has the precedent test); `update --description` replaces body only; `--clear-target` removes key; `--status open` reopens a closed milestone; `--target 2026-02-30 --json` → exit 4, envelope names `target`, byte-identical file; missing milestone → `not_found`; zero field options → non-zero exit, file untouched. Harness: `installFixture(tempDir)` + `runCli`, per existing suite. |
| `tests/milestone-rollup.test.ts` | Mixed `open`/`closed`/`abandoned` input sorts open-first then terminal slug-ascending; open/closed-only ordering unchanged (byte-compat pin); `abandoned` status passes through the rollup row. |
| `tests/cli-status.test.ts` / progress tests | One case each: an `abandoned` milestone renders (exit 0, `✗` marker, sorted after open); existing open/closed output assertions double as byte-compat pins. |
| `tests/metta-guard-bash.test.ts` | `metta milestone close x` / `metta milestone update x` blocked without credential (exit 2, mirroring `backlog add` at :98); allowed with a minted metta-backlog-scoped token covering `milestone:close`/`milestone:update` (token-fixture helpers already in the file); `milestone list`/`show` still allowed credential-free. |
| `tests/hooks-byte-identity.test.ts` | No edits — automatically pins the deployed/template hook pairs; failing it is the desired tripwire if one copy is forgotten. |
| `tests/metta-guard-mint-seam.test.ts` | Check whether it pins `SKILL_SCOPES` contents (it inspects scope overlap around :491); extend the metta-backlog scope expectation if so. |

## 7. Back-compat analysis

- **Read path:** enum extension is strictly additive — every existing file carries `open` or `closed`, both still valid; `.default('open')` unchanged. The spec's "byte-identical output when only open/closed exist" holds: the rank comparator is behavior-identical for two states (§4.3), markers for open/closed are the same glyphs/colors, JSON shapes gain no new keys.
- **Forward-compat caveat (accepted in intent.md §Impact):** a file written with `status: abandoned` fails validation under older metta builds. One-way door once any milestone is abandoned.
- **Serialization normalization:** `update` re-serializes the whole frontmatter block via `YAML.stringify`, unlike the issue store's minimal-diff Document API. Files written by `metta milestone create` round-trip stably (same serializer); a *hand-edited* file (reordered keys, YAML comments, unusual quoting) is normalized on first update and comments are dropped. Acceptable: milestone frontmatter is three metta-owned keys, metta never writes comments, and hand-editing is precisely the workflow this change eliminates. Not worth importing the Document-API machinery.
- **Body preservation:** `formatMilestone` trims the body (:70) — a body with leading/trailing blank lines is normalized on any update. Same class of accepted normalization; `parseMilestone` already trims on read (:55), so the parsed value is unchanged.

## 8. Risks

1. **Forgotten hook template mirror** — `hooks-byte-identity.test.ts` catches it in CI; low residual risk.
2. **Rollup comparator regression** — the only behavioral rewrite of existing logic; mitigated by the byte-compat pin tests (§6) and the fact that the two-state case is provably identical.
3. **Marker glyph rendering** — `✗` (U+2717) matches the width/class of the existing `✓` (U+2713); no `padEnd` misalignment expected. Verify in the CLI test's text-mode assertion.
4. **Guard scope routing** — only `metta-backlog` mints `milestone:close`/`milestone:update`. If a future ship/finalize flow wants to close milestones programmatically, its skill scope will need extending; out of scope now, but worth a comment at the `SKILL_SCOPES` line.
5. **`update --status closed` bypasses close's conflict check** — intentional per spec (US-2 reopen scenario is symmetric); `update` is the explicit "I know what I'm doing" verb, `close` is the guarded transition. Document in the command descriptions.
6. **Commander `.conflicts()` availability** — depends on the installed Commander major; if absent, a two-line manual check is equivalent. Resolve during planning by reading `package.json` (deterministic, no user escalation needed).
7. **Race between show and update in the close flow** — the conflict check (CLI reads, then store re-reads) is TOCTOU-shaped, but the store re-validates on its own read and the CLI is single-user/single-process over local files; consistent with every existing metta command. Accepted.

## 9. Assessment of this approach

**Pros**
- Mirrors the proven sibling pattern (`IssuesStore.updateFrontmatter`, `issues-store.ts:223-234`) — reviewers already know the shape; validate-before-write and CLI-edge commits are established conventions.
- Byte-identical-on-failure is structural (validation precedes I/O), not defensive — satisfies "no unvalidated state writes" with zero extra machinery.
- All new surface rides existing rails: error envelope, branch guard, auto-commit, Tier-2 scope derivation, temp-dir test harnesses. No new abstractions except a 3-entry marker map and a small commit helper (which *removes* duplication).
- Directly closes the reported zeus-session pain (`m1`/`m6` stale status and bodies) with a validated, auditable path.

**Cons / costs**
- Touches ~10 files (3 milestone modules, 2 renderer sites, 4 hook files, 1 skill file) plus 5-6 test files — the widest of the candidate options, though each edit is small.
- Full re-serialization normalizes hand-edited frontmatter (accepted, documented above).
- `abandoned` is a one-way forward-compat door for older builds (accepted in intent).

**Recommendation:** proceed with this approach as specified. It is the smallest design that makes the modeled lifecycle actually reachable, and every sub-decision (patch shape, clear-target boolean, CLI-edge commits, rank comparator, marker map, hook scope keys) has a direct precedent in the codebase cited above. Suggested implementation order: schema enum → store `update` + tests → rollup/renderers + tests → CLI verbs + tests → hooks/skill + guard tests.
