# Research: Derived milestone status from issue rollups

**Approach under evaluation:** compute milestone open/closed automatically from issue rollups — a milestone whose attached issues are all resolved renders as closed. No explicit close verb, no store write path.

**Verdict up front:** this approach is cheap and self-maintaining for the narrow "dashboard lies" symptom, but it cannot satisfy the change's spec.md. It fails or leaves unmet all six requirement blocks (quantified in §6), cannot represent `abandoned`, does nothing for stale body text, and turns the persisted `status` field into a second, conflicting source of truth. It is also explicitly listed as out of scope in the change's own intent (`intent.md:43`).

---

## 1. Where derivation would live

The natural home is the existing pure rollup function — the single choke point every renderer already flows through:

- `src/milestones/milestone-rollup.ts:25-83` — `computeMilestoneRollups(milestones, openIssues, resolvedIssues)` buckets issues per milestone in one pass and already computes `open`, `resolved`, `total`, `percent` per milestone. Derivation is one extra line per rollup, e.g. `derivedStatus = total > 0 && open === 0 ? 'closed' : milestone.status`.
- All four rendering surfaces consume it through one wiring helper, so a change here propagates everywhere automatically:
  - `src/cli/commands/milestone.ts:22-32` — `loadMilestoneRollups`, shared by all surfaces.
  - `src/cli/commands/milestone.ts:121` — `list` marker: `r.status === 'closed' ? '✓' : '▸'`.
  - `src/cli/commands/milestone.ts:154,166` — `show` JSON `status` field and human `Status:` line (note: the human line reads `item.status` from the store directly, not the rollup, so `show` would need a second touch point).
  - `src/cli/commands/status.ts:5,62` and `src/cli/commands/progress.ts:9,110` — status/progress milestone sections reuse the same helper.
- Sort order already keys off status (`milestone-rollup.ts:77-80`); a derived value would slot in without structural change.

Implementation cost is genuinely small: ~10 lines in the rollup, one field rename (`status` → `derivedStatus` or a precedence rule), no store changes, no CLI verbs, no guard allow-list changes (`.claude/hooks/metta-guard-bash.mjs:60` stays as-is).

**Pros:** zero manual toil; dashboards can never drift from issue reality; no new mutating surface, so no new guard tier work; no state writes at all, trivially satisfying "no unvalidated state writes."

## 2. Zero-issue milestones and scope beyond issues (premature auto-close)

This is the approach's central semantic flaw, in two forms:

- **Zero attached issues.** `computeMilestoneRollups` documents and implements `Milestones with zero issues roll up 0/0/0 at 0%` (`milestone-rollup.ts:23`, `:74`). Under "all attached issues resolved ⇒ closed," the vacuous-truth reading auto-closes every freshly created milestone before any work is attached — a newly created milestone (`MilestonesStore.create` writes `status: open` by default, `milestones-store.ts:95-106`, schema default at `src/schemas/milestone-frontmatter.ts:26`) would render `✓` immediately. The only fix is a special case ("zero issues ⇒ open"), which then makes milestones whose scope is *not* issue-tracked permanently unclosable — the exact write-once dead-field bug this change exists to fix, reproduced under a different rule.
- **Scope beyond issues.** Issue attachment is a one-way optional pointer: `spec/issues/*.md` frontmatter carries `milestone: <slug>` (`src/schemas/issue-frontmatter.ts:12`, surfaced via `issues-store.ts:32,101` and settable on create/update at `issues-store.ts:153,189-208`). Nothing forces a milestone's full scope to be represented as issues — the milestone body is free-form prose that can name PRs, prerequisites, or non-issue work (the zeus report's `m6` lists a prose prerequisite). Auto-closing when the *issue subset* completes closes milestones whose real scope is unfinished. The intent already adjudicated this: "a milestone with all issues resolved is not auto-closed, because issue counts do not necessarily represent the milestone's full scope" (`intent.md:43`).
- **Non-monotonicity.** Derived status is not a state transition, it is a live function of the issue set: attaching a new open issue to a derived-closed milestone silently reopens it; resolving it re-closes it. There is no closure *event*, so nothing to auto-commit — the project treats git as the transaction log, and this approach records no transaction for the most meaningful lifecycle moment.

## 3. Inability to represent `abandoned`

Derivation has no input from which to infer abandonment. A milestone dropped with unresolved issues is indistinguishable from an active one — issue counts say "open" forever. The spec makes `abandoned` a hard requirement: the schema MUST model `open | closed | abandoned` (spec.md:5), with dedicated validation scenarios (spec.md:22-30), a `--abandoned` close flag (spec.md:60, 67-70), and renderer handling with a distinct third marker (spec.md:123-140). None of these are reachable without an explicit write path. A hybrid ("derive closed, persist abandoned") reintroduces the write path this approach exists to avoid — at which point you have built the explicit-verb approach anyway, plus derivation complexity on top.

## 4. Stale body text remains uneditable

The zeus report's second half — `m1`'s body still reading "In flight as PR #24", `m6` listing a satisfied prerequisite — is untouched by derivation. `MilestonesStore` still exposes only `create`/`list`/`show`/`exists` (`milestones-store.ts:80-143`); the only body-edit path remains hand-editing YAML frontmatter files, bypassing Zod validation and auto-commit, in direct violation of the "no unvalidated state writes" constraint the intent cites (`intent.md:11`). spec.md dedicates a full requirement to option-driven field editing including `--description`, `--name`, `--target`, `--clear-target`, and status reopening (spec.md:88-120); derivation addresses none of it.

## 5. The persisted `status` field becomes vestigial and conflicting

- Every milestone file on disk carries `status:` in validated frontmatter (`milestone-frontmatter.ts:26`, parsed at `milestones-store.ts:61`). If renderers switch to derived status, the persisted field is dead weight that *still validates and still disagrees* with what every command displays — `spec/milestones/m1.md` says `open` while `milestone list` shows `✓`. The system of record now lies in the opposite direction.
- **Precedence ambiguity is unavoidable.** Someone hand-edits `status: closed` (the current workaround) on a milestone with open issues: does persisted or derived win? Any answer creates a class of files whose displayed state cannot be explained by reading the file.
- **Removing the field is worse.** `MilestoneFrontmatterSchema` is `.strict()` (`milestone-frontmatter.ts:20-27`), so dropping `status` from the schema makes every existing file carrying `status: open`/`status: closed` fail validation on read — a breaking migration requiring a rewrite pass over `spec/milestones/`, contradicting the intent's "existing milestone files on disk — untouched by this change" stance (`intent.md:39`) and spec.md's back-compat scenario (spec.md:27-30).
- **Byte-compatibility breaks either way.** spec.md:125 requires that projects containing only `open`/`closed` milestones produce output "byte-identical to pre-change behavior" (scenario at spec.md:142-145). Flipping `m1` from `▸` to `✓` via derivation changes `list`, `show`, `status`, and `progress` output for existing data — the derived approach violates this requirement by design, since changing existing output *is* its mechanism.

## 6. Requirements coverage — quantified

spec.md contains six requirement blocks. Derived status satisfies **zero of six**:

| # | Requirement (spec.md line) | Derived-status outcome |
|---|---|---|
| 1 | Schema enum `open\|closed\|abandoned` + `close`/`update` CLI verbs (spec.md:3-5) | **Fails** — no `abandoned`, no verbs |
| 2 | `MilestonesStore.update(slug, patch)` validated write path (spec.md:33-35) | **Fails** — no store write path at all |
| 3 | `metta milestone close <slug>` with `--abandoned`, auto-commit, branch guard (spec.md:58-60) | **Fails** — verb explicitly not built |
| 4 | `metta milestone update <slug>` field editing (spec.md:88-90) | **Fails** — no editing surface |
| 5 | Renderers handle `abandoned`; open/closed output byte-identical (spec.md:123-125) | **Fails** — `abandoned` unrepresentable; byte-compat scenario (spec.md:142-145) actively violated |
| 6 | Guard allow-list for `milestone close`/`milestone update` (spec.md:148-150) | **Vacuous/fails** — verbs it must authorize don't exist |

It also contradicts the change's own scope decision (`intent.md:41-43`, Out of Scope item 1).

## 7. Recommendation

**Do not adopt derived status for this change.** It cannot satisfy any of the six spec.md requirements, cannot represent `abandoned`, leaves the body-editing half of the reported problem unsolved, breaks the byte-compatibility requirement, and converts the persisted `status` field from "dead" to "actively contradicted." The explicit lifecycle approach (store `update` + `close`/`update` verbs) that intent.md commits to is the correct fit.

**Salvageable follow-up:** the derivation *signal* — `total > 0 && open === 0 && status === 'open'` — is cheap to compute inside `computeMilestoneRollups` and would make a good advisory ("eligible for close") in `list`/`show`/`status`/`progress`. That is exactly the deferred candidate-3 warning noted in `intent.md:44`, and it pairs well with the explicit close verb rather than replacing it. Not part of this change.
