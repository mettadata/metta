# Implementation: sync-deployed-metta-verifier-agent-copy-template-fix-red

Resolves issue `metta-verifier-deployed-agent-copy-drifted-from-template`.

## Problem

The deployed agent copy `.claude/agents/metta-verifier.md` drifted from its source
template `src/templates/agents/metta-verifier.md` at line 62. The template carried
the updated Rules line that pins the verification artifact to the EXACT path the
orchestrator provides (currently `summary.md`), while the deployed copy still held
the stale line `When done, write the file to disk and return.`

`tests/agents-byte-identity.test.ts` asserts every deployed agent under
`.claude/agents/` is byte-identical to its template under `src/templates/agents/`,
so this drift turned main's suite red.

The line-62 divergence before the fix:

```
< - When done, write the verification artifact to the EXACT path the orchestrator provides in the invocation payload — ... (currently `summary.md`). ...
---
> - When done, write the file to disk and return. The orchestrator commits after you return — do not run git.
```

## Change

Single-file sync. Copied the template over the deployed copy:

```
cp src/templates/agents/metta-verifier.md .claude/agents/metta-verifier.md
```

Only `.claude/agents/metta-verifier.md` was modified. The template and all other
agents are untouched. A sweep of every `src/templates/agents/*.md` vs
`.claude/agents/*.md` pair reports no remaining drift — this fix touches exactly
one pair.

## Verification

- `diff src/templates/agents/metta-verifier.md .claude/agents/metta-verifier.md`
  → no output, exit 0 (byte-identical).
- All-pairs drift sweep → no DRIFT reported for any agent.
- `npx vitest run tests/agents-byte-identity.test.ts` → 4 passed (4), previously 1 failed.
- `npm run build` → exit 0.
- `npx tsc --noEmit` → exit 0.
