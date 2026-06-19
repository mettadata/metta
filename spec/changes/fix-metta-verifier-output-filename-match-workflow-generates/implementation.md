# Implementation: Pin metta-verifier output filename to `summary.md`

**Change slug**: fix-metta-verifier-output-filename-match-workflow-generates
**Workflow tier**: quick
**Candidate solution**: #2 — pin the filename in the verifier persona

---

## Summary

The `metta-verifier` agent persona contained no instruction binding its output
filename. Because the persona describes its job as producing a "verification
summary" with artifact type `verification`, the agent drifted to writing
`verification.md`. Every workflow YAML, however, declares the verification
artifact as `generates: summary.md`, and `metta complete verification` validates
that exact filename on disk. The mismatch silently broke completion of quick (and
other) workflow changes.

The fix adds an explicit, non-negotiable filename binding to the verifier persona
so the agent always writes to the exact path the orchestrator provides — which the
active workflow declares as `summary.md` — and never substitutes a type-derived
name like `verification.md`.

## File changed

- `src/templates/agents/metta-verifier.md` — single bullet replaced in the
  `## Rules` section.

No other source files were touched. The CLI, workflow YAMLs, `metta complete`
validation logic, and skill templates are unchanged.

## Exact wording added

In the `## Rules` section, the previous bullet:

```
- When done, write the file to disk and return. The orchestrator commits after you return — do not run git.
```

was replaced with:

```
- When done, write the verification artifact to the EXACT path the orchestrator provides in the invocation payload — this is the filename the active workflow declares in its `generates` field (currently `summary.md`). Do NOT invent or use any other filename such as `verification.md`; the filename is a hard contract that `metta complete verification` enforces, and a mismatch fails completion. The orchestrator commits after you return — do not run git.
```

## Rationale

The `generates` field in each workflow YAML is the contract `metta complete`
enforces — it requires the verification artifact to exist on disk under that exact
name. Nothing in the verifier persona previously bound the agent to that filename,
so the agent's output name and the workflow contract could diverge with no error
until completion failed. Pinning the filename directly in the persona closes that
gap at the source: every workflow tier that invokes the verifier now inherits the
binding, and the agent is explicitly told that `verification.md` (its prior
default) is unacceptable.

This is the minimal, single-file fix (candidate #2). It deliberately avoids the
broader alternatives: relaxing `metta complete` to accept two filenames
(candidate #1) or plumbing the `generates` value through the instructions payload
with a CLI-level post-write assertion (candidate #3), both of which are out of
scope per the intent.

## Build verification

`npm run build` (which runs `tsc` followed by `copy-templates`) completed
successfully. Templates are copied to `dist/` at build time per project
convention.

Confirmed `dist/templates/agents/metta-verifier.md` reflects the new wording — the
updated bullet (containing "EXACT path", "hard contract", and the explicit
`verification.md` prohibition) is present in the built copy at line 62.

## Testing notes

This change edits only persona prose in a template file; it introduces no
TypeScript code path and therefore no new unit tests. The build is the relevant
verification step, and it confirms the template is syntactically intact and copied
to `dist/`.
