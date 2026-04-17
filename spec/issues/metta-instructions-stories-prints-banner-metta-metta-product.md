# metta instructions stories prints banner [METTA-METTA-PRODUCT] with doubled 'metta-' prefix — in src/cli/commands/instructions.ts the BUILTIN_AGENTS.product entry uses name: 'metta-product' while all other agents use short names (proposer, executor, etc.). agentBanner in src/cli/helpers.ts:190 then prepends another 'metta-', producing 'metta-metta-product' -> '[METTA-METTA-PRODUCT]'. Reproduced in demo workflow: 'metta instructions stories --json' stderr showed '[METTA-METTA-PRODUCT] stories -> metta-product'. Fix: change BUILTIN_AGENTS.product.name to 'product' (drop the prefix, matches other entries).

**Captured**: 2026-04-17
**Status**: logged
**Severity**: minor

metta instructions stories prints banner [METTA-METTA-PRODUCT] with doubled 'metta-' prefix — in src/cli/commands/instructions.ts the BUILTIN_AGENTS.product entry uses name: 'metta-product' while all other agents use short names (proposer, executor, etc.). agentBanner in src/cli/helpers.ts:190 then prepends another 'metta-', producing 'metta-metta-product' -> '[METTA-METTA-PRODUCT]'. Reproduced in demo workflow: 'metta instructions stories --json' stderr showed '[METTA-METTA-PRODUCT] stories -> metta-product'. Fix: change BUILTIN_AGENTS.product.name to 'product' (drop the prefix, matches other entries).
