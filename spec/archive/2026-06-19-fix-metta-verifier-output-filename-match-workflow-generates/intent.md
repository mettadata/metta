# Intent: Fix metta-verifier output filename to match workflow `generates` declaration

**Change slug**: fix-metta-verifier-output-filename-match-workflow-generates
**Resolves**: spec/issues/metta-verifier-writes-verification-md-but-quick-workflow.md
**Workflow tier**: quick

---

## Problem

The metta-verifier agent persona never pins an output filename. It describes itself as producing a "verification summary" with artifact type `verification`, so when the orchestration prompt is paraphrased or the persona authors freeform output, the agent gravitates to writing `verification.md`.

Every workflow YAML declares the verification artifact with `generates: summary.md` — this is the exact filename `metta complete verification` validates on disk:

- `src/templates/workflows/quick.yaml:25`
- `src/templates/workflows/standard.yaml:65`
- `src/templates/workflows/full.yaml:81`
- `src/templates/workflows/trivial.yaml:25`

When the verifier writes `verification.md` instead of `summary.md`, `metta complete verification` fails with "Artifact file 'summary.md' not found". The verification content is correct; only the filename mismatches. The `generates` field is the contract `metta complete` enforces, and nothing in the verifier persona binds the agent to that exact filename, so the two can diverge silently until completion fails.

This was observed during the `exclude-vendored-referrences` quick-workflow change and was unblocked by manually renaming `verification.md` to `summary.md`. The underlying mismatch remains unfixed.

## Proposal

Edit `src/templates/agents/metta-verifier.md` to add an explicit, non-negotiable instruction that the verification artifact MUST be written to the exact filename the orchestrator provides — currently `summary.md` in every active workflow — and that the agent MUST NEVER invent or default to `verification.md` or any other filename.

This is candidate solution #2 from the issue: "Pin the filename in the verifier persona."

Specifically:

1. In the metta-verifier persona, add a binding instruction that makes the output path explicit. The instruction MUST state that the artifact file is `summary.md` (matching `generates: summary.md` in all workflow YAMLs) and that no other filename is acceptable.
2. The persona MUST direct the agent to use the exact path and filename provided by the orchestrator in the invocation prompt, without substituting a type-derived name like `verification.md`.
3. No other files are changed. The CLI, workflow YAMLs, `metta complete`, and skill templates are untouched.

Template files are copied to `dist/` at build time per project convention, so editing the source template is sufficient — no additional build step is required beyond the normal build.

## Impact

- **metta-verifier.md** — one agent persona template receives an added filename-binding instruction. This reduces the probability of filename drift for every workflow tier that invokes the verifier.
- **No CLI behavior change** — `metta complete` validation logic is unchanged; it continues to require `summary.md`.
- **No workflow YAML change** — all four workflow files remain as-is; their `generates: summary.md` declaration is already correct.
- **Build output** — `dist/templates/agents/metta-verifier.md` will reflect the updated persona at next build; no runtime code path changes.
- **All existing changes in flight** — unaffected. The persona change only governs future verifier invocations.

## Out of Scope

- **Candidate #1 — make `metta complete` accept either filename**: tolerating `verification.md` as a fallback in the completion validator is explicitly excluded. It would leave two valid filenames in the system permanently and push the inconsistency downstream to skills, the ship merge, and any tooling that reads `summary.md` by name.
- **Candidate #3 — plumb the `generates` value through the instructions payload with a post-write assertion**: passing the workflow artifact name into the verifier invocation context and adding a CLI-level filename assertion is excluded from this change. That is a larger, multi-component change (skill template edit + CLI change + schema consideration) and is tracked separately if persona pinning alone proves insufficient.
- **Changing workflow YAML `generates` values**: the declared filename `summary.md` is correct and intentional; it is not changed.
- **Retroactive renaming of archived artifacts**: the archived `exclude-vendored-referrences` change already has `summary.md` from the manual workaround; no backfill is needed.
- **Adding automated filename assertion tests**: out of scope for this minimal fix; can be addressed under candidate #3 if recurrence is observed.
