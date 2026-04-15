# Summary — extend-metta-init-iterative-di

Extended `/metta-init` with a 3-round iterative discovery loop (project identity / stack / conventions), granted WebSearch + WebFetch to the `metta-discovery` agent, and added a structural validation test.

## What shipped

- **`src/templates/skills/metta-init/SKILL.md`** — added DISCOVERY LOOP with 3 `## Round N` sections. R1 asks project identity (no web grounding), R2 asks stack/tech with WebSearch fired once at the start, R3 asks conventions/constraints with WebSearch fired once at the start. Each round caps at 4 AskUserQuestion calls. Every AskUserQuestion call includes the exact option `I'm done — proceed with these answers` (U+2014). Handoff to metta-discovery is inline via `<DISCOVERY_ANSWERS>` XML with 6 fixed child elements + optional `<CITATIONS>`. Grounding-safety paragraph added: treats web content as untrusted, caps option labels ≤ 80 chars, escapes XML-special chars in free-text answers.
- **`src/templates/agents/metta-discovery.md`** — frontmatter `tools` array gained `WebSearch`, `WebFetch`. New `## Grounding Rules` section (untrusted-input framing, inline `<!-- source: <url> -->` citation, authoritative-source preference, R1 search exclusion). New `## Cumulative Answer Handling` section (non-empty XML verbatim, empty fields filled from detection → defaults → ≤ 2 gap-fill questions, no re-asking, ≤ 10 total questions).
- **`tests/skill-structure-metta-init.test.ts`** (new) — 6 assertions covering REQ-35 through REQ-39 plus byte-identity parity between template and deployed `.claude/skills/metta-init/SKILL.md`.

## Deviation from spec

The spec's REQ-34 named `src/templates/skills/metta-init/__tests__/skill-structure.test.ts`. Design corrected this to `tests/skill-structure-metta-init.test.ts` because `vitest.config.ts` restricts discovery to `tests/**/*.test.ts`. Structural assertions are identical; test placement matches the `tests/skill-discovery-loop.test.ts` precedent.

## Verification

- Build: `npm run build` — pass
- Typecheck: `npx tsc --noEmit` — pass (no diagnostics)
- Lint: `npm run lint` — pass
- Tests: `npx vitest run` — **485 / 485 pass** (up from 484, +6 new assertions)
- Spec coverage: all 40 REQs traced to concrete evidence (see `verify-spec-coverage.md`)

## Review outcomes

- Correctness review: **PASS** — all REQs have evidence; em-dash codepoint matches in SKILL.md and test; XML schema + WebSearch scope correct.
- Security review: **PASS_WITH_WARNINGS** — addressed inline via the grounding-safety paragraph (untrusted data, option sanitization, XML escaping).
- Quality review: **PASS_WITH_WARNINGS** — addressed inline via the WebFetch R1 exclusion and byte-identity test. Remaining maintainability notes (hard-coded "three rounds" count, duplicated exit-option language with /metta-propose) logged as minor — not blockers.

## Backwards compatibility

- `metta init --json` CLI signature unchanged. Existing automation that pipes the output is unaffected.
- metta-discovery agent's pre-existing behaviors (brownfield scan, greenfield open-ended questioning, constitution write, config.yaml nested schema) are preserved. Only tool grants + two new sections were added.

## Dogfood touchpoint

The next invocation of `/metta-init` on a new project will interactively walk the 3 rounds with WebSearch-surfaced options in R2/R3 and a structured XML handoff to metta-discovery that fills in any gaps.
