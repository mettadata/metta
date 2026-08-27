# automatic-version-cut-ship-user-decision-2026-08-26-make

## Problem

Shipping a change and cutting a release are two separate, manually coordinated steps. Every ship-path skill (`metta-ship`, `metta-propose` at its ship opt-in, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`) ends after the PR merge and main fast-forward + rebuild, leaving the shipped work unreleased until someone remembers to run `/metta-release` on demand. In practice this means:

- **Releases lag behind ships.** Shipped changes accumulate on main untagged; `metta release status` reports a growing unreleased backlog, and the changelog/tag history stops corresponding to what actually landed. Anyone consuming the project (developers pulling main, tooling reading tags, the statusline reading version state) sees a stale version.
- **The manual step is easy to forget and easy to get wrong.** The bump derivation, the cut, and the tag push are all human-triggered, so consistency depends on discipline rather than the framework — the opposite of metta's spec-driven, orchestrated lifecycle.
- **The one automated-ish path we do have is broken in a repeatable way.** `metta release cut --github` has failed identically on both real cuts to date (v0.5.0 and v0.6.0): the GitHub-release step runs before the tag exists on the remote. `gh release create` requires the pushed tag, but the pipeline cuts locally pre-push by design, so the GitHub release step is guaranteed to fail every time it is used in the natural order. Both releases required manual repair.

Affected parties: internal developers running any ship-path skill on metta (and, once metta is adopted elsewhere, any project using ship-path skills), plus anyone relying on tags/GitHub releases as the record of what shipped.

## Proposal

Make version cutting an automatic, default-on part of the ship step, governed by a new config knob, reusing the existing release machinery end to end.

### 1. Config: `release.on_ship`

- Add `on_ship` to `ReleaseConfigSchema` in `src/schemas/project-config.ts` as an enum `auto | prompt | off`.
- Default is `auto` via Zod `.default('auto')`; an omitted key means `auto`; `metta install` scaffolds the key explicitly. This is the same three-legged default-on pattern already used by `uat.enforce_on_ship`.
- Add config escape hatch `release.allow_major_pre_1: boolean` (default `false`) — see safety rails below.

### 2. Ship-step behavior (all ship-path skills)

In every ship-path skill — `metta-ship`, `metta-propose` at its ship opt-in, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap` — **after** the PR merge and main fast-forward + rebuild, the skill runs the release flow:

1. `metta release status` to establish current version and unreleased shipped changes since the last tag.
2. Derive the bump (major/minor/patch) from the shipped changes since the last tag.
3. `metta release cut --yes` with the derived bump. The release commit + annotated tag land on main.
4. The tag push rides the already-authorized main push (`--follow-tags`) — never a force push, never a separate unconfirmed push.

The cut happens **only after the user-approved merge** — never at a PR-open hand-back. If a ship path stops at "PR opened, awaiting review," no cut occurs.

Mode semantics:

- `auto` — run the flow above without asking.
- `prompt` — report the unreleased change count and recommended bump, then ask before cutting. Fail-closed in non-interactive contexts: skip the cut and emit a loud notice (never cut without an answer).
- `off` — current behavior; releases remain on-demand via `/metta-release`.

### 3. Fixed cut/publish sequencing (end the `--github` double-failure)

The ship-step release sequence MUST be ordered so the GitHub release is created only after the tag exists on the remote:

merge → pull/fast-forward → cut (local release commit + annotated tag, **no** `--github`) → push main with `--follow-tags` (riding the authorized push) → **then** `gh release create` against the now-pushed tag, with graceful degradation (warn and skip) if `gh` is absent.

Whether this lands as a `ReleasePipeline` reorder (split cut/publish phases) or as the skill running the publish step post-push is a design-phase decision, but ending the v0.5.0/v0.6.0 double-failure pattern is a requirement of this change, not an implementation nicety.

### 4. Safety rails

1. **Pre-1.0 MAJOR guard.** Derived MAJOR bumps are never auto-applied while the project version is < 1.0.0 — 1.0.0 is reserved for the npm-publish milestone. When derivation says major pre-1.0, auto mode cuts **minor** instead and reports the downgrade prominently. `release.allow_major_pre_1: true` opts out of the guard.
2. **Warn-and-continue.** A failing cut never un-merges or blocks the completed ship. The skill reports the failure and continues (the same posture as UAT generation): the change is shipped, and the tag can be cut on-demand later via `/metta-release`.
3. **Missing `release` config key.** Recorded assumption: when the `release` key is entirely absent from project config (release commands refuse today — `src/cli/commands/release.ts:103`), ship-path skills **skip** the cut with a one-line loud notice — not an error, not a ship blocker.
4. **No new mutation surface.** Tokens, UAT enforcement, and gates are untouched. The only push involved is the already-authorized main push.

### 5. Reuse, no second cut path

The ship step reuses the existing `ReleasePipeline` (`src/release/release-pipeline.ts`) and the `/metta-release` machinery. No parallel cut implementation is introduced.

### 6. Guard/mint scoping

Today `release cut` is Tier-2 scope `release:cut`, minted only by the `metta-release` skill (`.claude/hooks/metta-guard-bash.mjs`, `.claude/hooks/metta-session-mint.mjs`). Extend guard/mint scoping so the ship-path skills' release cut invocation is authorized in both fork and main-session contexts, without loosening authorization for anything else.

### 7. Spec and test deltas

- Spec deltas to the `release-versioning` capability (new `on_ship` config, mode semantics, safety rails, cut/publish ordering) and to `finalize-ship` ship-step wording (the ship step now includes the post-merge release flow).
- Grep-assert tests verifying every ship-path skill carries the post-merge release step, in line with the existing skill-content test pattern.

## Impact

- **`src/schemas/project-config.ts`** — `ReleaseConfigSchema` gains `on_ship` (enum, `.default('auto')`) and `allow_major_pre_1` (boolean, default `false`). Existing configs without these keys parse to the defaults; no migration needed.
- **`metta install` scaffolding** — scaffolded project config now writes `release.on_ship: auto` explicitly (mirroring `uat.enforce_on_ship`).
- **Ship-path skills** (`metta-ship`, `metta-propose` ship opt-in, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-fix-gap`) — each gains the post-merge release step with mode handling, safety rails, and warn-and-continue failure posture. Default behavior change: ships now cut a release automatically unless configured otherwise.
- **`src/release/release-pipeline.ts` / `/metta-release`** — cut/publish sequencing changes so the GitHub release runs against the pushed tag (pipeline phase split or skill-side publish step — design-phase call). On-demand `/metta-release` keeps working and benefits from the same ordering fix.
- **Guard/mint hooks** (`.claude/hooks/metta-guard-bash.mjs`, `.claude/hooks/metta-session-mint.mjs`) — `release:cut` authorization widened to ship-path skills in fork and main-session contexts.
- **Specs** — `release-versioning` and `finalize-ship` capability specs updated; new grep-assert tests over ship-path skill content.
- **Push semantics** — the main push in ship paths gains `--follow-tags`; still rides the single user-authorized push, never force, never a second unconfirmed push.
- **Not affected** — token accounting, UAT generation/enforcement, gate runner, PR-open hand-back flows (no cut before merge), and projects with `release.on_ship: off` (identical to today's behavior).

## Out of Scope

- **Publishing to npm** — 1.0.0 and npm publish remain a separate future milestone; this change deliberately guards against accidentally reaching major pre-1.0.
- **Changing bump-derivation rules** — the existing derivation from shipped changes is reused as-is; only the pre-1.0 major→minor downgrade layer is added on top.
- **Cutting at PR-open** — no release activity at PR-open hand-back; the cut is strictly post-user-approved-merge.
- **New push authorization** — no new push flows, no force pushes, no auto-push beyond the already-authorized main push.
- **Changing tokens, UAT, or gates** — enforcement and generation behavior of all three is untouched.
- **A second cut implementation** — no ship-specific release code path; `ReleasePipeline` is the single cut mechanism.
- **Retroactively repairing v0.5.0/v0.6.0 GitHub releases** — this change fixes the pattern going forward; historical release records are not modified.
- **Making `release` config mandatory** — projects without a `release` key keep working; ship paths skip the cut with a notice rather than forcing adoption.
