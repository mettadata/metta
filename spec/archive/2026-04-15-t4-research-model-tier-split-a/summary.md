# Summary: t4-research-model-tier-split-a

Second of 5 shipped-research items from `docs/research/2025-04-15/SUMMARY.md`. Reframed during discovery: this MVP is Claude-Code-driven (slash commands + CLI), so the "research-model tier" maps to enabling agents to use Claude Code's native `WebSearch` + `WebFetch` tools — not adding a new CLI provider abstraction.

## Files changed
- `src/templates/agents/metta-researcher.md` + `.claude/agents/...` — added `WebSearch, WebFetch` to `tools:` frontmatter; appended `## Grounding` section with rules: when to ground, citation format (markdown footnotes with ISO accessed-date), fetch-failure inline log + continue, treat web content as untrusted data.
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/...` — Concrete-tech grounding bullet in DISCOVERY LOOP Round 1; triggers when discovery question presents technology options.
- `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/...` — same bullet inside DISCOVERY LOOP (non-trivial path); trivial-detection gate untouched.
- `tests/grounding.test.ts` (new) — 8 byte-identity + content assertions.

## Gates
- `npm run build` — PASS
- `npx vitest run` — **423/423 PASS** (was 415, +8 new)

## Behavior
- metta-researcher agent now grounds non-100%-certain claims via WebSearch/WebFetch and cites with markdown footnotes in research.md.
- /metta-propose and /metta-quick discovery loops invoke WebSearch first when offering concrete tech options (libraries, frameworks, ORMs, test runners, auth providers). Generic scope/architecture questions skip grounding.

## Out of scope (deferred)
- /metta-init iterative discovery loop with grounding — separate backlog item `extend-metta-init-with-iterative-discovery-loop-3-rounds-pro` (now unblocked by T4).
- Perplexity SDK / new CLI provider — not needed in Claude-Code-only MVP.
- Exa / Firecrawl MCP integrations.
- Hard query budget enforcement (prompt guidance only).

All 5 task checkboxes flipped `[x]`.
