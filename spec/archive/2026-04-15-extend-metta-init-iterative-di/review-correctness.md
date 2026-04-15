# Correctness Review: extend-metta-init-iterative-di

## Verdict: PASS

Reviewed commits `dd0333416`, `afc10fea0`, `fe2c74da4` against `spec.md` REQ-1..REQ-40. All 40 requirements map to concrete evidence in the three edited files. No logic errors, off-by-one, or spec-compliance gaps found.

## Evidence checks

- **Em-dash codepoint match**: `SKILL.md` bytes `e2 80 94` = U+2014; `skill-structure-metta-init.test.ts:11` uses `\u2014`. Same codepoint — test will match verbatim against all 14 occurrences in SKILL.md.
- **H2 round headings**: `SKILL.md:30,47,74` use `## Round 1`, `## Round 2`, `## Round 3` — matches test regex `^## Round \d/im` (count = 3). Not bullet items.
- **`<DISCOVERY_ANSWERS>` 6 children in order** (`SKILL.md:98-105`): project, stack, conventions, architectural_constraints, quality_standards, off_limits — matches REQ-21.
- **R1 WebSearch-free** (`SKILL.md:30-45`): line 34 uses hyphenated `web-search` (not `WebSearch`) — test's `not.toContain('WebSearch')` assertion passes.
- **R2/R3 WebSearch grounded** (`SKILL.md:50,65,69,77,81`): WebSearch referenced in both rounds.
- **Cumulative-answer no-reask** (`metta-discovery.md:41`): "Do NOT re-ask any question whose answer is already present in the XML" — satisfies REQ-30/REQ-32.
- **Tool grant** (`metta-discovery.md:4`): includes `WebSearch`, `WebFetch` per REQ-25.
- **Gap-fill cap ≤ 2** (`metta-discovery.md:40`): "at most 2 targeted AskUserQuestion gap-fill calls" per REQ-33.
- **AskUserQuestion per-round counts**: R1=1 block / R2=2 / R3=2 — all ≤ 4 (REQ-2, REQ-39). Each block is a single `AskUserQuestion` invocation; list items inside one block are option choices, not separate calls.

## Minor observations (non-blocking)

- `metta-discovery.md:35` says "WebSearch is restricted to gap-filling empty fields" — wording is slightly narrower than spec REQ-26 (which says "R2 and R3 gap-filling"), but semantically equivalent since R2/R3 content arrives in XML or as empty fields.
- The test's R3 "section" (via lookahead split) tails into steps 3-6 of SKILL.md because there is no terminating heading. No false positives result — WebSearch still appears in the true R3 body, and the tail adds zero extra `AskUserQuestion` mentions.

## Issues

None blocking. No critical, warning, or suggestion-level correctness defects.
