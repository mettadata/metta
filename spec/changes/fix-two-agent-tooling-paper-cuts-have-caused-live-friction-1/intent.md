# fix-two-agent-tooling-paper-cuts-have-caused-live-friction-1

## Problem

Two agent-tooling paper cuts have caused repeated live friction in real change sessions:

**1. metta-specifier cannot write the files it exists to produce.** The specifier persona describes an agent that "writes precise, testable specification deltas", yet its frontmatter grants only `tools: [Read, Grep, Glob]` (both `src/templates/agents/metta-specifier.md` and the deployed `.claude/agents/metta-specifier.md`, line 4). The persona body even codifies the limitation: "You return drafted spec text for the orchestrator to persist — your tool set is read/analysis only." On both of its real assignments to date (2026-07-17: the orchestration-guard delta spec and the instruction-contracts delta spec), the specifier had to dump full spec content into its final message and rely on the orchestrator to transcribe it to disk. That round-trip wastes orchestrator context, risks transcription drift, and diverges from its spec-writing peer: metta-proposer is granted `tools: [Read, Write, Grep, Glob, Bash]` (`.claude/agents/metta-proposer.md`, line 4) and writes its own artifacts directly. Spec-writing peers should have write parity.

**2. metta-verifier's Write tool refuses the workflow-mandated verification artifact.** Three times across 2026-07-17/18, verifier subagents reported that attempts to `Write` their required verification artifact (`summary.md` under `spec/changes/<change>/`) were refused under a "do not write report/summary/findings/analysis .md files" policy, and the agents fell back to shell heredocs (`cat <<'EOF' > summary.md`) via Bash to satisfy the workflow contract. Inspection of `.claude/agents/metta-verifier.md` (byte-identical to `src/templates/agents/metta-verifier.md`) shows the offending prohibition is **not** authored in the agent file itself — it comes from the harness-level subagent system prompt, which forbids writing report-style .md files because "the parent agent reads your text output, not files you create." The verifier persona's Rules section (line 62) already *mandates* writing the artifact ("write the verification artifact to the EXACT path the orchestrator provides … the filename the active workflow declares in its `generates` field (currently `summary.md`)"), but it never states that this artifact is exempt from the report-file prohibition. With two conflicting instructions and no explicit precedence, the harness-level prohibition wins at Write-time and the persona mandate loses — hence the heredoc workaround, which bypasses whatever safety the Write path provides.

## Proposal

**Fix 1 — grant Write to metta-specifier (frontmatter + persona text).**

- In `src/templates/agents/metta-specifier.md`, change line 4 from `tools: [Read, Grep, Glob]` to `tools: [Read, Write, Grep, Glob]`, matching metta-proposer's Write grant (the parity target for spec-writing peers).
- Update the persona body to remove the now-false sentence "You return drafted spec text for the orchestrator to persist — your tool set is read/analysis only." and replace it with an instruction to write the delta spec file to the path the orchestrator provides, mirroring metta-proposer's "write the file to disk and return; the orchestrator commits after you return — do not run git" rule.
- Apply the identical edit to the deployed copy `.claude/agents/metta-specifier.md` so the two files remain byte-identical (enforced by `tests/template-deploy-sync.test.ts`).
- No agent-registry code changes are needed: `src/agents/agent-registry.ts` sources `tools` from frontmatter, so the instruction-contract payload (`metta instructions … --json`) picks up the new grant automatically.

**Fix 2 — add an explicit exemption line to metta-verifier for the workflow-declared verification artifact.**

- In `src/templates/agents/metta-verifier.md` (and the byte-identical `.claude/agents/metta-verifier.md`), amend the Rules section so the artifact-writing rule explicitly permits — and requires — using the Write tool for the workflow's declared verification artifact, overriding any report-file prohibition for that one path. Concretely, extend the existing artifact rule (currently line 62) with language along the lines of: "This artifact is a required workflow deliverable, NOT a scratch report — any general prohibition on writing report/summary/findings .md files does NOT apply to the `generates:` artifact at the orchestrator-provided path in `spec/changes/<change>/` (e.g. `summary.md`, or `verification.md` if a workflow declares it). You MUST write it with the Write tool; do not fall back to shell heredocs." The final wording is settled at spec/implementation time, but it MUST (a) name the Write tool, (b) scope the exemption to the workflow-declared `generates:` filename at the orchestrator-provided path, and (c) preserve the intent of the general prohibition for everything else (no ad-hoc scratch reports elsewhere).
- Both copies stay byte-identical.

**Tests.**

- Extend the frontmatter-sourcing cases in `tests/agent-registry.test.ts` (alongside the existing "sources tools from frontmatter … proposer has Write and Bash" case at line 34) with an assertion that the specifier's tools include `Write`.
- Update `tests/instructions-agent-registry.test.ts` line 200, which currently asserts `payload.agent.tools).toEqual(['Read', 'Grep', 'Glob'])` for the specifier end-to-end resolution — it must now expect `['Read', 'Write', 'Grep', 'Glob']`.
- For the verifier prose rule, rely on the existing comprehensive byte-identity suite (`tests/template-deploy-sync.test.ts`) plus a new content assertion in `tests/agents-byte-identity.test.ts` (the file that retains agent-specific content validation) that greps the verifier agent file for the explicit Write-permission/exemption line.

## Impact

- **`src/templates/agents/metta-specifier.md` + `.claude/agents/metta-specifier.md`** — frontmatter `tools:` gains `Write`; persona body updated to instruct direct file writing instead of returning text for the orchestrator to persist.
- **`src/templates/agents/metta-verifier.md` + `.claude/agents/metta-verifier.md`** — Rules section gains an explicit exemption requiring Write for the workflow-declared verification artifact.
- **Instruction contracts** — every workflow step that assigns the `specifier` agent (e.g. the spec step in the standard workflow) will now emit `Write` in its `agent.tools` payload automatically via the frontmatter-sourced agent registry; orchestrators spawning the specifier will grant it Write.
- **Verification steps** — verifiers stop hitting Write refusals on `summary.md` and stop falling back to Bash heredocs; the artifact path/filename contract enforced by `metta complete verification` is unchanged.
- **Tests** — `tests/agent-registry.test.ts`, `tests/instructions-agent-registry.test.ts` (one assertion updated, or the change fails CI), and `tests/agents-byte-identity.test.ts` extended; `tests/template-deploy-sync.test.ts` continues to enforce byte-identity with no modification.
- **No behavior change** for any other agent, workflow, or CLI command.

## Out of Scope

- **Other agents' tool grants** — no changes to metta-proposer, metta-executor, metta-researcher, metta-product, or any other agent's `tools:` frontmatter.
- **Bash for the specifier** — metta-proposer also holds `Bash`; the specifier has demonstrated no need for it, so parity here covers `Write` only.
- **Workflow YAML changes** — no edits to workflow definitions, `generates:` fields, or step/agent assignments; `summary.md` remains the declared verification artifact.
- **Agent-registry code changes** — `src/agents/agent-registry.ts` already sources tools from frontmatter; no TypeScript changes.
- **Harness-level policy changes** — we do not (and cannot from this repo) modify the Claude Code subagent system prompt that carries the report-file prohibition; the fix is an explicit persona-level exemption, which is the supported override channel.
- **Retroactive fixes** — no re-verification of the three affected 2026-07-17/18 sessions; their heredoc-written artifacts stand.
- **Skill or gate changes** — no edits to `/metta-verify` or other skill files, and no new gates.
