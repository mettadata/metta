# Research: Minimal close-only approach

Approach under evaluation: implement only `metta milestone close <slug>` (validated status flip + auto-commit), plus an "eligible for close" advisory in `list`/`show`/rollups. No body/target/name editing, no `abandoned` state, no generic `update` verb.

## 1. Current state (evidence)

- `MilestonesStore` exposes only `create` / `list` / `show` / `exists`; `create` throws if the file exists (`src/milestones/milestones-store.ts:87-142`). There is no write-back path of any kind.
- The read path already round-trips the full file: `parseMilestone` (`milestones-store.ts:36-64`) validates frontmatter via `MilestoneFrontmatterSchema` and extracts the body; `formatMilestone` (`milestones-store.ts:66-72`) re-serializes frontmatter with `YAML.stringify` and omits an absent `target`. A close operation can be composed entirely from these two existing helpers.
- Schema: `status: z.enum(['open', 'closed']).default('open')` (`src/schemas/milestone-frontmatter.ts:26`). Close-only needs **zero schema changes** — `closed` is already modeled.
- CLI: `registerMilestoneCommand` wires `create`/`list`/`show` (`src/cli/commands/milestone.ts:44-188`). The `create` action (`milestone.ts:57-101`) is the exact template for `close`: branch guard via `assertOnMainBranch` (`milestone.ts:63`), exit-4 JSON error envelope (`milestone.ts:67, 98`), swallowed-git auto-commit block (`milestone.ts:77-87`), `--json` success object (`milestone.ts:89-90`).
- Rollups: `computeMilestoneRollups` (`src/milestones/milestone-rollup.ts:25-83`) is pure; sort already orders `closed` last (`milestone-rollup.ts:77-80`); `list` already renders `✓` for closed (`milestone.ts:121`). The `MilestoneRollup.status` union `'open' | 'closed'` (`milestone-rollup.ts:7`) needs no change.
- Sibling precedent for a narrow mutation: `IssuesStore.updateFrontmatter(slug, patch)` — exists-check, read, patch, idempotence short-circuit, validated write (`src/issues/issues-store.ts:223-234`). A `MilestonesStore.close()` following this shape is fully idiomatic.
- Guard hook: read-only verbs allow-listed at `.claude/hooks/metta-guard-bash.mjs:60` (`['milestone', new Set(['list', 'show'])]`); Tier-2 mutating scope at `metta-guard-bash.mjs:81` (`['milestone', new Set(['create'])]`). Close-only means adding `'close'` to that one set.

## 2. Minimal store change

Two viable shapes:

**Option A — dedicated `close(slug)`** (~20-25 LOC):
reads via `state.readRaw`, `parseMilestone` (validates on read), throws not-found if missing, throws conflict if `status !== 'open'`, writes `formatMilestone({ ...frontmatter, status: 'closed' }, description)` after a `MilestoneFrontmatterSchema` re-validate. Pros: intent-revealing, conflict rule lives in the store, nothing speculative. Cons: a follow-up `update` change later duplicates the read-modify-validate-write skeleton.

**Option B — narrow `update(slug, { status })`** restricted to status: same LOC, generic name. Pros: the eventual full `update(slug, patch)` (spec.md's ADDED store requirement) grows out of it without a rename. Cons: a method named `update` that only accepts `status` is a misleading API surface until the follow-up lands.

For a genuinely close-only scope, **Option A** is the cleaner store change; it mirrors how `IssuesStore` separates `archive`/`remove` verbs from `updateFrontmatter`.

Caveat worth recording: `parseMilestone` trims the body (`milestones-store.ts:55`) and `formatMilestone` re-serializes frontmatter through `YAML.stringify`, so a close of a *hand-edited* file may not be byte-preserving outside the status field (key order/quoting normalization). Files created by `metta milestone create` round-trip cleanly since they use the same formatter. Acceptable, but the spec's "retains the identical description body" scenario should be tested against store-created files.

## 3. CLI wiring cost

One new subcommand, ~50-60 LOC, near-verbatim clone of the `create` action (`milestone.ts:57-101`):
- `assertOnMainBranch` + `--on-branch` acknowledgment (same as `milestone.ts:63`).
- Not-found and already-closed → exit 4 with `{ error: { code: 4, type, message } }` under `--json` (`type: 'not_found'` matching `show`'s mapping at `milestone.ts:183`, plus a conflict type, e.g. `milestone_conflict`).
- Auto-commit `chore: close milestone <slug>` with swallowed git failure, reported via `committed`/`commit_sha` (pattern at `milestone.ts:77-94`).

Plus one line in the guard hook (`metta-guard-bash.mjs:81`) and its integration test (`tests/cli-metta-guard-bash-integration.test.ts` exists). Tests extend `tests/cli-milestone.test.ts` and a milestones-store test — the 1:1 test ratio is maintained with no new test files.

Total estimated delta: ~80-100 src LOC, ~150-200 test LOC. Lowest-cost option of the candidates by a wide margin.

## 4. The "eligible for close" advisory

Mechanically cheap: `computeMilestoneRollups` already has `status`, `open`, `resolved`, `total` per rollup (`milestone-rollup.ts:71-75`). Eligibility is `status === 'open' && total > 0 && open === 0`. Two placement options:

- **Pure field**: add `eligible: boolean` to `MilestoneRollup` and let renderers consume it. Cleanest (functional core), but it flows into `toMilestoneCountsRow` (`milestone.ts:39-42`) and therefore into `milestone list --json` **and** the `milestones` JSON keys of `status`/`progress` (`src/cli/commands/status.ts:16-23`, `src/cli/commands/progress.ts:143-146`) — a JSON shape change on three surfaces.
- **Render-side computation**: compute the flag inline in `list`/`show` text rendering only, e.g. `list` appends `— all issues resolved; run: metta milestone close <slug>` and `show` adds an advisory line after `Progress:` (`milestone.ts:168`). Smaller blast radius; JSON untouched.

**Conflict, either way:** the advisory is explicitly *out of scope* in this change's own intent (`intent.md:44` — "'Eligible for close' advisory warnings … a possible follow-up, not part of this fix"), and spec.md's renderer requirement demands **byte-identical** human and `--json` output for `milestone list`/`show`/`status`/`progress` when only `open`/`closed` milestones exist (spec.md, "Renderers and rollups handle the abandoned state", incl. the "Open and closed output stays byte-compatible" scenario). Any advisory shown for an open-with-all-resolved milestone breaks that scenario — exactly the zeus `m1` case that motivates the change. Adopting this approach therefore requires rewriting both intent.md (pull the advisory in, drop `update`/`abandoned`) and spec.md (drop/relax the byte-compat scenario for eligible milestones). It cannot be bolted onto the current artifacts.

## 5. What stays broken

- **Stale bodies remain stale.** `m1-real-trade-exit-correctness` can be closed, but its body still reads "In flight as PR #24" (intent.md:11); `m6`'s satisfied-prerequisite text stays wrong. The only body-edit path remains hand-editing YAML — the exact "unvalidated state write" violation this change was filed to eliminate. Close-only fixes the status half of the reported problem and leaves the body half untouched.
- **No `abandoned` state.** Dropped milestones must either sit `open` forever (dashboard lies persist) or be mislabeled `closed` (semantically wrong: "achieved" vs "dropped"). Schema stays `z.enum(['open','closed'])`.
- **No target/name edits.** A slipped target date is uncorrectable except by hand-edit.
- **Close is irreversible via CLI.** With no `update --status open`, a mistaken close can only be undone by hand-editing frontmatter or `git revert` of the auto-commit. `create` can't help — it refuses existing files (`milestones-store.ts:91-93`). This is a real operational sharp edge for a one-way verb.

## 6. Follow-up work implied

A near-certain second change carrying: `MilestonesStore.update(slug, patch)`, `milestone update` CLI verb (name/target/clear-target/description/status incl. reopen), the `abandoned` enum value + renderer/rollup handling, and the `milestone update` guard entry. That follow-up re-touches every file this change touches (store, CLI, rollup, guard, all four test files) — i.e. the split roughly doubles review/ship overhead versus doing it once, with the interim window leaving hand-editing as the only body/target path.

## 7. Does it satisfy this change's spec.md?

No — it misses most of it. spec.md defines 1 MODIFIED + 5 ADDED requirements:

| Requirement (spec.md) | Close-only coverage |
|---|---|
| MODIFIED: store + CLI surface (`abandoned` enum, `close` **and** `update` verbs, guard tiers for both) | **Partial** — `close` verb and its guard entry only; no `abandoned`, no `update`. 3 of 5 scenarios unmet or inapplicable (abandoned-validates, invalid-status naming three allowed values, update registration). |
| ADDED: `update(slug, patch)` store method | **Missed entirely** — all 4 scenarios (field-preserving patch, clear-target, invalid-patch byte-identity, missing-slug). A `close()` covers only the status→closed slice of scenario 1. |
| ADDED: `milestone close` CLI verb | **Mostly satisfied** — 4 of 5 scenarios pass; the "Abandoned flag writes the abandoned state" scenario fails (no `--abandoned`). |
| ADDED: `milestone update` CLI verb | **Missed entirely** — all 6 scenarios, including the reopen scenario and the stale-body ("In flight as PR #24" → "Shipped in v0.5.0") scenario that traces directly to the reported problem. |
| ADDED: renderers/rollups handle `abandoned` | **Missed** — 3 of 4 scenarios inapplicable (no abandoned state exists); the 4th (byte-compat) is actively **violated** if the advisory ships. |
| ADDED: guard authorization for close **and** update | **Half** — `milestone close` only. |

Score: 0 of 5 ADDED requirements fully satisfied; 1 nearly satisfied (close verb, minus `--abandoned`); 3 wholly or almost wholly missed; and the advisory feature contradicts both intent.md's Out of Scope list (`intent.md:44`) and spec.md's byte-compat scenario.

## 8. Assessment

**Pros**
- Smallest possible delta (~100 src LOC); one store method, one subcommand, one guard-set entry; zero schema change; zero rollup-type change.
- Fixes the single most-reported symptom (permanently-open completed milestones) through a fully validated, auto-committed path.
- Every piece follows an existing in-repo pattern (`create` action clone, `IssuesStore.updateFrontmatter` store shape).

**Cons**
- Fails this change's spec.md as written — the change artifacts (intent, spec, stories) would need substantial rewriting to match the narrower scope, and the advisory piece directly contradicts the current intent's out-of-scope list.
- Leaves the body/target half of the reported defect (stale "In flight as PR #24") unfixed, with hand-editing (unvalidated writes) still the only recourse.
- Introduces an irreversible CLI operation (close with no reopen).
- The implied follow-up change re-touches the identical file set, roughly doubling total lifecycle cost.

**Recommendation:** do not adopt close-only as scoped here. If minimalism is the goal, the defensible minimal cut is `close` **plus** `--abandoned` and the enum extension (cheap: one enum literal, one flag, marker/sort tweaks) while deferring only `milestone update` — that keeps 3 of 5 ADDED requirements and avoids the mislabel-dropped-milestones trap. If close-only is nonetheless chosen, drop the advisory (it conflicts with intent.md's own out-of-scope list and the byte-compat scenario) and re-scope spec.md before execution, accepting the follow-up change for `update`/body editing as committed debt.
