# Review: fix-two-banner-label-bugs-artifactagentmap-missing-stories-p

Three parallel reviewers: correctness, security, quality.

## Combined verdict: PASS

No critical issues. One non-blocking refactor opportunity noted.

## Findings

### Correctness — PASS
- `src/cli/commands/complete.ts:146` adds `stories: 'product'` correctly; banner resolution at line 163-164 now produces `[METTA-PRODUCT]`.
- `src/cli/commands/progress.ts:81` same fix. (Note: `currentAgent` at line 86 is computed but not rendered in output — pre-existing dead-ish code, out of scope.)
- `src/cli/commands/instructions.ts:9` — `product.name = 'product'` consistent with 8 sibling entries; `agentBanner('product', ...)` prepends `metta-` exactly once.
- `tests/banner-stories.test.ts` — well-isolated, ANSI-stripping, asserts positive and regression-negative (`[METTA-METTA-PRODUCT]` absent), plus executor control case.

### Security — PASS
Cosmetic constants only; no input paths, I/O, dependencies, or permission changes.

### Quality — PASS_WITH_WARNINGS
- **Non-blocking:** `artifactAgentMap` is now duplicated across `complete.ts:145-148` and `progress.ts:80-83`. Recommend a follow-up to extract a shared `artifact-agent-map.ts` module. Out of scope per intent — flag only.
- **Non-blocking:** `progress.ts:80` defines `artifactAgentMap` inside the `for` loop; could be hoisted. Micro-nit.
- Test style, commit style, no dead code/unused imports.
