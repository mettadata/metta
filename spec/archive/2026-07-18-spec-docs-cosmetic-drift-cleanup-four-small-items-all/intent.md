# spec-docs-cosmetic-drift-cleanup-four-small-items-all

## Problem

Four small, unrelated cosmetic drifts have accumulated in the spec store. None of them affect behavior, but each one misleads readers (human or AI) who treat the specs as ground truth:

1. **workflow-engine spec §7.2 understates the `standard` workflow.** `spec/specs/workflow-engine/spec.md` §7.2 ("Bundled Workflows") says the sentence "Three built-in workflows are shipped with metta" — this is currently **accurate again** (`src/templates/workflows/` contains exactly `quick.yaml`, `standard.yaml`, `full.yaml`), so the workflow count is *not* in scope. The genuine drift is in the `standard` entry (line 194): the heading reads "#### `standard` (7 artifacts)" and the pipeline diagram (line 199) reads `intent → spec → research → design → tasks → implementation → verification`. Ground truth in `src/templates/workflows/standard.yaml` is **8 artifacts**: `intent`, `stories`, `spec`, `research`, `design`, `tasks`, `implementation`, `verification`. Both the count and the diagram omit the `stories` artifact (added by the user-story layer work). The `quick` (3 artifacts) and `full` (10 artifacts) entries were verified against their YAML files and are correct.

2. **Eight renamed capability folders kept their pre-rename H1 titles.** During the 2026-07-16 spec-store reset, capability folders were renamed to clean capability names, but the H1 inside each `spec.md` still carries the old change-derived slug. Verified folder-name → current-H1 pairs (all eight folders exist under `spec/specs/`):
   - `gate-runner/` → `# fix-gate-infrastructure-bundle`
   - `claude-statusline/` → `# custom-claude-statusline-conte`
   - `fix-issues-command/` → `# spec:-metta-fix-issues-cli-command-m`
   - `issue-logging/` → `# upgrade-metta-issue-skill-run-short-debugging-session-before`
   - `propose-stop-after/` → `# fix-metta-propose-has-no-flag-stop-after-planning-artifacts`
   - `config-writer/` → `# harden-metta-config-yaml-lifecycle-across-three-related-bugs`
   - `user-stories/` → `# user-story-layer-for-spec-format-(t5)`
   - `install-init/` → `# split-metta-install-metta-init`

   A reader opening any of these files sees a title that no longer matches the capability it describes.

3. **Stale init-era `source:` comments in `spec/project.md`.** Three decorative HTML comments left over from an early `/metta-init` run remain in the constitution: `<!-- source: https://dev.to/chengyixu/the-complete-guide-to-building-developer-cli-tools-in-2026-a96 -->` (line 20, after the Stack section) and the sibling pair `<!-- source: https://github.com/google/gts -->` / `<!-- source: https://typescript-eslint.io/getting-started/ -->` (lines 35–36, after the Conventions section). They are scaffolding citations, not project decisions, and gts / the cited blog post do not describe this project's actual tooling.

4. **instruction-contracts byte-identity requirement doesn't name the canonical side.** In `spec/specs/instruction-contracts/spec.md`, the requirement **"Source And Deployed Agent Definitions Remain Byte-Identical"** (line 120) mandates that the source template copy and deployed copy of each agent definition stay byte-identical, but never states which copy is authoritative. Without that sentence, a reader resolving a divergence has no guidance on which direction to reconcile.

## Proposal

Make four documentation-only edits:

1. **workflow-engine §7.2 `standard` entry:** change the heading from "#### `standard` (7 artifacts)" to "#### `standard` (8 artifacts)" and update the pipeline diagram to `intent → stories → spec → research → design → tasks → implementation → verification` (matching the dependency order in `standard.yaml`, where `stories` requires `intent` and `spec` requires `stories`). Leave the "Three built-in workflows" sentence and the `quick`/`full` entries untouched — they are accurate.

2. **H1 retitle in eight spec files:** for each folder-name → H1 pair listed above, replace the stale H1 with the folder name (e.g. `spec/specs/gate-runner/spec.md` opens with `# gate-runner`). No other content in those files changes. `instruction-contracts/spec.md` already has a matching H1 (`# instruction-contracts`) and needs no retitle.

3. **Remove the three `<!-- source: ... -->` comments** from `spec/project.md` (lines 20, 35, 36), collapsing any doubled blank lines left behind.

4. **Add one clarifying sentence** to the "Source And Deployed Agent Definitions Remain Byte-Identical" requirement body in `spec/specs/instruction-contracts/spec.md`, stating that metta's shipped templates directory is the canonical generation-time source for agent identity, and that byte-identity with the project's deployed `.claude/agents/` copies is the invariant that keeps the two equivalent. No scenario changes; the existing two scenarios already cover the invariant.

## Impact

- **No code changes.** All edits are markdown inside `spec/`.
- Items 1, 2, and 4 are direct edits to living capability specs — the sanctioned pattern for cosmetic and legacy-format corrections that carry no semantic requirement change.
- Item 3 edits the constitution (`spec/project.md`) but removes only inert HTML comments; no principle, convention, or constraint changes.
- **CLAUDE.md's Active Specs table is unaffected by the H1 changes.** Verified in `src/cli/commands/refresh.ts` (`scanSpecs`, line 223): the table's Capability column comes from `entry.name` — the folder name under `spec/specs/` — not from the spec's H1. (The table currently shown in CLAUDE.md still lists pre-rename names because it was last regenerated before the 2026-07-16 folder rename; it will pick up folder names on the next regeneration, which is independent of this change.)
- Requirement counts per spec are unchanged, so the table's numbers do not move.
- Risk is minimal: no behavior, schema, template, or test is touched.

## Out of Scope

- Renaming any spec folder (folder names are already correct; only H1s move).
- Any semantic change to any requirement or scenario — including in instruction-contracts, where the added sentence clarifies an existing invariant without altering its normative force.
- Any code, template (`src/templates/`), or test changes — including `standard.yaml` itself, which is ground truth and stays as-is.
- Regenerating CLAUDE.md or `docs/` beyond what finalize does automatically.
- Fixing the stale pre-rename names currently visible in CLAUDE.md's Active Specs table (self-corrects on next regeneration).
- Auditing other spec folders for H1 drift beyond the eight listed.
