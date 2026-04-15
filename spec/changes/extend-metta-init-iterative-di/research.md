# Research — extend-metta-init-iterative-di

Two parallel investigations explored (a) the existing SKILL.md discovery-loop pattern and (b) the test strategy for SKILL.md validation. Both files (`research-skill-pattern.md`, `research-skill-test.md`) are committed alongside this summary.

## Recommendation

Reuse the **/metta-propose** and **/metta-quick** discovery-loop conventions verbatim, with three init-specific tweaks:

1. Round labels use the literal headings `Round 1 — Project Identity`, `Round 2 — Stack and Technology`, `Round 3 — Conventions and Constraints` (all matched by the structural test's case-insensitive prefix check).
2. WebSearch fires **once per round** (at the start of R2 and R3 only), not per-question. Query derived from the confirmed R1 purpose for R2, and from the confirmed R2 stack for R3.
3. Unanswered fields after early-exit become **empty XML elements** in the `<DISCOVERY_ANSWERS>` block — never fabricated content. The metta-discovery agent fills gaps from brownfield detection + sensible defaults, bounded to ≤ 2 additional gap-fill questions.

## Key findings from the SKILL-pattern research

- Rounds are bold bullet items inside a `**Rounds:**` block — not top-level `## Round N` headings. The structural test must match `**Round N — Title**` format (case-insensitive).
- Between-round status line format (print as prose, not AskUserQuestion):
  ```
  Resolved: <A>, <B>. Open: <C> — proceeding to Round N.
  ```
  Terminal line when done: `Resolved: all questions. Proceeding to metta-discovery subagent.`
- Early-exit phrase declared verbatim in the preamble AND repeated as the final option in every `AskUserQuestion` call: `I'm done — proceed with these answers` (Unicode em-dash `\u2014`).
- The `<DISCOVERY_ANSWERS>` XML contract names six child elements in a fixed order: `<project>`, `<stack>`, `<conventions>`, `<architectural_constraints>`, `<quality_standards>`, `<off_limits>`. Optional `<CITATIONS>` block follows with `<source url="..." title="..." fetched_at="..." />` children.
- Brownfield R2 opens with a prose detection summary, then a single confirmation question with options `[Confirmed as-is, Add to it, Correct a misdetection, I'm done — proceed with these answers]`.
- Greenfield R2 skips the detection line and presents WebSearch-sourced options only.

Copy-ready R1/R2/R3 block is in `research-skill-pattern.md` — the executor can paste it and fill names.

## Key findings from the SKILL-test research

- **Test location:** MUST be `tests/skill-structure-metta-init.test.ts` — vitest.config.ts line 5 restricts discovery to `tests/**/*.test.ts`. The spec originally named `src/templates/skills/metta-init/__tests__/…` but that path is not discovered. Update spec + tasks accordingly.
- **Existing precedent:** `tests/skill-discovery-loop.test.ts` already reads `src/templates/skills/metta-propose/SKILL.md` and applies string-based structural assertions. Mirror that pattern exactly — no remark-parse, no new helper.
- **Parser:** plain string splitting via `content.split(/(?=^\*\*Round \d)/im)` isolates per-round text. `String.includes` + a small `countOccurrences` helper covers every assertion.
- **Test coverage maps 1:1 to REQ-35 through REQ-39** (5 `it` blocks): (1) exactly 3 rounds present; (2) early-exit phrase appears ≥ 3 times; (3) WebSearch absent from R1; (4) WebSearch present in R2 AND R3; (5) no round exceeds 4 AskUserQuestion call sites.
- **Em-dash hazard:** the exit phrase uses `\u2014` (—), not an ASCII hyphen. Test MUST use `\u2014` literal; executor MUST verify the same character lands in SKILL.md.

## Risks / mitigations

- **Risk:** propose/quick's "per-question WebSearch" idiom could bleed into init. **Mitigation:** REQ-6/7/8/12 explicitly lock init's WebSearch trigger to once-per-round at the start of R2 and R3. Tests enforce R1 has no WebSearch reference.
- **Risk:** spec's test path is wrong (`src/templates/.../__tests__/…`). **Mitigation:** tasks will relocate to `tests/skill-structure-metta-init.test.ts`; note this deviation in the summary.
- **Risk:** metta-discovery agent gaining WebSearch/WebFetch could trigger unintended web fetches during gap-fill. **Mitigation:** REQ-28 caps gap-fill at ≤ 2 questions and the grounding rules forbid unsourced claims.

## Scope decisions

- No new source files beyond SKILL.md edit + metta-discovery.md edit + one new test file.
- No new schemas, no new CLI flags, no new state files.
- No provider-split "research-model tier" (explicitly out-of-scope per intent).
