# Intent: Data-Driven Byte-Identity Tests for All Deployed Template Families

**Change:** comprehensive-data-driven-byte-identity-tests-all-deployed
**Date:** 2026-06-22
**Status:** Draft
**Workflow:** quick (preventive — no behavior change, expected to pass on creation)

---

## Problem

metta ships two physical copies of every committed Claude asset: the canonical source under `src/templates/` and the committed deployed copy under `.claude/`. These must stay byte-identical — the `.claude/` copies are what Claude actually loads at runtime, so any drift means the running agent/skill/hook differs from the reviewed, versioned source.

This session hit that exact failure mode for real: `.claude/agents/metta-verifier.md` drifted from `src/templates/agents/metta-verifier.md`, and because nothing tested that pair, a red test suite shipped undetected for months.

The existing guard is a **partial, hand-maintained subset**, not a complete invariant:

- `tests/agents-byte-identity.test.ts` enumerates only **3 of 11 agents** (`metta-product`, `metta-skill-host`, `metta-verifier`) in a hardcoded list, with a literal `// Add other agents here as we centralize` comment — an open admission that 8 agents are uncovered.
- Hooks are covered (2/2).
- Two skills are covered out of **18**.
- statusline has **no** byte-identity test at all.

Audited counts on the current tree confirm the exposure surface precisely:

| Family | Source files | Deployed files | Byte-identity coverage |
|---|---|---|---|
| Agents (`src/templates/agents/*.md` ↔ `.claude/agents/*.md`) | 11 | 11 | 3/11 (hardcoded) |
| Skills (`src/templates/skills/*/SKILL.md` ↔ `.claude/skills/*/SKILL.md`) | 18 | 18 | 2/18 |
| Hooks (`src/templates/hooks/*.mjs` ↔ `.claude/hooks/*.mjs`) | 2 | 2 | 2/2 |
| statusline (`src/templates/statusline/*` ↔ `.claude/statusline/*`) | 1 | 1 | 0/1 |

The root design flaw is **enumeration by hand**: any new agent, skill, or statusline asset is silently uncovered until someone remembers to extend the hardcoded list. The structure of the test is itself the bug.

---

## Proposal

Add a single **data-driven** byte-identity test, `tests/template-deploy-sync.test.ts`, that cannot fall behind because it discovers the file set at runtime instead of hardcoding it.

For each committed-deploy family — **agents, skills, hooks, statusline** — the test:

1. **Auto-discovers** every source file in the family by globbing the canonical `src/templates/` location (e.g. `src/templates/agents/*.md`, `src/templates/skills/*/SKILL.md`, `src/templates/hooks/*.mjs`, `src/templates/statusline/*`).
2. For each discovered source file, asserts a **byte-identical** deployed counterpart exists at the mirrored `.claude/` path (exact `readFile(...) === readFile(...)` string equality, no normalization).
3. Asserts **no orphans in either direction**:
   - every deployed `.claude/` file in the family has a matching source file (catches deleted-from-source-but-left-deployed drift), and
   - every source file has a deployed copy (catches added-to-source-but-not-deployed drift).

Because the file set is derived from the filesystem at test time, the test can **never again silently cover only a subset** — adding a new agent or skill automatically pulls it into the invariant, and removing one is caught by the orphan check.

The family mirror mapping is defined as data (a small table of `{ family, sourceGlob, sourceRoot, deployedRoot, mapSourceToDeployed }`) so the four families share one parameterized assertion body rather than four copy-pasted blocks.

Optionally, **consolidate** `tests/agents-byte-identity.test.ts` into the new test to remove redundancy: the data-driven agents family fully subsumes the hardcoded 3-agent list, so the old file's byte-identity assertions can be deleted. Any non-redundant assertion it carries (e.g. the `metta-product` frontmatter shape check) is preserved — moved into the new file or kept as a separate focused test — so no coverage is lost.

This is a **preventive** change. An audit of the current tree shows all four families are already 100% in sync (11/11 agents, 18/18 skills, 2/2 hooks, 1/1 statusline byte-identical). The new test therefore passes immediately on creation; its value is locking the invariant so future drift fails CI at the point of introduction rather than months later.

---

## Impact

**Test suite:** Gains one new data-driven test file, `tests/template-deploy-sync.test.ts`, covering 32 source↔deploy pairs (11 + 18 + 2 + 1) plus bidirectional orphan checks per family. Expected result on creation: green.

**Existing tests:** `tests/agents-byte-identity.test.ts` is consolidated/removed (its 3 agents are a strict subset of the new auto-discovered 11). Net test-to-source ratio is preserved or improved.

**Drift detection:** Any future divergence between `src/templates/` and `.claude/` in the four committed-deploy families — including newly added or deleted assets — fails the suite immediately, closing the gap that let the `metta-verifier.md` drift ship silently.

**No production behavior change:** This change touches test code only. No CLI command, agent, skill, hook, or statusline asset is modified.

---

## Out of Scope

- **workflows / gates / artifacts / docs templates.** These live only under `src/templates/` (and `docs/`) and are copied to `dist/` by the build — they have **no committed `.claude/` copy**, so they cannot silently drift the same way and are deliberately excluded from this byte-identity invariant.
- **Build-time or pre-commit enforcement.** Wiring the same auto-discovered check into a build step or a git pre-commit hook (so drift is blocked before it reaches CI) is a reasonable follow-up but is **not** part of this change.
- **Fixing drift.** There is currently **no** drift to fix (the audit shows everything in sync). This change only adds the guard; it does not modify any deployed asset.
- **Changing the deploy mechanism.** How `.claude/` copies are produced or kept in sync (install/init scaffolding) is unchanged; this change only asserts the result.

---

## Given/When/Then Scenarios

### Scenario 1: All families in sync — test passes

**Given** every file under `src/templates/agents/*.md`, `src/templates/skills/*/SKILL.md`, `src/templates/hooks/*.mjs`, and `src/templates/statusline/*` has a byte-identical counterpart under the mirrored `.claude/` path
**And** there are no orphan files in either direction
**When** `tests/template-deploy-sync.test.ts` runs
**Then** every family assertion passes and the suite is green

### Scenario 2: A source file drifts from its deployed copy — test fails

**Given** `src/templates/agents/metta-verifier.md` is edited but `.claude/agents/metta-verifier.md` is not updated to match
**When** the data-driven test runs
**Then** the agents-family byte-identity assertion for `metta-verifier` fails, naming the diverged pair

### Scenario 3: A new agent is added to source only — orphan check fails

**Given** a new file `src/templates/agents/metta-newrole.md` is added with no corresponding `.claude/agents/metta-newrole.md`
**When** the test runs
**Then** the test fails reporting a source file with no deployed counterpart — without anyone having to edit a hardcoded list

### Scenario 4: A deployed file has no source — orphan check fails

**Given** `.claude/skills/orphaned-skill/SKILL.md` exists but `src/templates/skills/orphaned-skill/SKILL.md` does not
**When** the test runs
**Then** the test fails reporting a deployed file with no source counterpart

### Scenario 5: New asset is auto-covered without test edits

**Given** a developer adds `src/templates/skills/metta-foo/SKILL.md` and its deployed copy `.claude/skills/metta-foo/SKILL.md`
**When** the test runs
**Then** the new skill is automatically included in the byte-identity assertions via filesystem discovery, with no change required to the test file

### Scenario 6: Redundant partial test consolidated without coverage loss

**Given** `tests/agents-byte-identity.test.ts` previously asserted byte-identity for 3 hardcoded agents and a `metta-product` frontmatter shape
**When** that file is consolidated into `tests/template-deploy-sync.test.ts`
**Then** all 11 agents are covered by the data-driven test
**And** the `metta-product` frontmatter assertion is preserved (moved or kept as a focused test) so no assertion is lost
