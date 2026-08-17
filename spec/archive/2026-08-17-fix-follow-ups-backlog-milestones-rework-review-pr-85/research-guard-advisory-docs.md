# Research: guard-bash bare-backlog allowlist + tier advisory cap + stale spec/backlog docs sweep

Change: `fix-follow-ups-backlog-milestones-rework-review-pr-85`
All paths relative to the change worktree root: `/home/utx0/Code/metta/.metta/worktrees/fix-follow-ups-backlog-milestones-rework-review-pr-85`

---

## Defect A — bare `metta backlog` fails closed in guard-bash

### Findings

- **Hook copies are byte-identical** (verified with `cmp`): `src/templates/hooks/metta-guard-bash.mjs` == `.claude/hooks/metta-guard-bash.mjs`. Identity is enforced by `tests/hooks-byte-identity.test.ts` (all `.mjs` hooks, data-driven over the directory listing) and by `tests/cli-install.test.ts:305` (installed `.claude/hooks/` matches `src/templates/hooks/`, byte-identical and executable). Any fix MUST land in both copies or CI fails.
- **Classification flow for bare `metta backlog`** (`classify()`, `src/templates/hooks/metta-guard-bash.mjs:131-141`): `sub='backlog'`, `third=undefined` →
  1. not in `ALLOWED_SUBCOMMANDS` (line 22);
  2. `ALLOWED_TWO_WORD.get('backlog')` exists (line 36: `list`, `show`) but requires a `third` — no match;
  3. `ALLOWED_BARE` (line 77) is `new Set(['roadmap', 'release'])` — `backlog` absent;
  4. not in `BLOCKED_SUBCOMMANDS` (line 51); `BLOCKED_TWO_WORD.get('backlog')` (line 61) requires a `third` — no match;
  5. → `'unknown'` → fail-closed block, exit 2 with the "Blocked unknown metta subcommand" message (lines 300-310).
- **Bare `metta backlog` is truly read-only**: `src/cli/commands/backlog.ts:46-49` registers the `backlog` group with subcommands `list`/`show`/`add`/`promote`/`done`/`migrate` and **no default subcommand** — unlike `src/cli/commands/release.ts:48`, which uses `.command('status', { isDefault: true })`. So bare `metta backlog` makes Commander print the group help and exit non-zero; it performs zero state reads/writes. (Contrast: bare `metta release` and bare `metta roadmap` are genuine read-only status views, which is what the `ALLOWED_BARE` comment at lines 72-76 describes.)
- **Existing test coverage** (`tests/metta-guard-bash.test.ts`): backlog two-word coverage exists (`backlog list` allowed at line 158, `backlog show` at 163, `backlog add` blocked at 93, Tier-2 `backlog:add` scope at 751); the **bare-form precedent** to mirror is the release block at lines 809-882: bare `metta release` allowed (815), `metta release --json` allowed (821), `metta release frobnicate` fail-closed unknown (879). There is no bare-`backlog` test today. An integration harness also exists at `tests/cli-metta-guard-bash-integration.test.ts`.

### Approaches Considered

- **A1 — Add `'backlog'` to `ALLOWED_BARE` in both hook copies.** One-token change at `src/templates/hooks/metta-guard-bash.mjs:77` mirrored into `.claude/hooks/metta-guard-bash.mjs:77`, plus comment update (the block comment at lines 72-76 should mention backlog; keep the deliberate exclusion note for bare `milestone` at lines 41-44 intact). `classify()` line 136 already handles the bare+flags shape (`!inv.third || inv.third.startsWith('-')`), so `metta backlog --json` is covered and `backlog <unknown-word>` stays fail-closed. Pros: minimal, matches the existing roadmap/release pattern, no CLI behavior change. Cons: what the allowlisted bare form actually does today is print help + exit 1, which diverges slightly from the comment's "read-only status view" claim.
- **A2 — A1 plus make `list` the default subcommand** (`.command('list', { isDefault: true })` at `src/cli/commands/backlog.ts:52`), following the `release status` precedent at `src/cli/commands/release.ts:48`. Pros: bare `metta backlog` becomes a genuinely useful read-only view, making the `ALLOWED_BARE` comment truthful and matching roadmap/release UX. Cons: changes CLI behavior (help → list output); needs one new case in `tests/cli-issue-backlog.test.ts` or `tests/backlog-view.test.ts`.
- **A3 — Generic classify() rule** ("any sub with `ALLOWED_TWO_WORD` entries is allowed bare"). Rejected: it would silently allow bare `metta milestone`, which the hook comment (lines 42-44) documents as deliberately fail-closed, and it widens the allow surface for every future two-word group by default. Fail-closed-by-default is the hook's core invariant.

### Decision

**A2 (A1 + default-to-list).** Add `'backlog'` to `ALLOWED_BARE` in both hook copies with comment updates, and make `list` the `isDefault` subcommand of the backlog group. Mirror the release bare-form tests in `tests/metta-guard-bash.test.ts`: allow bare `metta backlog`, allow `metta backlog --json`, keep `metta backlog frobnicate` fail-closed. If the planner wants the absolute minimum diff, A1 alone fixes the reported defect; A2's extra line is low-risk and makes the allowlist comment accurate.

---

## Defect B — "upscale recommended" advisory not capped at `standard`

### Findings

- **Renderer**: `src/complexity/renderer.ts:44-48` — after the agreement and downscale branches, any `recRank > chosenRank` falls through to `upscale recommended`, including `recommended === 'full'`.
- **Cap sites in complete.ts** (both custom strings, neither uses `renderBanner`):
  - Intent-time upscale, `src/cli/commands/complete.ts:362-370`: `if (recommendedTier === 'full')` → writes `'Advisory: scored full -- upscale to full is not yet supported; consider /metta-propose --workflow standard'` and skips the prompt.
  - Post-implementation upscale, `src/cli/commands/complete.ts:462-469`: same pattern, message `'Advisory: implementation scored full -- promotion to full is not yet supported; ...'`.
- **All `renderBanner` callers** (grep, complete):
  1. `src/cli/commands/complete.ts:352` — downscale-declined branch; `recommended < current` there, so never an upscale-to-full render.
  2. `src/cli/commands/complete.ts:420` — upscale branch, but only reachable inside the `else` of the `recommendedTier === 'full'` hard cap (line 364), so never full there either.
  3. `src/cli/commands/instructions.ts:52` — `renderBanner(metadata.complexity_score, metadata.workflow)`, uncapped. **This is the live leak**: a change scored `full` while on `quick`/`standard`/`trivial` prints `-- upscale recommended` (implicitly to full) on every `metta instructions` call.
- `renderStatusLine` (`src/complexity/renderer.ts:59-68`) prints `recommended: <tier>` as a factual score readout, not an actionable advisory — out of scope for the cap, but worth a planner double-check that no UX copy treats it as a prompt.
- **Tests**: `tests/complexity-renderer.test.ts` covers upscale wording at lines 47-52, 62-67, and — directly affected by the cap — line 82-86 (`scored full with chosen trivial produces upscale`), which will need its expectation updated.

### Approaches Considered

- **B1 — Cap inside `renderBanner` (single choke point).** Add e.g. `const MAX_UPSCALE_TIER: Tier = 'standard'` and, in the upscale branch, clamp the recommended-target: when `recommended` outranks `standard`, render a capped message that stays truthful about the score, e.g. `Advisory: current quick, scored full -- upscale to standard recommended (full upscale not supported)`. Edge case to specify for the planner: current `standard`, scored `full` — the capped target equals the current tier, so the banner should state the cap without recommending a move (e.g. `Advisory: current standard, scored full -- full tier not supported; staying at standard`). Pros: every present and future caller (instructions.ts today) is consistent; matches "functional core" convention (policy in the pure module, I/O at the edges); complete.ts's bespoke messages remain valid because those branches never reach `renderBanner`. Cons: renderer gains a policy constant that must track `complete.ts`'s notion of "full unsupported" until full upscale ships.
- **B2 — Cap at each caller.** Leave the renderer generic; add a `recommended === 'full'` guard in `instructions.ts`. Pros: renderer stays a pure formatter. Cons: the cap policy is already duplicated twice in `complete.ts` with drifting wording (lines 364-370 vs 463-469); a third copy invites exactly the divergence being fixed, and any future caller re-opens the defect.
- **B3 — Clamp at scoring time** (scorer never emits `full`). Rejected: the `full` score is real data — downscale-from-full advice, `renderStatusLine`, and the persisted `actual_complexity_score` (complete.ts:449, documented as authoritative) all need the true tier. Falsifying the score to fix a display concern violates the no-unvalidated/derived-state spirit.

### Decision

**B1 — cap in the renderer.** Single choke point; fixes `instructions.ts:52` and future callers for free; no change needed at the two `complete.ts` sites (their custom messages already comply — optionally align their wording with the renderer's for consistency, non-blocking). Update `tests/complexity-renderer.test.ts:82-86` and add cases: scored full / chosen quick (capped to standard), scored full / chosen standard (cap-equals-current edge), scored standard / chosen quick (unchanged plain upscale).

---

## Defect C — stale `spec/backlog/` references: complete inventory

Repo-wide grep for `spec/backlog` under `src/`, `docs/`, `.claude/`, `spec/`, `scripts/`, `package.json` (excluding `spec/archive/`, `spec/issues/`). The backlog is now a frontmatter view over `spec/issues/` (`backlog: true` + optional `priority`/`order`/`milestone`); `done` archives via `spec/issues/resolved/<slug>.md`; `spec/backlog/` exists only as legacy input to `metta backlog migrate`.

### Must fix (in scope)

| # | Location | Current | Replacement |
|---|----------|---------|-------------|
| 1 | `src/cli/commands/refresh.ts:176` | TOC row `| [Backlog](spec/backlog/) | \`spec/backlog/\` | Prioritized backlog items |` | **Drop the row** and widen the Issues row (line 175) description to `Logged issues and backlog items (backlog is a frontmatter view)`. Repointing the Backlog row at `spec/issues/` would create two TOC rows for one path — dropping is cleaner. Optional: add a `spec/milestones/` row (new store from PR #85) while here. |
| 2 | Worktree root `CLAUDE.md` (generated TOC section) | Same stale Backlog row | Regenerate via `/metta-refresh` after fixing #1, or hand-edit inside the managed markers. `tests/refresh.test.ts:135-141` only pins Constitution/Active Specs, so no test breaks; adding `expect(result).not.toContain('spec/backlog/')` is a cheap regression pin. |
| 3 | `src/templates/hooks/metta-guard-edit.mjs:130` **and** `.claude/hooks/metta-guard-edit.mjs:130` | `ALLOW_PREFIXES = ['spec/issues/', 'spec/backlog/']` | Remove `'spec/backlog/'` (keep `'spec/issues/'`); update the comment above (lines ~124-127, "issue/backlog bodies") to "issue bodies". Both copies must stay byte-identical (`tests/hooks-byte-identity.test.ts`). **Test flip required**: `tests/metta-guard-edit.test.ts:87-94` currently asserts exit 0 for a `spec/backlog/<slug>.md` write with no active change — invert to expect exit 2 (blocked) or delete. This is a tightening (denies out-of-band edits under a dead path). |
| 4 | `docs/workflows/README.md:20` | `/metta-progress ... Aggregates spec/changes/, spec/issues/, spec/backlog/.` | `Aggregates \`spec/changes/\` and \`spec/issues/\` (backlog entries are issue frontmatter).` |
| 5 | `docs/workflows/README.md:23` | `/metta-backlog ... Reads/writes spec/backlog/.` | `Reads/writes backlog frontmatter on \`spec/issues/\` entries; manages \`spec/milestones/\`.` |
| 6 | `docs/workflows/skills.md:470-505` (whole `/metta-backlog` section; stale lines 479, 491, 500-501) | Describes the deleted directory store: CLI "owns the spec/backlog/ directory", add overwrites `spec/backlog/<slug>.md`, done archives to `spec/backlog/done/`, promote echoes `metta propose` | **Section rewrite, not a word swap**: wraps `metta backlog list/show/add [--new]/promote/done/migrate` plus `metta milestone create/list/show`; add flips `backlog: true` frontmatter on an existing issue or mints a `type: idea` entry in `spec/issues/` with `--new`; promote echoes `/metta-fix-issues <slug>`; done archives to `spec/issues/resolved/<slug>.md` (`--change` stamps Shipped-in); migrate converts legacy `spec/backlog/`. Source of truth: `src/templates/skills/metta-backlog/SKILL.md` (already correct) and `src/cli/commands/backlog.ts`. |
| 7 | `docs/internals/architecture.md:45` | `| backlog | src/backlog/ | backlog-store.ts | CRUD over prioritized backlog items in spec/backlog/. |` | `| backlog | \`src/backlog/\` | \`backlog-view.ts\` | Pure backlog view computed from \`spec/issues/\` frontmatter (\`backlog-view.ts\`) plus legacy-store migration (\`backlog-migrate.ts\`). |` — `backlog-store.ts`/`BacklogStore` were deleted in PR #85. |
| 8 | `docs/guide/troubleshooting.md:73` | Exceptions: `.md files under spec/issues/ and spec/backlog/ (so you can enrich issue/backlog bodies ...)` | `.md files under \`spec/issues/\` (so you can enrich issue bodies the CLI created)`. Must land together with #3 so docs match hook behavior. |
| 9 | `docs/internals/guard-hooks.md:223` (and the preamble ~line 217 "issue/backlog bodies") | `ALLOW_PREFIXES ... spec/issues/, spec/backlog/ ... dedicated commands (metta issue, metta backlog add)` | Entries: `spec/issues/` only. Rationale still cites both commands — both now write under `spec/issues/`. Preamble: "enrichment of issue bodies". |
| 10 | `docs/workflows/state.md:270-288` — **found by sweep, NOT in the listed defect set** | Entire `## spec/backlog/ — prioritized items` section: cites deleted `BacklogStore` (`src/backlog/backlog-store.ts`), the `**Added**/**Status**/**Priority**` file format, and `spec/backlog/done/` relocation | Replace with a short section documenting the backlog as a view: `backlog: true` / `priority` / `order` / `milestone` YAML frontmatter on `spec/issues/*.md`; `metta backlog done` archives via `spec/issues/resolved/`; legacy `spec/backlog/` handled only by `metta backlog migrate`. Check whether state.md documents `spec/milestones/` at all and add it if missing. |

### Legitimate references — leave alone

- `src/cli/commands/backlog.ts:24,58,290` — comments/description about the *legacy* store and `migrate`; intentional.
- `src/backlog/backlog-migrate.ts` — the migration itself.
- `src/templates/skills/metta-backlog/SKILL.md:27,37` and `.claude/skills/metta-backlog/SKILL.md:27,37` — correct ("`spec/backlog/` is not a store"; migrate description).
- `spec/specs/issue-logging/spec.md` (many lines) — normative "MUST NOT write to `spec/backlog/`" requirements; correct by design.
- `docs/api.md:973` — generated scenario title mirroring the spec ("spec/backlog/ is never read"); correct.
- `docs/changelog.md` (all hits) — historical record; never rewrite.
- `docs/proposed/09-cli-integration.md:826` — pre-build design doc under `docs/proposed/`; historical, out of scope.
- `spec/changes/fix-follow-ups-backlog-milestones-rework-review-pr-85/intent.md` — this change's own intent.

### Beyond the listed set — needs an orchestrator decision

- **`spec/specs/roadmap-feature/spec.md:25,50,53,65,68,73,138`** — the living roadmap spec still normatively requires `BacklogStore` and `spec/backlog/<slug>.md` resolution, but `roadmap.ts` was repointed to `issuesStore` in PR #85 (per `docs/changelog.md:23`). This is genuine spec-vs-code drift in a *normative* document, larger than a docs sweep. Recommendation: do NOT fold into this fix; log it as a gap/issue (`/metta-issue` or a `spec/gaps/` entry) so it goes through its own reconciliation. Flagging here so it is not lost.

---

## dist/ propagation mechanism

`package.json:17-18`: `"build": "tsc && npm run copy-templates && node scripts/emit-build-stamp.mjs"`, where `copy-templates` does `rm -rf dist/templates/hooks ... && cp -r src/templates/hooks dist/templates/hooks` (plus workflows, gates, gate-scaffolds, artifacts, skills, agents, docs, statusline). So:

- Edits to `src/templates/hooks/*.mjs` reach `dist/` automatically on `npm run build` — nothing extra needed.
- The live `.claude/hooks/` copies are **not** produced by the build; they must be hand-mirrored, and `tests/hooks-byte-identity.test.ts` + `tests/cli-install.test.ts:305` fail the suite on any divergence — this is the enforcement backstop for Defects A and C item #3.

---

## Summary of recommendations

1. **Defect A**: add `'backlog'` to `ALLOWED_BARE` in both `metta-guard-bash.mjs` copies (comment updated) and make `list` the `isDefault` backlog subcommand (release precedent, `release.ts:48`); mirror the release bare-form tests (allow bare / allow `--json` / `frobnicate` stays fail-closed).
2. **Defect B**: cap the upscale advisory inside `renderBanner` (`src/complexity/renderer.ts`) at `standard` — single choke point covering `instructions.ts:52`, the only uncapped surface; `complete.ts:362-370` and `:462-469` already self-cap and need no change; update/extend `tests/complexity-renderer.test.ts` (line 82-86 breaks as-is).
3. **Defect C**: apply the 10-item must-fix table (note item #3's guard-edit test flip and item #10's state.md section found beyond the listed set); leave the legitimate references; route the stale `roadmap-feature` spec to a separate gap/issue.

Risks: item #3 tightens the edit guard (out-of-band `spec/backlog/*.md` edits become blocked — intended); Defect A/A2 changes bare `metta backlog` output from help to the list view; Defect B changes user-visible advisory wording (renderer test must be updated in the same commit).
