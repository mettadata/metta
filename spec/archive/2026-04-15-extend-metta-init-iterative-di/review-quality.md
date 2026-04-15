# Quality Review: extend-metta-init-iterative-di

## Verdict: PASS_WITH_WARNINGS

## Findings

### Naming / Structural Consistency
- `src/templates/skills/metta-init/SKILL.md:30,47,74` — Round headings use `## Round N — Title` which matches the test split regex `/(?=^## Round \d)/im`. Good. However, these `## Round` headings sit at H2 (top-level) while being semantically children of step 2 ("DISCOVERY LOOP"). In `metta-propose/SKILL.md:29-43` rounds are expressed as bullet items within step 2, not as peer H2s. This creates visual ambiguity: the numbered steps 3-6 appear to come after Round 3 rather than after the loop. Consider `### Round N` to nest under step 2.
- Exit phrase in `SKILL.md` uses em-dash (U+2014); test uses `\u2014` — consistent. `metta-discovery.md` does not repeat the phrase (it shouldn't — agent isn't the asker). Good.

### Duplication / Cross-Reference
- `SKILL.md:16-28` duplicates the "Exit criterion / Between-round status line" language from `metta-propose/SKILL.md:19-27` almost verbatim. Acceptable because skills are independently deployed, but a short "see metta-propose for loop pattern" note would reduce drift risk. Minor.
- Status-line format matches propose/quick ("Resolved: … Open: … proceeding to Round N"). Consistent.

### Test Gaps
- `tests/skill-structure-metta-init.test.ts` — 5 assertions cover REQ-35..39 at a surface level, but:
  - No assertion verifies the `<DISCOVERY_ANSWERS>` XML block exists with required child elements (`<project>`, `<stack>`, `<conventions>`, `<architectural_constraints>`, `<quality_standards>`, `<off_limits>`). REQ-23 / step 3 structural contract is untested.
  - No byte-identity test between template and deployed copy (cf. `skill-discovery-loop.test.ts:70-82` does this for propose/quick). Drift risk.
  - REQ-37 only checks literal "WebSearch"; R1 could still accidentally contain `WebFetch` (also forbidden by REQ-6). Assertion should also exclude `WebFetch`.
  - REQ-39 counts the word "AskUserQuestion" — R1 has 5 occurrences of the phrase in prose ("Cap: 4 AskUserQuestion calls" plus 4 bullets), which may or may not pass depending on prose wording. Verified: R1 has 1 "Cap" mention + 4 bullet questions = 5 occurrences of "AskUserQuestion"? Actually bullets don't contain the literal token, only the intro line does. Test likely passes, but the metric is brittle — a future editor adding "via AskUserQuestion" inline would flip it.

### Documentation Completeness
- Brownfield vs greenfield paths in R2 (`SKILL.md:55-65`) are clearly delimited. Good.
- Greenfield path for R3 is not explicitly called out — R3 assumes a confirmed stack exists. If the user exits R2 early, the R3 WebSearch `<confirmed stack>` placeholder is undefined. Should document fallback behavior.
- Early-exit partial XML example (`SKILL.md:111-122`) is helpful.

### Maintainability
- Adding a 4th round would require: adding `## Round 4 —` heading, updating the "exit when all three rounds complete" language at line 24, and updating test `toBe(3)` to `toBe(4)`. The hard-coded "three rounds" in the exit criterion is the main friction point. Consider phrasing as "all defined rounds" and centralizing the count.
- Round boundaries are cleanly delimited by H2 headings; splitter regex is robust.
