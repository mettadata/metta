# Summary: fix-two-banner-label-bugs-artifactagentmap-missing-stories-p

## Problem

Two minor banner-label bugs in the CLI output:

1. `metta complete` and `metta progress` displayed `[METTA-EXECUTOR]` when the next artifact was `stories`. Expected `[METTA-PRODUCT]`. Root cause: `artifactAgentMap` missing a `stories` entry, falling through to the `executor` default.
2. `metta instructions stories` displayed `[METTA-METTA-PRODUCT]` with a doubled `metta-` prefix. Root cause: `BUILTIN_AGENTS.product.name = 'metta-product'` while `agentBanner` also prepends `metta-`.

## Solution

Three one-line edits plus one new test file:

- `src/cli/commands/complete.ts:146` — added `stories: 'product',` to `artifactAgentMap`.
- `src/cli/commands/progress.ts:81` — same addition to the duplicate map.
- `src/cli/commands/instructions.ts:9` — changed `name: 'metta-product'` to `name: 'product'` (now consistent with the eight sibling entries).
- `tests/banner-stories.test.ts` — new 2-test regression covering `agentBanner('product', ...)` output.

## Files touched

- `src/cli/commands/complete.ts`
- `src/cli/commands/progress.ts`
- `src/cli/commands/instructions.ts`
- `tests/banner-stories.test.ts` (new)

## Resolves

- `metta-complete-prints-metta-executor-as-next-agent-banner-fo` (minor)
- `metta-instructions-stories-prints-banner-metta-metta-product` (minor)

## Verification

- `npx tsc --noEmit` — clean
- `npm test` — 564/564 pass (46 test files; +2 new tests from this change)
- Grep-based checks: `stories: 'product'` appears in both `complete.ts` and `progress.ts`; `name: 'metta-product'` returns zero matches.
