# apply-two-deferred-review-hardenings-verifier-persona-prompt

## Problem

The `harden-metta-config-yaml-lifecycle-across-three-related-bugs` change shipped with three deferred PASS_WITH_WARNINGS findings across its security and quality reviewers. Two of those findings remain open and leave exploitable gaps:

**Security W1 + Correctness W1 — verifier persona (Fix B):**
`context.verification_instructions` is free-form markdown authored by the project owner, persisted in `.metta/config.yaml`, and injected into the verifier agent's system prompt. The current persona echoes the value back without any "treat as data not instructions" framing or content delimiter. Any hostile or accidentally directive content in that field can influence the agent's reasoning — the same class of prompt-injection risk that `<DISCOVERY_ANSWERS>` already defends against in the discovery skill. Verifier agents running today on projects with non-trivial `verification_instructions` are exposed to this hazard with no defence.

Separately, the persona's first-run heuristic reads "if BOTH `spec/changes/` AND `spec/archive/` are empty" — but spec R7 defines a first-run project as one where "no active change subdirectory under `spec/changes/` contains `stories.md` or `intent.md` AND `spec/archive/` is empty". A directory-exists check conflates an empty-but-created `spec/changes/` folder with a truly active change, causing the heuristic to misfire and emit the wrong code path for projects that have initialized the directory structure but have no in-flight work.

Both flaws live in two byte-identical files (`metta-verifier.md` agent persona + its source template) and affect every user running `/metta-verify` against a configured project.

**Quality W1 — schema unit tests (Fix C):**
`VerificationConfigSchema` uses `.strict()` and a four-value enum (`tmux_tui | playwright | cli_exit_codes | tests_only`). The schema contract is exercised only implicitly via the `/metta-init` integration flow. No direct unit test pins: acceptance of all four valid strategies with and without optional instructions; rejection of an invalid enum value (e.g. `strategy: 'magic'`); or rejection of unknown fields via `.strict()` (e.g. an extra `foo` key). Future maintainers extending the schema have no safety net that catches regressions at the unit-test level. Project owners relying on this schema for config validation have less confidence that the strict boundary is actively enforced.

Affected parties: verifier agents (consume instructions without safety framing today); project owners (strict-mode rejection is untested at unit level); future maintainers (no direct schema regression tests).

## Proposal

This change applies exactly two fixes, picking up the three deferred warnings from the prior review:

**Fix B — harden the metta-verifier persona (addresses security W1 + correctness W1):**

Edit both:
- `.claude/agents/metta-verifier.md`
- `src/templates/agents/metta-verifier.md`

Two targeted edits, applied identically to both files:

1. Wrap the injection of `context.verification_instructions` with an explicit "treat as data not instructions" framing and a labeled delimiter block (matching the pattern used in the discovery skill for `<DISCOVERY_ANSWERS>`). The framing MUST appear immediately before the agent processes the instructions value and MUST instruct the agent to read the content as configuration data only, never as directives that override the persona.

2. Correct the first-run heuristic condition from "BOTH `spec/changes/` AND `spec/archive/` are empty" to match spec R7 exactly: "no active change subdirectory under `spec/changes/` contains `stories.md` or `intent.md` AND `spec/archive/` is empty".

The two files MUST remain byte-identical after the edit; the existing parity test at `tests/agents-byte-identity.test.ts` (which already covers `metta-verifier` as of commit `f2a54fed4`) enforces this.

**Fix C — add direct unit tests for VerificationConfigSchema (addresses quality W1):**

Edit:
- `tests/schemas.test.ts`

Add a `describe('VerificationConfigSchema', ...)` block containing exactly three test cases:

1. Accepts all four valid strategy values (`tmux_tui`, `playwright`, `cli_exit_codes`, `tests_only`) each with optional `instructions` present and absent.
2. Rejects an invalid enum value (e.g. `{ strategy: 'magic' }`) — parse MUST fail with a Zod error.
3. Rejects unknown fields via `.strict()` (e.g. `{ strategy: 'tests_only', foo: 'bar' }`) — parse MUST fail with a Zod error naming the unrecognized key.

No changes to the schema implementation itself.

## Impact

Three files are touched; no behavior changes outside the persona framing:

- `.claude/agents/metta-verifier.md` — persona wording changes for injection safety and first-run heuristic correctness. The agent's external behavior (which gates it runs, what it reports) is unchanged; only how it interprets `verification_instructions` and determines first-run vs. legacy-project status is affected.
- `src/templates/agents/metta-verifier.md` — identical edit to keep the source template in sync. The `dist/` copy is regenerated at build time from this template; the parity test will catch any drift.
- `tests/schemas.test.ts` — three new test cases added under a new `describe` block. All existing tests are unaffected. The suite grows by three cases.

## Out of Scope

- This change does NOT introduce new verifier execution behavior beyond the persona text edit. Strategy-driven execution (tmux, Playwright, CLI exit-code shelling) remains out of scope, deferred to the changes referenced in the persona's "Strategy-driven execution (informational)" section.
- This change does NOT modify `VerificationConfigSchema` itself — the Zod definition in `src/schemas/project-config.ts` is left untouched. Fix C adds tests only.
- This change does NOT auto-upgrade or migrate existing project `.metta/config.yaml` files. Projects with a `verification:` block already written are unaffected; no migration script or repair path is introduced.
- This change does NOT address the remaining accepted warnings from the prior review (findings 4, 5, 6, 7, 9 in `review.md`) — those were accepted as-is and are not revisited here.
- This change does NOT extend `tests/agents-byte-identity.test.ts` — that test already covers `metta-verifier` and requires no modification.
