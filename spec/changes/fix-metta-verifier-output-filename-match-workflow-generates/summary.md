# Verification Summary: Pin metta-verifier output filename to `summary.md`

**Change slug**: fix-metta-verifier-output-filename-match-workflow-generates
**Resolves**: spec/issues/metta-verifier-writes-verification-md-but-quick-workflow.md
**Workflow tier**: quick
**Verdict**: PASS

---

## Scope note

This change edits a single markdown persona template
(`src/templates/agents/metta-verifier.md`). No TypeScript source, no test files,
and no runtime logic changed. Per the verification plan, only the fast gates
(`npm run build` and `npx tsc --noEmit`) are in scope; the vitest suite is N/A
(see Gate Results).

## Verification strategy

No `verification:` block / strategy was supplied in the invocation context for
this run (this is a markdown-template-only change verified under an explicit
fast-gate plan). The standard project gates were run as directed below. No
`verification_instructions` were provided, so there is nothing to echo back.

## Checks

### Check 1 — Filename-binding rule present in source persona (Rules section)

**PASS**. `src/templates/agents/metta-verifier.md:62` (in the `## Rules` section,
lines 57-63) contains the binding instruction:

> When done, write the verification artifact to the EXACT path the orchestrator
> provides in the invocation payload — this is the filename the active workflow
> declares in its `generates` field (currently `summary.md`). Do NOT invent or
> use any other filename such as `verification.md`; the filename is a hard
> contract that `metta complete verification` enforces, and a mismatch fails
> completion. The orchestrator commits after you return — do not run git.

This satisfies the intent's three requirements: (1) states the artifact is
`summary.md` matching `generates: summary.md`, (2) directs the agent to use the
exact orchestrator-provided path, and (3) explicitly forbids the type-derived
`verification.md` default. Evidence: `src/templates/agents/metta-verifier.md:62`.

### Check 2 — `dist/` copy contains the same binding (build propagated it)

**PASS**. `dist/templates/agents/metta-verifier.md:62` is byte-identical to the
source line 62 (`diff` of line 62 reported no difference: "SOURCE/DIST LINE 62
IDENTICAL"). The `copy-templates` step propagated the updated persona to the
built output. Evidence: `dist/templates/agents/metta-verifier.md:62`.

### Check 3 — Build and typecheck gates pass

**PASS**. See Gate Results below. `npm run build` (tsc + copy-templates) and
`npx tsc --noEmit` both completed with exit code 0.

### Check 4 — Fix matches issue candidate #2 and intent scope

**PASS**. The implementation is exactly candidate solution #2 from the issue
("Pin the filename in the verifier persona") — a single-bullet edit to the
`## Rules` section of the verifier persona, with no change to the CLI, workflow
YAMLs, `metta complete` validation, or skill templates. The out-of-scope
alternatives (candidate #1: relax `metta complete`; candidate #3: plumb
`generates` through the payload with a post-write assertion) were correctly not
attempted. Supporting context: all four workflow YAMLs declare
`generates: summary.md` (quick.yaml:25, standard.yaml:65, full.yaml:81,
trivial.yaml:25), confirming `summary.md` is the contract the persona is now
bound to. Only the intended file was modified.

## Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Build | `npm run build` | PASS (exit 0; tsc + copy-templates completed) |
| Typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| Tests | `npm test` (vitest) | N/A — SKIPPED |
| Lint | `npm run lint` | N/A — not in scope for this change |

**Test suite N/A rationale**: This change modifies only persona prose in a
markdown template file. It introduces no TypeScript code path, no new behavior,
and no test-covered logic. Running the vitest suite would exercise unrelated
code and provide no signal on the correctness of a documentation-only edit. The
build (which confirms the template is syntactically intact and copied to `dist/`)
is the relevant verification step. Skipping the suite is a deliberate, scoped
decision — not an omission.

## Conclusion

**PASS**. All four checks succeed. The filename-binding rule is present in both
the source and built copies of the verifier persona, the build and typecheck
gates are green, and the fix faithfully implements issue candidate #2 within the
intent's declared scope with no out-of-scope changes.
