# metta-verifier deployed agent copy drifted from template, leaving main test suite red

**Captured**: 2026-06-22
**Status**: logged
**Severity**: major

## Symptom

`tests/agents-byte-identity.test.ts` fails on `main`: the case `metta-verifier template and deployed copy are byte-identical` errors because `src/templates/agents/metta-verifier.md` no longer matches its deployed copy at `.claude/agents/metta-verifier.md`. The full test suite has been red on main ever since the verifier-filename change merged, but it went undetected for a long time because the oversized `tests/cli.test.ts` made the finalize test gate time out before the suite could complete. Now that `cli.test.ts` is split and the suite finishes in ~3m10s, a real `metta finalize` surfaces the failure and blocks the gate for every change.

## Root Cause Analysis

The change `fix-metta-verifier-output-filename-match-workflow-generates` pinned the verification output filename in the verifier persona. Commit `545acafc9` edited only `src/templates/agents/metta-verifier.md` (line 62 Rules entry) and rebuilt dist, but did NOT propagate the same edit to the deployed copy `.claude/agents/metta-verifier.md`. The template now carries the new `summary.md` EXACT-path contract while the deployed copy still carries the old `When done, write the file to disk and return` Rules line. The byte-identity test asserts these two files are identical, so it has failed since that commit merged. There is no change-time enforcement that an edit to an agent template also updates its deployed `.claude/agents` copy, so the drift went silent until the suite could run green-to-completion.

### Evidence
- `src/templates/agents/metta-verifier.md:62` — template Rules line carries the new `summary.md` EXACT-path contract (`write the verification artifact to the EXACT path... currently summary.md`).
- `.claude/agents/metta-verifier.md:62` — deployed copy still carries the stale `When done, write the file to disk and return` Rules line, the exact byte-level divergence the test detects.
- `tests/agents-byte-identity.test.ts:19` — `expect(template).toBe(deployed)` for `metta-verifier` is the assertion that fails; `git show --stat 545acafc9` confirms that commit touched only the template, not the deployed copy.

## Candidate Solutions
1. **Sync deployed copy to template** — apply the same filename-pin Rules line to `.claude/agents/metta-verifier.md` so it is byte-identical to `src/templates/agents/metta-verifier.md`, then verify by running `tests/agents-byte-identity.test.ts` green. Tradeoff: fixes the immediate red suite but does nothing to prevent recurrence; relies on discipline for future template edits.
2. **Sync now plus add change-time enforcement** — do the sync in solution 1 and also add a guard/check so any edit to an agent template must update the deployed `.claude/agents` copy, mirroring how hook copies are kept in sync. Tradeoff: larger scope than a one-line fix and properly belongs in a follow-up change; out of scope for the immediate red-suite unblock.
