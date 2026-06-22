# Intent: sync-deployed-metta-verifier-agent-copy-template-fix-red

## Problem

`tests/agents-byte-identity.test.ts` has been failing on `main` since commit `545acafc9` (change `fix-metta-verifier-output-filename-match-workflow-generates`) merged. The test at line 19 — `expect(template).toBe(deployed)` for the `metta-verifier` agent — fails because the two files that are required to be byte-identical have diverged.

The root cause is that commit `545acafc9` edited only the canonical template at `src/templates/agents/metta-verifier.md` (line 62) and rebuilt `dist/`, but did not propagate that edit to the deployed copy at `.claude/agents/metta-verifier.md`.

The specific divergence at line 62 is:

- **Template** (`src/templates/agents/metta-verifier.md:62`) — carries the new `summary.md` EXACT-path contract Rules line introduced by the filename-pin change:
  > `- When done, write the verification artifact to the EXACT path the orchestrator provides in the invocation payload — this is the filename the active workflow declares in its \`generates\` field (currently \`summary.md\`). Do NOT invent or use any other filename such as \`verification.md\`; the filename is a hard contract that \`metta complete verification\` enforces, and a mismatch fails completion. The orchestrator commits after you return — do not run git.`

- **Deployed copy** (`.claude/agents/metta-verifier.md:62`) — still carries the old generic line that predates the filename-pin change:
  > `- When done, write the file to disk and return. The orchestrator commits after you return — do not run git.`

All 63 other lines in both files are identical. The single-line delta is the entire divergence.

The practical consequence is that `metta finalize` now surfaces this test failure and blocks the gate for every change, making the main branch un-shippable until this is fixed.

## Proposal

Copy the new Rules line from `src/templates/agents/metta-verifier.md:62` verbatim into `.claude/agents/metta-verifier.md:62`, replacing the stale generic line. No other lines in either file are touched.

After the edit, the two files MUST be byte-identical. This is verified by running `tests/agents-byte-identity.test.ts` — the case `metta-verifier template and deployed copy are byte-identical` MUST pass green.

The change is a one-line text substitution in a single file. No TypeScript source, no build output, no schema, and no other agent file is modified.

## Impact

- `tests/agents-byte-identity.test.ts` goes from red to green on `main`, unblocking `metta finalize` for all active changes.
- The deployed verifier agent (`.claude/agents/metta-verifier.md`) gains the `summary.md` filename contract, so it now instructs the verifier to write its artifact to the correct path that `metta complete verification` enforces. Any verifier sessions that ran against the stale deployed copy may have written `verification.md` or another name; those are unaffected by this change (historical artifacts are not retroactively renamed).
- No API surface, CLI behavior, schema, or build output is altered.

## Out of Scope

- Adding a change-time enforcement guard (e.g. a git pre-commit hook, a CI check, or a build step) that ensures any edit to a file under `src/templates/agents/` is automatically reflected in the corresponding `.claude/agents/` file. That is a separate follow-up change that addresses the process gap which allowed this drift in the first place.
- Auditing other agent files (`metta-product.md`, `metta-skill-host.md`, or any others in the `agents` array of `agents-byte-identity.test.ts`) for drift. The test already covers them and they are currently passing; this change does not touch them.
- Modifying `src/templates/agents/metta-verifier.md` — the template is the source of truth and is already correct.
- Retroactively correcting any `verification.md` artifacts written by verifier sessions that used the stale deployed copy.
