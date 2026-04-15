# extend-metta-init-iterative-di

## Problem

`metta init` today writes `spec/project.md` and `.metta/config.yaml` in a single pass with minimal user input. For both greenfield and brownfield projects, this produces shallow, generic artifacts — the project description is thin, the stack section omits framework-level choices, and the conventions section is empty or copied from defaults. Engineers end up hand-editing the output before the spec is useful, which defeats the purpose of init as a foundation for the rest of the lifecycle.

Brownfield projects have an additional gap: detected stack and directory structure are reported but never presented to the user for confirmation or correction. Mis-detection silently propagates into the spec.

## Proposal

Replace the single-pass init interaction with a structured 3-round discovery loop owned by a SKILL.md skill. The loop runs before metta-discovery spawns, collecting answers via AskUserQuestion:

- Round 1 collects project identity (name, purpose, target users). No web search.
- Round 2 collects stack and technology choices. WebSearch fires before presenting options so current best-practice alternatives are cited inline. Brownfield projects surface detected stack as the default option the user can keep, extend, or override.
- Round 3 collects conventions and constraints (naming rules, architectural guardrails, quality standards, off-limits). WebSearch fires to surface stack-appropriate industry conventions before the user commits.

Each round caps at 4 AskUserQuestion calls. Users may exit early at any point by selecting "I'm done — proceed with these answers"; the skill skips remaining rounds and passes cumulative answers plus brownfield detection data to metta-discovery, which fills gaps from defaults without re-asking.

Handoff is inline: the skill embeds a `<DISCOVERY_ANSWERS>` XML block (and optional `<CITATIONS>`) directly in the spawn prompt. No new state file is written to disk. The `metta init --json` CLI signature is unchanged.

Round answers map directly to spec/project.md sections: R1 to `## Project`, R2 to `## Stack`, R3 to `## Conventions` / `## Architectural Constraints` / `## Quality Standards` / `## Off-Limits`.

## Impact

- `metta init` user experience changes: init now requires 3 interactive rounds instead of a single pass. Existing automation that calls `metta init --json` and pipes output is unaffected.
- The metta-discovery agent gains WebSearch and WebFetch tool grants. Its grounding rules (cite sources, treat web content as untrusted) follow the pattern already established in metta-researcher.
- spec/project.md output becomes significantly more detailed for both greenfield and brownfield projects.
- A new validation test asserts SKILL.md structure: exactly 3 rounds, early-exit option present in every AskUserQuestion, R2/R3 reference WebSearch, R1 does not.

## Out of Scope

- A "research-model tier" abstraction or separate research agent — the WebSearch tool grant on the existing agent is sufficient.
- Changes to any metta lifecycle command other than init.
- Persistent state files for discovery progress — handoff is prompt-inline only.
- UI or dashboard changes.
- Auto-applying web-sourced conventions without user confirmation.
