# metta complete prints [METTA-EXECUTOR] as next agent banner for stories artifact — artifactAgentMap in src/cli/commands/complete.ts:145-148 and src/cli/commands/progress.ts:80 is missing a 'stories' -> 'product' entry, so stories falls through to the 'executor' default. Expected banner: [METTA-PRODUCT]. next_agent JSON field also returns 'metta-executor' for stories. Reproduced while driving a trello-clone demo change where 'metta complete intent --json' emitted 'Next: [METTA-EXECUTOR] stories'. Fix: add 'stories: "product"' to both maps.

**Captured**: 2026-04-17
**Status**: logged
**Severity**: minor

metta complete prints [METTA-EXECUTOR] as next agent banner for stories artifact — artifactAgentMap in src/cli/commands/complete.ts:145-148 and src/cli/commands/progress.ts:80 is missing a 'stories' -> 'product' entry, so stories falls through to the 'executor' default. Expected banner: [METTA-PRODUCT]. next_agent JSON field also returns 'metta-executor' for stories. Reproduced while driving a trello-clone demo change where 'metta complete intent --json' emitted 'Next: [METTA-EXECUTOR] stories'. Fix: add 'stories: "product"' to both maps.
