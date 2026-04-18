# Review: fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

Three parallel reviewers: correctness, security, quality.

## Combined verdict: PASS

No warnings, no critical issues. One non-blocking drift flagged by the quality reviewer; logged as a separate follow-up issue (see below).

## Reviewer findings

### Correctness — PASS
- Replacement paragraph present in all five skill files; `Every subagent MUST` eradicated everywhere.
- `metta-fix-issues/SKILL.md:27` now uses `metta issues show` (plural); singular form gone from every skill.
- `metta-next/SKILL.md:22` preserves the `MUST call \`metta complete\`` obligation as its own bullet.
- `metta-product.md:4` → `tools: [Read, Write, Bash]`.
- `diff -r src/templates/skills .claude/skills` and `diff -r src/templates/agents .claude/agents` both empty.

### Security — PASS
- Granting `Bash` to `metta-product` is consistent with other stateful metta-* agents (proposer, planner, architect, executor, researcher, reviewer, verifier) — not a new permission class.
- metta-product already has a documented prompt-injection boundary (`<INTENT>...</INTENT>` treated as data, hostile-sentinel check).
- CLI typo fix takes the same slug argument; no new input path.
- All prose changes narrow (not broaden) subagent authority by centralizing commits on orchestrator.

### Quality — PASS
- Paragraph is grammatically clean; reads as one tight sentence triad (ownership → executor exception → planning-subagent exclusion).
- All five commit-ownership lines produce identical md5 `ce9059405fe88fea6cfe4badfbf8812e` — confirmed byte-identical across files.
- `metta-next/SKILL.md` reads cleanly after the split; `metta-fix-gap/SKILL.md` duplicate removed with no remnant whitespace.
- **Non-blocking drift flagged:** `src/templates/agents/metta-product.md:55` still instructs the agent body to `git add ... && git commit -m "docs(<change>): add user stories"`. This contradicts the new skill rule stating planning-artifact subagents "write files only — they do not run git." Agent-body drift vs skill-prose is out of scope for this change (user's intent focused on the skill prose + tool list). Logged as follow-up issue `metta-product-agent-body-still-instructs-git-commit-contradicts-`.

## Deferred items

- metta-product agent body still contains inline git-commit instructions (flagged above). Follow-up issue logged.
