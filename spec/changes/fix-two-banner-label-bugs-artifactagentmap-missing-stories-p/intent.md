# fix-two-banner-label-bugs-artifactagentmap-missing-stories-p

## Problem

Two minor but consistent banner-label bugs show up every time a workflow advances past the intent stage:

1. `metta complete intent` and `metta progress` both print `[METTA-EXECUTOR] stories` when the next artifact is `stories`. Expected: `[METTA-PRODUCT]`. Root cause: `artifactAgentMap` in `src/cli/commands/complete.ts:145-148` and `src/cli/commands/progress.ts:80-83` is missing a `stories: 'product'` entry, so `stories` falls through to the `'executor'` default.

2. `metta instructions stories` prints `[METTA-METTA-PRODUCT]` with a doubled `metta-` prefix. Root cause: `src/cli/commands/instructions.ts:9` has `BUILTIN_AGENTS.product.name = 'metta-product'` while every other agent uses a short name (`proposer`, `executor`, ...); `agentBanner` in `src/cli/helpers.ts:190` prepends `metta-`, producing `metta-metta-product` → `[METTA-METTA-PRODUCT]`.

Both issues are logged in `spec/issues/`: `metta-complete-prints-metta-executor-as-next-agent-banner-fo` and `metta-instructions-stories-prints-banner-metta-metta-product`.

## Proposal

Three line-level edits plus a targeted test:

1. Add `stories: 'product',` to `artifactAgentMap` in `src/cli/commands/complete.ts:145-148`.
2. Add the same entry to `artifactAgentMap` in `src/cli/commands/progress.ts:80-83`.
3. Change `src/cli/commands/instructions.ts:9` `name: 'metta-product'` → `name: 'product'` (matches the sibling entries).
4. Add a small test that exercises the banner output for the `stories` artifact so the regression is caught in CI.

## Impact

- Fixes the displayed banner in three CLI paths.
- No behavior change beyond cosmetic banner text.
- Tests: may need one small test file or a new `it()` block in an existing CLI test.

## Out of Scope

- No refactor of `BUILTIN_AGENTS` or `artifactAgentMap` to a shared constant (tempting, but out of scope for a minor fix).
- No broader audit of banner logic beyond the stories case.
- No changes to `agentBanner` in `helpers.ts`.
