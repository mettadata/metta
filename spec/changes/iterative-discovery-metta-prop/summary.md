# Summary: iterative-discovery-metta-prop

Restructures discovery in `/metta-propose` and `/metta-quick` skills from one-shot AskUserQuestion into a multi-round DISCOVERY LOOP. Goal: capture 100% of requirements and resolve all ambiguity before the proposer subagent writes intent.md — no guessing.

## Behavior changes
- **`/metta-propose`**: `DISCOVERY GATE` → `DISCOVERY LOOP` with Round 1 (scope + arch, always), Round 2 (data + integration, conditional), Round 3 (edges + non-functional, conditional), Round 4+ (open-ended while ambiguity remains). Every AskUserQuestion includes the canonical exit option `I'm done — proceed with these answers`. Between-round status line: `Resolved: <A>, <B>. Open: <C> — proceeding to Round N.`
- **`/metta-quick`**: trivial-detection gate first — genuinely trivial changes (typo, single-line fix, one-file delete with no unresolved decisions) skip questions entirely. Non-trivial ones enter the same DISCOVERY LOOP.
- Cumulative answers from all rounds are passed as structured context to the proposer subagent.

## Files changed
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` (byte-identical)
- `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` (byte-identical)
- `tests/skill-discovery-loop.test.ts` (new — 11 static-content + byte-identity assertions)

## Gates
- `npm run build` — PASS
- `npx vitest run` — 383/383 PASS (was 372, +11 new)

## Out of scope
- CLI-level flags (`--deep`, `--no-discovery`).
- Persisting answers on disk.
- Applying the loop to other skills (init, fix-issues, etc.).
