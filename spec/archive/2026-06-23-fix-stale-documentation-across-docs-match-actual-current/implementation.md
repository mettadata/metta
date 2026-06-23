# Implementation: fix-stale-documentation-across-docs-match-actual-current

A 4-auditor review found the hand-written docs (chiefly the pre-existing
`docs/workflows/` set) described an OLD state of the workflow engine. Corrected
all of it to match current code. 11 files changed.

## Root cause
The workflow YAMLs + finalizer changed but the docs were never updated: the four
"gates" `spec-quality`/`design-review`/`task-quality`/`uat` were removed (they
exist in **zero** source files), `build` was added to the implementation gate
arrays, the finalizer became **workflow-scoped** (not a registry sweep), a 4th
`trivial` workflow was added, and the commit model is orchestrator-owned for
planning/review/verification artifacts.

## Corrections applied (verified against source)

| Fact | Files fixed |
|------|-------------|
| Phantom gates removed (or labeled "not implemented") | gates.md, workflows.md, artifacts.md, walkthroughs.md, README.md, concepts.md |
| 4 workflows (added `trivial`), not 3 | workflows.md, README.md, concepts.md |
| Impl gates include `build` (full omits it) | gates.md, workflows.md, artifacts.md, concepts.md |
| `tests` `on_failure: stop` (not retry_once) | gates.md, concepts.md |
| finalize is workflow-scoped; verify is the registry sweep | gates.md |
| 11 agents incl. `metta-skill-host` (not 10) | agents.md, README.md |
| Commit model: only discovery + executor run git; orchestrator commits the rest incl. summary.md | agents.md, concepts.md, getting-started.md, walkthroughs.md |
| `metta abandon` → `metta changes abandon` | walkthroughs.md |
| `ChangeMetadata` 9 optional fields documented | state.md |
| `metta-product` tools = Read, Write, Bash | agents.md |
| Internals `../architecture.md` → `./architecture.md` (was linking the generated doc) | data-model.md, extending.md |
| Quick artifact tree: no `implementation.md`/`stories.md` (generates code) | getting-started.md |

The big rewrites (`gates.md`, `workflows.md`, `agents.md`) rebuilt their stage→gate
matrices and tables directly from `src/templates/workflows/*.yaml` and the agent files.

## Out of scope
- `docs/proposed/` (already flagged historical), `docs/research/` (dated notes), and the 4 generated docs (regenerate from specs).
- The spec-vs-code gap where `spec/specs/workflow-engine` etc. reference the phantom gates is a separate reconciliation concern.

## Verification
- Phantom gate names appear only in the explicit "not implemented" disclaimer in gates.md.
- Bare `metta abandon`: 0 occurrences.
- No stale "three workflows"/"ten personas" claims remain.
- All internal `.md` links across the hand-written docs resolve.
- All roster tool lists in agents.md re-checked against the live frontmatter.
