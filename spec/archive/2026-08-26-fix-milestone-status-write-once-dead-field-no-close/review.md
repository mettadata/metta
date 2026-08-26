# Review: fix-milestone-status-write-once-dead-field-no-close

Three parallel reviews (correctness, security, quality) over the full `main...HEAD` diff. **Overall: PASS_WITH_WARNINGS — no critical or blocking issues.**

## Correctness — PASS

Verified: validate-before-I/O ordering in `MilestonesStore.update` (byte-identical on failure is structural, pinned by byte-snapshot tests); clearTarget/target mutual exclusion enforced at both store and Commander levels; close conflict pre-check makes no store call and provably leaves the file untouched; empty-patch handling; `changed` field reporting per design; rank comparator provably identical to the legacy comparator for open/closed-only inputs (pinned in-test against a legacy reimplementation); reopen via `update --status open`; target calendar refinement (`2026-02-30` rejected naming the field); guard/mint/skill mirrors byte-identical with scope keys auto-derived.

Suggestions (informational, no action): `changed` reports patched fields rather than value-diffed fields (matches design §API); branch guard precedes the no-field-options check (matches `create` precedence).

## Security — PASS

- Slug injection: `assertSafeSlug` on every new path-constructing entry point; `SLUG_RE` excludes traversal characters.
- Exec safety: `commitMilestones` uses `execFile` argv arrays (no shell); slug only ever a `-m` value; `git add` path is a fixed literal.
- Guard trust model: strictly additive — `close`/`update` join the fail-closed Tier-2 blocked set; scopes minted only for `metta-backlog`; `list`/`show` verified pure reads; deployed/template hook copies sha256-identical.
- YAML: default `YAML.parse` (no code-executing tags) + strict Zod; `--name` values are escaped by `YAML.stringify`; frontmatter fence regex anchored, body `---` never re-interpreted.
- No unvalidated write paths.

Minor (pre-existing, inherited from `create`, not introduced here): `git commit -m` commits the whole index, so independently pre-staged files ride the auto-commit; close's show→update conflict check is TOCTOU-shaped (accepted in design for a single-user local CLI).

## Quality — PASS_WITH_WARNINGS

Verified: conventions (`.js` import extensions, naming, no inlined templates, functional core/imperative shell), 375 tests green across the five touched suites, mirror byte-identity independently confirmed, byte-compat pins at store/rollup/CLI levels, guard block/allow/scope-missing matrix with audit assertions.

Warning (should fix): spec scenario "Show reports the abandoned state accurately" had no direct CLI test — no assertion that `milestone show` on an abandoned milestone prints `Status: abandoned` / `"status": "abandoned"`. **Resolution: addressed in a follow-up commit adding the missing test (see git log).**

Suggestions (accepted as-is): color map duplicated across two render sites (design-documented decision); catch-block error mapping duplicated between close/update (repo per-action style); symmetric scope-missing guard test for `milestone:update`.

## Loop outcome

Iteration 1: PASS / PASS / PASS_WITH_WARNINGS — exit criteria met on first pass. The single test-coverage warning fixed post-review; no re-review required (additive test only, passthrough already verified correct by the correctness reviewer).
