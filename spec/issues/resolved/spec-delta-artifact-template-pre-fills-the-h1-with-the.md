# Spec delta artifact template pre-fills the H1 with the change slug, causing a new junk capability folder to be minted per change (the capability-landfill mechanism)

**Captured**: 2026-07-13
**Status**: resolved
**Severity**: major

## Symptom
Every change that goes through the standard workflow mints a brand-new capability folder in `spec/specs/` at finalize unless the author hand-edits the spec delta's H1 — the capability-landfill mechanism. As of 2026-07-13, 14+ of the 39 folders in `spec/specs/` are one-shot fix debris with truncated or leaked slugs (e.g. `spec:-fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i`, `custom-claude-statusline-conte`, `t8-post-merge-gate-re-run-afte`), and these propagate into the CLAUDE.md capability table. Hit live on 2026-07-13: the spec for change `enforce-workflow-tier-routing-so-ceremony-actually-scales` failed `metta complete` with "MODIFIED targets unknown capability" until the H1 was hand-edited to `adaptive-workflow-tier-selection`.

## Root Cause Analysis
The spec merger resolves the target capability solely from the delta spec's H1 title: `complete.ts` slugifies `deltaSpec.title` (after stripping a `(Delta)` suffix) and treats the result as the capability directory to merge into. Meanwhile, the instruction flow that serves the spec artifact template (`metta instructions spec`) renders `src/templates/artifacts/spec.md`, whose H1 is `# {capability_name}` — and `InstructionGenerator.generate` populates `capability_name` with `params.changeName`. So the template arrives pre-filled with the change slug as the H1. Unless the authoring agent manually replaces that H1 with an existing capability name, the merge target is the change name itself, and finalize creates a new capability folder per change. The H1 is thus overloaded: it is both a human-readable title and the machine-read merge target, with the default value guaranteed to be wrong for any change touching an existing capability. The failure is asymmetric: ADDED-only deltas silently create landfill folders, while MODIFIED/REMOVED/RENAMED deltas hard-fail at `metta complete` because the derived capability does not exist.

### Evidence
- `src/context/instruction-generator.ts:70` — `capability_name: params.changeName` pre-fills the template placeholder with the change slug, seeding the wrong merge target by default.
- `src/templates/artifacts/spec.md:1` — the template H1 is `# {capability_name}`, so the substituted change slug becomes the delta spec title verbatim.
- `src/cli/commands/complete.ts:162` — `toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))` derives the target capability from that H1, so an unedited title mints a new `spec/specs/<change-slug>/` folder at finalize (or hard-fails for MODIFIED/REMOVED/RENAMED deltas).

## Candidate Solutions
1. **Explicit `capability:` field in the delta spec** — extend the delta spec format (and `parseDeltaSpec`) with a dedicated `capability:` line or frontmatter key naming the merge target, keeping the H1 purely descriptive. The merger reads the field; the H1 fallback remains only for backward compatibility with archived changes. Tradeoff: format change ripples through the parser, template, authoring skill instructions, and existing archived deltas, and two sources of truth exist during the transition.
2. **Make the instructions flow ask for the target capability** — when `metta instructions spec` runs, list existing capabilities from `spec/specs/` and require the orchestrator/author to pick one (or explicitly opt into a net-new capability), then render the template with the chosen name instead of `params.changeName`. Tradeoff: adds an interactive step or extra CLI parameter to every standard-workflow change, and does not protect authors who bypass the instructions flow.
3. **Guard at `metta complete`** — when the derived capability slug equals the change name and no such capability exists, refuse (or prompt) with a suggestion listing near-match existing capabilities, forcing an explicit decision before a new folder is minted. Tradeoff: catches the error late (after the spec is authored), adds friction to genuinely net-new capabilities, and heuristic matching on slugs can misfire.

## Resolution

**Resolved**: 2026-08-08 (stale-issue sweep)

Fixed by capability targeting: spec.md template H1 is {capability_name} naming an existing merge target, with explicit new-capability marker required for net-new capabilities.
