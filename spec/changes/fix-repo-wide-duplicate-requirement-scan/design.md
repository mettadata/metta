# Design — fix-repo-wide-duplicate-requirement-scan

## Overview

Pure data repair of the spec store, following the method proven in the claude-statusline repair (PR #76). Three components: (1) verified dedupe of three spec.md files, (2) lock regeneration through the project's own parser/lock code path, (3) CLAUDE.md refresh. No TypeScript source changes.

## Component 1 — Spec dedupe (per file)

The corruption is whole-block repetition of `## Requirement:` sections. Verified layout (all copies byte-identical to first occurrence, modulo trailing blank lines):

| File | Layout | Keep | Delete |
|------|--------|------|--------|
| `spec/specs/fix-issues-command/spec.md` (441 lines) | 4-requirement block tripled: lines 3–149, 150–296, 297–441 | lines 1–149 | lines 150–441 |
| `spec/specs/user-stories/spec.md` (374 lines) | 7-requirement block doubled: lines 3–189, 190–374 | lines 1–189 | lines 190–374 |
| `spec/specs/install-init/spec.md` (246 lines) | two individual blocks repeated: `init-command-drives-discovery` at 3–27 and 68–92; `init-skill-invokes-init-command` at 28–42 and 93–107 | everything else | lines 68–107 (the second copies, which are contiguous) |

Procedure per file: re-diff the doomed range against the kept first-occurrence range immediately before deletion (guards against drift since research), delete via line-range operation, normalize the file to end with exactly one trailing newline.

Post-condition (mechanical check): `grep -c '^## Requirement:'` yields 4 / 9 / 7 respectively, and `sort | uniq -d` over the requirement heading names yields empty.

## Component 2 — Lock regeneration

One tsx script (written to the scratchpad, not committed — it is repair tooling, not product code) that, for each capability in `[fix-issues-command, install-init, user-stories]`:

```ts
const md = readFileSync(join(specDir, 'specs', cap, 'spec.md'), 'utf8')
const parsed = parseSpec(md)                      // src/specs/spec-parser.ts:83
const mgr = new SpecLockManager(specDir)          // specDir = <worktree>/spec
await mgr.update(cap, parsed)                     // bumps version, recomputes hash, rewrites inventory
```

`update()` Zod-validates on write via StateStore — satisfies "no unvalidated state writes". Expected evidence: per-requirement `hash` values unchanged from the corrupted locks' first entries (content identity), duplicated entries gone, `version` incremented by 1.

## Component 3 — CLAUDE.md refresh

`metta refresh` regenerates the Active Specs table so requirement counts for the three capabilities derive from the deduped specs. Other sections may refresh as a side effect (accepted, as in PR #76).

## Error handling / rollback

Each component lands as its own atomic commit on branch `metta/fix-repo-wide-duplicate-requirement-scan`; git is the rollback mechanism. If any pre-deletion diff shows non-identical content, STOP (Deviation Rule 4) — the byte-identity premise would be wrong.

## Testing strategy

No new unit tests (no source changes; near-1:1 test ratio unaffected). Verification = mechanical post-conditions above + full gates (`npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`).
