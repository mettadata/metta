PASS_WITH_WARNINGS

# Security Review: metta-uat-runner-skill-execute-change-s-generated-uat-md

Scope: `git diff main...HEAD -- ':!spec/changes'` — skill pair, agent pair, uat.md template, docs/workflows/state.md, tests. Threat model: prompt injection via UAT document content, command injection via Run: hints, guard-hook bypass, privilege escalation through the metta trust model.

Architectural context verified against `.claude/hooks/metta-guard-bash.mjs`: `isTrustedSkillCaller` (line 128-130) trusts any `agent_type` starting with `metta-`, and the offender loop (lines 208-232) authorizes Tier-1, Tier-2, AND unknown-classified metta subcommands for such callers. `metta-uat-runner` therefore receives full metta CLI authority at the hook layer; every constraint below is contract-only. This is pre-existing architecture, not introduced by this change, but it makes the completeness of the runner's contract blocklist load-bearing.

## Findings

### Warnings (should fix)

- **warning** — `src/templates/agents/metta-uat-runner.md:17` (and byte-identical `.claude/agents/metta-uat-runner.md:17`) — The "Execute only the step's stated commands" blocklist is incomplete relative to the guard's blocked/unknown sets. Missing: `verify` (guard-blocked at metta-guard-bash.mjs line 45 precisely because it executes gate commands — a malicious `Run: metta verify` reads as "read-only-ish" under the current wording), the two-word mutating forms `roadmap add/reorder/next` (guard-blocked, line 53), and `gaps remove` (classified `unknown`, which the guard also waves through for `metta-*` callers). Since the guard authorizes all of these from this agent, the contract list should match or exceed the guard's BLOCKED_SUBCOMMANDS + BLOCKED_TWO_WORD sets, and should state that unknown/unlisted metta subcommands are also forbidden (allow-list phrasing, not block-list).

- **warning** — `src/templates/agents/metta-uat-runner.md:17` — No constraint on hazardous non-metta commands carried in `Run:` hints. The contract forbids metta mutations, git, and skills, but nothing prevents a malicious step's `Run:` hint from directing network exfiltration (`curl ... | sh`, POSTing repo content), package installs (`npm install`), or destructive filesystem operations. The untrusted-data clause (line 16) covers instructions-in-prose, but `Run:` hints are by design executed verbatim, so they are the live command-injection surface. Recommend an explicit clause: no network fetches, no package installation, no writes outside the change's own scope, refuse-and-skip on suspicious hints.

- **warning** — `src/templates/skills/metta-uat/SKILL.md:22,26-30` (and `.claude` copy) — The pre-run snapshot (`git status --porcelain -- <path>`) and the post-run diff gate (`git diff -- <path>`) are both scoped to the target UAT.md only. A runner that was steered into writing or modifying ANY other file (hooks, settings, source) is never detected — the gate bounds what gets committed, not what got changed. Recommend a whole-tree `git status --porcelain` snapshot before spawn and a whole-tree comparison after return, failing if anything other than `<path>` changed.

- **warning** — `src/templates/skills/metta-uat/SKILL.md:34` — `git add <path> && git commit -m "docs(<change-name>): UAT run record"` commits the entire index, not just `<path>`. Step 2 only verifies `<path>` is clean; anything already staged before the skill run (or staged by a hostile step during the run) gets silently swept into the UAT commit, bypassing the diff sanity gate. Use `git commit -m "..." -- <path>` or verify the staged set is empty apart from `<path>` before committing.

### Notes (nice to have)

- **note** — `src/templates/agents/metta-uat-runner.md:20` — Heredoc fallback `cat <<'EOF' > <path>`: a document containing a literal `EOF` line terminates the heredoc early and truncates the file. The orchestrator's diff gate would catch the damage post hoc (deleted lines → refuse commit), so this is integrity/DoS only, but recommending a collision-resistant delimiter (e.g. `METTA_UAT_DOC_EOF`) closes it cheaply.

- **note** — `src/templates/skills/metta-uat/SKILL.md:38` — Injection relay chain: failed-step "Expected/Observed" strings originate in UAT document content, flow through the runner's return message into `/metta-issue` descriptions, and land in `spec/issues/*.md` where future `/metta-fix-issues` sessions read them. The orchestrator should treat runner-returned failure text as data when authoring issues (quote, do not act on it).

- **note** — `src/templates/agents/metta-uat-runner.md:24` — The "Superseded header note" instructs the agent to disregard an in-document integrity sentence ("Do not edit this document..."). Justified and narrowly scoped here, but it establishes a precedent of contract-over-document overrides; keep such overrides pinned to exact quoted sentences as done.

- **note** — `src/templates/skills/metta-uat/SKILL.md:14` — No-argument zero-candidate fallback silently selects the newest archive's UAT.md and executes its steps (arbitrary commands) without confirming the target with the user. Low risk since the user invoked the skill, but a one-line "about to run archived UAT for <slug>, dated <date>" confirmation would remove surprise execution of stale scripts.

## Confirmed sound

- Injection-defense clause present in BOTH the agent body (agent line 16, explicitly including prior run records — the attacker-influenceable-via-previous-runs surface) and the skill's spawn prompt contract (skill line 23). Wording is consistent across the pair.
- Heredoc fallback "targeting the exact same path" constraint is stated (agent line 20), reinforced by "You write results to `UAT.md` only — no other file or path" (agent line 68) and the skill's `uat_path` framing (skill line 19).
- Runner is contractually forbidden git (agent line 18) and skill invocations (agent line 19); commit and issue-logging stay with the orchestrator (skill lines 32-38). Skill self-limits to `metta status --json` (skill line 8).
- Post-run gate's sanctioned-region definition (checkbox flips before the first run heading; purely appended single new run section) refuses any other modified/deleted line and leaves the tree intact for inspection — a genuine damage bound for the committed artifact.
- Template/deployed byte-identity and frontmatter constraints (tools exactly `[Read, Bash, Edit]`, no `model:` field, no `context: fork`, no `hooks:`) are test-enforced in `tests/cli-skills.test.ts:215-245`.
- No secrets, no new network calls, no permission/settings/hook changes anywhere in the diff. `docs/workflows/state.md:225` accurately narrows the archive-immutability exception to checkbox state + appended run records.

## Verdict

PASS_WITH_WARNINGS — no critical findings. The four warnings share one theme: the guard hook grants this runner full metta authority, so contract completeness and whole-tree verification are the actual security boundary; each warning is a small wording/scoping fix in the skill or agent markdown.
