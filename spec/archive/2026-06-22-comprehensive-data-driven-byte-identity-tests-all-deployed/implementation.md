# Implementation: comprehensive-data-driven-byte-identity-tests-all-deployed

## What changed

### New: `tests/template-deploy-sync.test.ts`
A data-driven byte-identity test that locks the invariant: every committed
`src/templates/` file in a deploy family is byte-identical to its committed
`.claude/` deployed copy. It AUTO-DISCOVERS files (recursive `readdirSync` at
collection time) so coverage can never silently regress to a hand-maintained
subset (the failure mode that let the `metta-verifier` drift ship).

Families covered (the four with a committed `.claude/` deployed copy that can
drift):

| Family | Source | Deployed | Files |
|--------|--------|----------|------:|
| agents | `src/templates/agents` | `.claude/agents` | 11 |
| skills | `src/templates/skills/**` | `.claude/skills/**` | 18 |
| hooks | `src/templates/hooks` | `.claude/hooks` | 2 |
| statusline | `src/templates/statusline/**` | `.claude/statusline/**` | 1 |

For each family it asserts **both directions**:
1. every source file has a byte-identical deployed copy (with a clear message if
   the deployed copy is missing — the "shipped drift" case);
2. no orphan deployed files exist without a source template (the "stale deployed
   copy" case);
plus a non-empty guard per family so a renamed/misconfigured path can't silently
produce zero assertions.

**Generates 40 test cases** (32 file-pairs + 4 non-empty guards + 4 orphan checks).

### Consolidated: `tests/agents-byte-identity.test.ts`
Removed the now-redundant per-agent byte-identity loop (it covered only 3 of 11
agents); the new test covers all 11. Kept the unique `metta-product` frontmatter
validation test.

## Out of scope (per intent)
- Workflows/gates/artifacts/docs templates — copied to `dist/` by the build and
  have no committed `.claude/` copy, so they cannot silently drift the same way.
- Build-time / pre-commit enforcement (a possible follow-up).

## Verification performed
- `npx vitest run tests/template-deploy-sync.test.ts` → **40 passed**.
- `npx vitest run tests/template-deploy-sync.test.ts tests/agents-byte-identity.test.ts tests/skill-discovery-loop.test.ts` → **52 passed (3 files)**.
- `npx tsc --noEmit` (explicit over the new test) → exit 0.
- `npm run build` → OK.
- Pre-write audit confirmed all four families are currently in sync (11/11, 18/18,
  2/2, 1/1; no orphans), so the test passes immediately and locks the invariant.

## Note
Implemented directly from the main session because the executor subagent was
blocked by a session usage limit; design followed the change intent exactly and
matches the repo's existing byte-identity test style.
