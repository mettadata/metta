# Implementation Summary: fix-metta-check-constitution-requires-direct-anthropic-api

## What changed

`metta check-constitution` no longer calls the Anthropic API — and with its only consumer gone, the entire provider abstraction and SDK dependency are deleted. Metta now has zero API-auth code paths, honoring the project's no-direct-API principle.

- **Two-mode command** (`src/constitution/checker.ts`, `src/cli/commands/check-constitution.ts`): emission mode (`metta check-constitution --change <name>`) emits the check contract — constitution articles, spec content, verdict schema, checker instructions, suggested verdict path — exit 0, credential-free. Recording mode (`--record <file>`) JSON-parses and `ViolationListSchema`-validates the verdict (typed `VerdictValidationError`, exit 4, nothing persisted on invalid input), then applies the preserved blocking/Complexity-Tracking semantics and writes `violations.md` with the original exit-code contract (0 clean / 4 blocking). Re-recording replaces the report (idempotent).
- **Checker instructions externalized** (`src/templates/artifacts/constitution-check-instructions.md`): the severity rubric and untrusted-data framing moved out of TypeScript into a build-copied template per the constitution's templates-as-external-files rule (constitution-check finding).
- **Provider layer deleted**: `src/providers/` (AIProvider, AnthropicProvider, ProviderRegistry, ProviderError), its tests, barrel exports, and the `@anthropic-ai/sdk` dependency (lockfile regenerated).
- **Skills rewritten** (template + deployed, byte-identical): `metta-check-constitution` drives emit → spawn Read-only `metta-constitution-checker` subagent → record; `metta-plan`'s step-4 gate updated to the same flow (planner-caught regression: the bare CLI call would have become an always-exit-0 no-op).
- **Constitution updated** (`spec/project.md`): "Anthropic SDK — AI provider integration" removed from Stack; an explicit AI-execution-model statement added (all AI work runs in the Claude Code session via skills/subagents). CLAUDE.md regenerated via refresh.

## Requirement coverage

All 7 requirements of the new `constitution-check` capability (first deliberate use of the `<!-- new-capability -->` marker): Contract Emission Without API Credentials, No Direct AI Provider Invocation, Verdict Schema Validation, Verdict Recording and Blocking-Violation Exit Semantics, Violations Report Format and Location Preserved, Skill-Driven Two-Step Check Flow, Idempotent Re-Check Replaces the Prior Verdict.

## Verification

Suite 1050/1050 (79 files) green after every batch; tsc/build clean. Live credential-free round trip (`env -u ANTHROPIC_API_KEY`): emission exit 0 with full contract; blocking verdict → exit 4 + BLOCKING in violations.md; clean re-record → exit 0, report replaced. `npm ls @anthropic-ai/sdk` empty; remaining case-insensitive "anthropic" hits in src/ are two benign prose/comment examples (workflow-primer research-discipline example, config-loader env-mapping comment).

## Commits

`370243cdd` (two-mode CLI + contract), `a509b73b4` + `983b6895a` (test rewrites), `466cc2450` (provider + SDK deletion), `ca156eb63` (skill rewrite), `eda598cf0` (metta-plan gate), `5531db473` (constitution + CLAUDE.md).

## Notes

- Issue resolved: metta-check-constitution-requires-a-direct-anthropic-api (major).
- Follow-up candidates: the stale external blog-URL comment in spec/project.md (pre-existing /metta-init artifact); consumer projects need `metta install` re-run to receive the rewritten skills.
