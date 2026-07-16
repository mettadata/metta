# fix-metta-check-constitution-requires-direct-anthropic-api

## Problem

`metta check-constitution --change <name> --json` unconditionally instantiates `AnthropicProvider` (`src/cli/commands/check-constitution.ts:96`) and calls `provider.generateObject(...)` (`src/constitution/checker.ts:97`), which requires `ANTHROPIC_API_KEY` to be set. On this project — and on any project following the same directive — that variable is never set, because the project's design principle (user directive, 2026-07-14) is that all AI-driven work runs inside the Claude Code session via skills and subagents, never via direct provider API calls. Every time `check-constitution` runs without the key, the Anthropic SDK throws "Could not resolve authentication method. Expected either apiKey or authToken," the command's catch-all maps that to exit 4, and the constitution gate is unusable through its intended CLI/skill path.

This was hit live on 2026-07-13: the session had to work around the failure by spawning the `metta-constitution-checker` subagent directly with Read-only tools, which produced a correct violations verdict — proving the instruction-mode path already works and that the direct-API path is both broken by design and unnecessary.

`check-constitution` is the last lifecycle command still built on the direct-API execution model. Every other AI-driven step (propose, plan, execute, verify) already runs in instruction mode — the CLI emits a contract, a skill spawns a subagent inside the session, and a follow-up CLI call records the result. `check-constitution` predates that pattern and never migrated, which is why the `AIProvider` abstraction (`src/providers/`) and the `@anthropic-ai/sdk` dependency are still present in the codebase with `checker.ts`'s `generateObject` call as their sole production consumer.

Affected: any developer or AI orchestrator invoking `/metta-check-constitution` or the underlying CLI command without an `ANTHROPIC_API_KEY` set — which, per project directive, is the normal and expected state for this project and any project adopting the same no-direct-API-calls principle.

## Proposal

Rework `metta check-constitution` from a direct-API call into a two-step instruction-mode flow, matching the pattern used by the rest of the lifecycle, and delete the now-unused provider abstraction.

1. **CLI: emit-contract step.** `metta check-constitution --change <name> --json` (with no recorded verdict yet) stops calling `AnthropicProvider`/`generateObject`. Instead it resolves and emits the check contract: the constitution articles parsed from `spec/project.md` (Conventions + Off-Limits, via the existing `parseConstitution`/`constitution-parser.ts` logic), the change's `spec.md` path and content, and the expected violations JSON shape (`{"violations": [...]}` per `ViolationListSchema`). This reuses `checker.ts`'s existing prompt-building logic (`buildUserPrompt`, `formatArticles`, `SYSTEM_PROMPT`) reframed as the contract the subagent must fulfill, not a prompt sent to a hosted model.

2. **Skill: subagent step.** The `metta-check-constitution` skill (template at `src/templates/skills/metta-check-constitution/`, deployed at `.claude/skills/metta-check-constitution/`, kept byte-identical) is updated to run the emit-contract CLI call, then spawn the existing `metta-constitution-checker` subagent (Read-only tools, `.claude/agents/metta-constitution-checker.md`) with the constitution and spec content, capturing its `{"violations": [...]}` output.

3. **CLI: record-verdict step.** A second CLI invocation (e.g. `metta check-constitution --record <verdict-file>` or via stdin) takes the subagent's verdict, validates it against `ViolationListSchema` (Zod), and runs the existing post-processing unchanged: `parseComplexityTracking` justification lookup, `isBlockingViolation` classification, `renderViolationsMd` rendering, and the `violations.md` write. Exit-code contract is preserved exactly: `0` when no blocking violations, `4` when blocking violations are present (or on error).

4. **Delete the provider abstraction.** Remove `src/providers/` in full (`provider.ts` — `AIProvider`, `ProviderError`, `ProviderRegistry` — and `anthropic-provider.ts`), their barrel exports in `src/index.ts`, and their tests (`tests/provider.test.ts`). Rework `src/constitution/checker.ts` to drop the `CheckerOptions.provider` field and the `generateObject` call, keeping/repurposing its prompt-building and post-processing functions as the instruction-contract emitter and verdict-recorder respectively. Update `tests/constitution-checker.test.ts` accordingly.

5. **Remove the SDK dependency.** After confirming zero remaining importers of `@anthropic-ai/sdk`, remove it from `package.json` dependencies and run `npm install` to update `package-lock.json`.

6. **Update the constitution and generated docs.** Update `spec/project.md`'s Stack section to remove "Anthropic SDK — AI provider integration" and reflect the instruction-mode reality (all AI-driven work runs inside the Claude Code session via skills and subagents; no direct provider API usage anywhere in the codebase). Regenerate `CLAUDE.md` from the updated constitution.

## Impact

- `src/cli/commands/check-constitution.ts` — command behavior changes from single-shot direct-API call to a two-invocation instruction-mode flow (contract emission, then verdict recording); flags/output shape change to support the two steps while preserving the `0`/`4` exit-code contract and the `violations.md` write location and format.
- `src/constitution/checker.ts` — `checkConstitution` no longer takes an `AIProvider`; its responsibilities split into contract-building and verdict-processing.
- `src/providers/*` and `tests/provider.test.ts` — deleted entirely; no other production code currently depends on this abstraction.
- `src/index.ts` — barrel exports for the provider module removed.
- `package.json` / `package-lock.json` — `@anthropic-ai/sdk` dependency removed.
- `.claude/skills/metta-check-constitution/SKILL.md` and `src/templates/skills/metta-check-constitution/SKILL.md` — rewritten to drive the new two-step flow; both copies must stay byte-identical per repo convention.
- `spec/project.md` (Stack section) and generated `CLAUDE.md` — updated to remove the Anthropic SDK reference and state the instruction-mode-only principle explicitly.
- `.claude/agents/metta-constitution-checker.md` and `src/templates/agents/metta-constitution-checker.md` — no functional change expected; their existing input/output contract (`<CONSTITUTION>`/`<SPEC>` tags in, `{"violations": [...]}` out) already matches what the reworked flow needs, since it was validated live on 2026-07-13.
- Any downstream consumer of `metta check-constitution --json` output (verify/gate tooling, other skills) must be checked for reliance on the old single-invocation shape.
- Demo project copies (`demos/trello-clone/.claude/skills/metta-check-constitution`, `demos/trello-clone/.claude/agents/metta-constitution-checker.md`) are out of scope for this change (see Out of Scope) but will drift until separately refreshed.

## Out of Scope

- Migrating any other command to instruction mode — this change is scoped to `check-constitution` only, since it is the only remaining direct-API lifecycle step.
- Building a general-purpose "contract emit / verdict record" framework for reuse by future commands — implement the minimum needed for `check-constitution`; generalize later if a second consumer emerges.
- Changing the constitution-check verdict schema, severity rules, or blocking-violation logic (`isBlockingViolation`, justification-via-Complexity-Tracking) — these are preserved as-is.
- Changing the `metta-constitution-checker` subagent's input/output contract — it already matches what is needed; only its invocation path changes (spawned by the skill instead of ad hoc).
- Updating the demo project's copies (`demos/trello-clone/...`) of the skill/agent files — tracked separately if needed.
- Re-adding any form of direct hosted-model API call as a fallback path (e.g. "use API key if set, else instruction mode") — the user directive is no API call usage anywhere, with no conditional exception.
- Introducing new CLI flags/commands beyond what's needed for the two-step contract/record flow (e.g. no general verdict-import command for other artifact types).
