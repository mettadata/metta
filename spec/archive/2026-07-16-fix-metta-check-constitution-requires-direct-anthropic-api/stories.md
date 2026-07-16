# fix-metta-check-constitution-requires-direct-anthropic-api — User Stories

## US-1: Constitution check runs without any API key

**As a** developer or AI orchestrator running the constitution gate on a project that forbids direct provider API calls
**I want to** run `metta check-constitution --change <name> --json` with no `ANTHROPIC_API_KEY` set and receive the check contract instead of an authentication error
**So that** the constitution gate is usable through its intended CLI/skill path in the normal, expected environment where no hosted-model credentials exist
**Priority:** P1
**Independent Test Criteria:** In a shell with `ANTHROPIC_API_KEY` unset, `metta check-constitution --change <name> --json` exits 0 and emits the check contract JSON (constitution articles, change spec path/content, expected `{"violations": [...]}` verdict shape) with no "Could not resolve authentication method" error.

**Acceptance Criteria:**
- **Given** a change with a `spec.md` and no recorded verdict, and `ANTHROPIC_API_KEY` unset in the environment **When** `metta check-constitution --change <name> --json` is invoked **Then** the command emits a contract containing the constitution articles parsed from `spec/project.md` (Conventions + Off-Limits), the change's spec path and content, and the expected verdict JSON shape, and exits 0.
- **Given** the same invocation **When** the contract is emitted **Then** no network call to any hosted model provider is attempted and no SDK authentication error appears in output.
- **Given** a change name that does not exist **When** the command is invoked **Then** it fails with a clear error rather than an authentication error, preserving the existing error exit behavior.

---

## US-2: Recording a verdict preserves the gate's exit-code and output contract

**As a** developer or AI orchestrator completing the constitution check
**I want to** feed a subagent-produced `{"violations": [...]}` verdict back through a second `metta check-constitution` invocation that validates it and writes `violations.md`
**So that** downstream gate tooling keeps working unchanged — blocking violations still fail the gate with exit 4, clean verdicts still pass with exit 0, and the rendered violations report lands in the same place and format as before
**Priority:** P1
**Independent Test Criteria:** With `ANTHROPIC_API_KEY` unset, `metta check-constitution --change <name> --record <verdict-file>` given a verdict with no blocking violations exits 0 and writes `violations.md`; given a verdict with a blocking violation it exits 4; given malformed JSON it rejects the input with a schema validation error.

**Acceptance Criteria:**
- **Given** a verdict file containing `{"violations": []}` **When** the record invocation runs **Then** the verdict passes `ViolationListSchema` validation, `violations.md` is written to its existing location in the existing rendered format, and the command exits 0.
- **Given** a verdict containing a blocking violation without a Complexity Tracking justification **When** the record invocation runs **Then** existing `isBlockingViolation` classification and `parseComplexityTracking` justification lookup are applied unchanged and the command exits 4.
- **Given** a verdict file that does not conform to `ViolationListSchema` **When** the record invocation runs **Then** the command reports a validation error and does not write a `violations.md` that misrepresents the check as passed.

---

## US-3: The skill drives the full two-step flow inside the session

**As an** AI orchestrator invoking `/metta-check-constitution`
**I want to** have the skill run the emit-contract CLI call, spawn the Read-only `metta-constitution-checker` subagent with the constitution and spec content, and record the captured verdict via the second CLI call
**So that** a single skill invocation performs the complete constitution check end-to-end using instruction mode, matching the pattern every other lifecycle step already follows
**Priority:** P1
**Independent Test Criteria:** Running the `/metta-check-constitution` skill in a session with no `ANTHROPIC_API_KEY` completes the full check for an active change — contract emitted, `metta-constitution-checker` subagent spawned with Read-only tools, verdict recorded, `violations.md` produced — with no manual workaround steps.

**Acceptance Criteria:**
- **Given** an active change with a spec **When** the skill runs **Then** it invokes the emit-contract CLI step, passes the constitution and spec content to the existing `metta-constitution-checker` subagent (whose `<CONSTITUTION>`/`<SPEC>` in, `{"violations": [...]}` out contract is unchanged), and feeds the subagent's output to the record-verdict CLI step.
- **Given** the skill template at `src/templates/skills/metta-check-constitution/` and the deployed copy at `.claude/skills/metta-check-constitution/` **When** the change ships **Then** the two copies are byte-identical per repo convention.
- **Given** the subagent produces a verdict with blocking violations **When** the skill completes **Then** the skill surfaces the gate failure (exit 4) rather than masking it.

---

## US-4: No API-auth code paths remain in the codebase

**As a** metta maintainer
**I want to** delete the now-unused provider abstraction (`src/providers/`, its barrel exports, its tests) and remove `@anthropic-ai/sdk` from dependencies
**So that** the codebase contains zero direct hosted-model API code paths, honoring the no-direct-API-calls directive with no conditional fallback left to regress into
**Priority:** P1
**Independent Test Criteria:** After the change, `src/providers/` and `tests/provider.test.ts` do not exist, `grep -r "@anthropic-ai/sdk"` over `src/` and `package.json` returns no matches, `npm install && npm run build && npm test` all succeed, and no source file references `AIProvider`, `ProviderRegistry`, or `generateObject`.

**Acceptance Criteria:**
- **Given** the completed change **When** the repository is inspected **Then** `src/providers/provider.ts` and `src/providers/anthropic-provider.ts` are deleted, their exports are removed from `src/index.ts`, and `tests/provider.test.ts` is removed.
- **Given** `package.json` and `package-lock.json` **When** dependencies are listed **Then** `@anthropic-ai/sdk` is absent and `npm install` regenerated the lockfile cleanly.
- **Given** `src/constitution/checker.ts` **When** its API is inspected **Then** `CheckerOptions` no longer carries a `provider` field, no `generateObject` call remains, and the retained prompt-building and post-processing functions serve contract emission and verdict recording respectively, with `tests/constitution-checker.test.ts` updated to match.

---

## US-5: Constitution and generated docs reflect the instruction-mode reality

**As a** metta maintainer
**I want to** update `spec/project.md`'s Stack section to drop the "Anthropic SDK — AI provider integration" entry and state the instruction-mode-only principle, then regenerate `CLAUDE.md`
**So that** the project constitution and the docs derived from it accurately describe how AI-driven work actually runs, preventing future contributors from reintroducing direct API usage based on stale documentation
**Priority:** P2
**Independent Test Criteria:** After the change, neither `spec/project.md` nor the regenerated `CLAUDE.md` mentions the Anthropic SDK as a dependency, and both state that all AI-driven work runs inside the Claude Code session via skills and subagents.

**Acceptance Criteria:**
- **Given** the updated `spec/project.md` **When** the Stack section is read **Then** "Anthropic SDK — AI provider integration" is removed and the instruction-mode-only principle (no direct provider API usage anywhere) is stated explicitly.
- **Given** the updated constitution **When** `CLAUDE.md` is regenerated **Then** its Stack listing matches the constitution and contains no Anthropic SDK reference.
- **Given** the regenerated docs **When** the change is finalized **Then** `CLAUDE.md` is committed alongside the constitution update so the two do not drift.
