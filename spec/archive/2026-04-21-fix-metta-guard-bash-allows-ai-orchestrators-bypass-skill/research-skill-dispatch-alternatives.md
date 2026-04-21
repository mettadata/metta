# Research: Skill Dispatch Alternatives for Skill-Enforced Subcommands

**Change:** fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill  
**Deliverable:** 5 (SKILL.md dispatch audit and migration)  
**Date:** 2026-04-20

---

## Affected Skills and Patterns

Grep of `METTA_SKILL=1 metta <enforced-cmd>` across both `.claude/skills/` and `src/templates/skills/` (the sets are identical):

| Skill | Enforced subcommands invoked |
|---|---|
| `metta-issue` | `issue` |
| `metta-propose` | `propose`, `complete`, `finalize` |
| `metta-quick` | `quick`, `complete`, `finalize` |
| `metta-auto` | `propose`, `complete`, `finalize` |
| `metta-plan` | `complete` |
| `metta-execute` | `complete` |
| `metta-verify` | `complete` |
| `metta-ship` | `finalize` |
| `metta-next` | `complete`, `finalize` |
| `metta-fix-issues` | `propose`, `complete`, `finalize`, `fix-issue` |
| `metta-fix-gap` | `propose`, `complete`, `finalize` |

Total occurrences: 47 lines across the two trees (both trees are byte-identical per Deliverable 6 requirement, so 47 unique patterns, 94 total lines).

---

## Key Grounding Finding: What the Hook Process Can See

The `process.env.METTA_SKILL === '1'` check at line 87 of the current hook checks the **hook process's own environment**, not the inline `tool_input.command` string. The Claude Code runtime is the only entity that can set environment variables on the hook process before the hook runs. An orchestrator writing `METTA_SKILL=1 metta issue ...` sets the env var on the Bash subprocess that *would* run `metta`, not on the hook process itself. These are different processes.[^1]

The Claude Code documentation does **not** document any env var like `METTA_SKILL` being set by the runtime on the hook process.[^1][^2] The only documented env vars set on hook processes are `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_ENV_FILE` (SessionStart/CwdChanged/FileChanged hooks only), and `CLAUDE_CODE_REMOTE`. However, `CLAUDE_ENV_FILE`-persisted variables written in earlier hooks *are* available to later hooks in the same session, so a SessionStart hook for the skill could write `METTA_SKILL=1` to `$CLAUDE_ENV_FILE`, making it available in subsequent hook invocations.

The PreToolUse payload *does* include `agent_id` and `agent_type` fields when the hook fires inside a subagent.[^1] For a skill invoked with `context: fork`, the `agent_type` would reflect the agent name (e.g., `"general-purpose"` or a custom agent). For inline skill execution (no `context: fork`), these fields are absent, meaning a skill running inline in the main session is indistinguishable from a top-level orchestrator at the payload level.

**Critical implication:** The current metta skills do NOT use `context: fork` frontmatter. They run inline. An inline skill's Bash tool calls produce a PreToolUse payload identical to an orchestrator's Bash tool calls — no `agent_type`, no `agent_id`. Therefore `agent_type`-based verification is not viable for the current skill architecture without adding `context: fork` to every skill.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-04-20  
[^2]: https://code.claude.com/docs/en/skills accessed 2026-04-20

---

## The Five Alternatives

### Alternative 1: `.claude/hooks/metta-skill-dispatch.mjs` wrapper

Skills call `node .claude/hooks/metta-skill-dispatch.mjs <subcommand> <args>`. The dispatcher script sets `process.env.METTA_SKILL = '1'` internally and then `execSync`s the metta binary. The hook inspects `tool_input.command` and does not see the string `metta <enforced-cmd>` as the leading token; it sees `node .claude/hooks/metta-skill-dispatch.mjs`.

**Can orchestrator replicate trivially?** Yes. The orchestrator reads `.claude/hooks/metta-skill-dispatch.mjs`, learns the dispatch pattern, and calls `node .claude/hooks/metta-skill-dispatch.mjs issue "foo"`. One line of Bash. No harder than today's `METTA_SKILL=1 metta issue "foo"`.

**CLI changes required?** No. Hook + SKILL.md changes only.

**Breaks existing skill tests?** Yes. Any test that checks for the `METTA_SKILL=1 metta <cmd>` literal in SKILL.md output or traces CLI invocations via the binary would need updating. The dispatch path changes from `metta` binary to `node` invocation.

**Operational cost:** One new file (`.mjs` wrapper), both trees need SKILL.md edits (47 occurrences), and `src/templates/hooks/` grows an extra file that must be copied to `.claude/hooks/` at install time and kept in lockstep.

**Verdict:** Weak. Forgeable in one line. Adds files and complexity for no meaningful security gain.

---

### Alternative 2: Session-scoped token file `.metta/.skill-session-<random>.lock`

The skill's first step writes a lock file with a 5-minute TTL. The hook reads the file, verifies TTL and a HMAC-style token pattern, and allows the bypass only if a valid lock exists. On allowed exit the hook deletes or marks the lock consumed.

**Can orchestrator replicate trivially?** With mild effort. The orchestrator can write the same lock file before calling the blocked subcommand. The file format is inspectable. A TTL check adds time-based friction but not crypto-strength verification. Lock consumption (delete after first use) would prevent replaying a skill's lock, but the orchestrator can simply write a new lock.

**CLI changes required?** No. Hook + SKILL.md changes only. The hook grows a file-read path.

**Breaks existing skill tests?** Yes, significantly. Tests must simulate lock file creation; integration tests need filesystem fixtures per invocation.

**Operational cost:** High. Every skill gains a setup step. Lock files can accumulate if skills abort mid-run. Cleanup logic needed. Race conditions if two skill invocations overlap.

**Verdict:** Reject. Higher implementation cost than the threat model justifies, still forgeable, and adds runtime fragility (stale locks, races).

---

### Alternative 3: Direct Node import via sub-shell

Skills invoke the CLI as `node -e "import('/abs/path/to/dist/cli/index.js').then(m => m.main([...]))"`. The hook tokenizer sees `node` as the leading token and does not inspect the embedded import path for `metta` subcommands.

**Can orchestrator replicate trivially?** Yes, once the path is known. The orchestrator reads SKILL.md to learn the path, then copies the pattern verbatim.

**CLI changes required?** Yes, in a subtle way: `src/cli/index.js` must export a `main(argv)` function that accepts an argv array, and the function must be usable outside the normal `process.argv` context. This is a CLI internals change.

**Breaks existing skill tests?** Yes. The `METTA_SKILL=1 metta <cmd>` pattern disappears from SKILL.md; test assertions on that string break. The absolute path to `dist/cli/index.js` is brittle: it changes if the build output directory changes, and it is wrong in source-form installs where `dist/` may not yet exist.

**Operational cost:** High fragility cost. Path must be resolved dynamically (e.g., by reading `package.json` from `${CLAUDE_SKILL_DIR}` upward). Node ESM dynamic import inside `-e` is awkward to quote correctly, especially with multi-arg arrays.

**Verdict:** Reject. Brittle path coupling, requires CLI surface change, still forgeable.

---

### Alternative 4: `METTA_INTERNAL=1` env-var plus `.metta/.skill-allow.json` allowlist

Hook checks (a) inline env includes `METTA_INTERNAL=1` AND (b) `.metta/.skill-allow.json` lists the subcommand as allowed for skill-internal invocation. File is maintained by the team and committed to the repo.

**Can orchestrator replicate trivially?** Yes. `.metta/.skill-allow.json` is version-controlled and readable. The orchestrator includes `METTA_INTERNAL=1` in the command and the allowlist is always present. This is identical in security posture to the current `METTA_SKILL=1` check — just with an extra file read.

**CLI changes required?** No. Hook + SKILL.md changes only.

**Breaks existing skill tests?** Partially. `METTA_SKILL=1` → `METTA_INTERNAL=1` in SKILL.md text; allowlist fixture needed in tests.

**Operational cost:** Adds one config file and a file-read in the hook's hot path on every Bash event. Documentation value: the allowlist makes permitted subcommands explicit. But this documents the loophole, it doesn't close it.

**Verdict:** Reject. Same forgeability as current state with added complexity.

---

### Alternative 5: Accept trust-based model; rely on `process.env.METTA_SKILL` from `$CLAUDE_ENV_FILE`

Stop trying to prevent forging at the command-string layer. Instead, establish a reliable non-forgeable signal from the Claude Code runtime.

The mechanism: add a `hooks` stanza to each skill's SKILL.md frontmatter (or a shared skill-scoped SessionStart hook) that writes `METTA_SKILL=1` to `$CLAUDE_ENV_FILE` at skill activation time. This persists the variable into the hook process's environment for all subsequent hook invocations in that session, making `process.env.METTA_SKILL === '1'` on the hook process true. The hook's existing line 87 (`if (process.env.METTA_SKILL === '1') process.exit(0)`) already handles this case unconditionally and is documented in the spec as the "belt-and-suspenders path controlled by the Claude Code runtime."

An orchestrator operating outside any skill context does not have a SessionStart hook that writes `METTA_SKILL=1` to `$CLAUDE_ENV_FILE`. The orchestrator could write to the file directly via a Bash or Write tool call before invoking the blocked subcommand — but this requires the orchestrator to (a) know the `$CLAUDE_ENV_FILE` path, (b) actively attempt an additional pre-bypass step, and (c) not have done so by accident. This is a higher barrier than the current one-token forgery.

The SKILL.md dispatch pattern remains unchanged: `METTA_SKILL=1 metta <cmd>`. The inline `METTA_SKILL=1` on the command string is irrelevant for the enforced subcommands (blocked by the new hook logic). The actual bypass comes from `process.env.METTA_SKILL` being set on the hook process by `$CLAUDE_ENV_FILE`. The inline prefix retains its role only for non-enforced blocked subcommands (`fix-gap`, `refresh`, `import`, `init`) per the spec's requirement to preserve that bypass for subcommands not in `SKILL_ENFORCED_SUBCOMMANDS`.

**Can orchestrator replicate trivially?** Harder than current state. Requires writing `METTA_SKILL=1` to `$CLAUDE_ENV_FILE` via a Bash or Write call before the blocked invocation. This is an observable multi-step action (the pre-write appears in the transcript) rather than a silent one-token prefix. Still technically forgeable by a determined orchestrator.

**CLI changes required?** No. Hook unchanged beyond the new `SKILL_ENFORCED_SUBCOMMANDS` fail-closed logic. SKILL.md frontmatter gains a `hooks` stanza per skill.

**Breaks existing skill tests?** No unit test changes. Integration tests must simulate `process.env.METTA_SKILL=1` being set (already done in the test harness at line 143 of `tests/metta-guard-bash.test.ts`). The dispatch literal `METTA_SKILL=1 metta <cmd>` in SKILL.md prose does not change.

**Operational cost:** Low. Each skill gains a small `hooks` stanza in frontmatter. No new files, no new build artifacts, no new processes.

---

## Evaluation Matrix

| Alternative | Forgeable by orchestrator | CLI changes | Breaks skill tests | Operational cost |
|---|---|---|---|---|
| 1. Dispatch wrapper script | Yes (trivially) | No | Yes | Medium (new file, lockstep) |
| 2. Session token file | Yes (with effort) | No | Yes (fixtures) | High (race risk, cleanup) |
| 3. Node import direct | Yes (trivially) | Yes (export main) | Yes (path brittleness) | High (fragile paths) |
| 4. METTA_INTERNAL + allowlist | Yes (trivially) | No | Minor (rename token) | Low-medium (extra file read) |
| 5. CLAUDE_ENV_FILE + process.env | Harder (multi-step) | No | No | Low (frontmatter only) |

---

## Recommendation: Alternative 5

**Use `$CLAUDE_ENV_FILE` to persist `METTA_SKILL=1` into the hook process environment via a per-skill SessionStart hook stanza. The SKILL.md dispatch literal is unchanged. No new dispatch pattern is introduced.**

Justification:

1. The spec (spec.md line 24, stories.md US-2) explicitly designates `process.env.METTA_SKILL === '1'` as "the belt-and-suspenders path controlled by the Claude Code runtime" and mandates it be preserved unconditionally. Alternative 5 is the only approach that exercises this exact path with a mechanism the runtime supports.

2. No SKILL.md dispatch pattern changes. The 47 occurrences of `METTA_SKILL=1 metta <cmd>` in skill files remain as documentation of what command runs; the inline prefix continues to serve non-enforced subcommands. Zero risk of regressing working dispatch patterns.

3. Forgeability increases friction meaningfully: an orchestrator must emit an observable two-step sequence (write to `$CLAUDE_ENV_FILE`, then invoke the blocked command) instead of a zero-cost inline token. The transcript records the pre-write, making bypass attempts detectable via the audit log.

4. All required changes fit in SKILL.md frontmatter and the new hook enforcement logic (Deliverable 2). No new files, no CLI surface changes, no build process changes.

5. The implementation path is clear. Each skill's frontmatter gains a `hooks` stanza of the form:

   ```yaml
   hooks:
     SessionStart:
       - type: command
         command: 'printf "METTA_SKILL=1\n" >> "$CLAUDE_ENV_FILE"'
   ```

   The hook's line 87 (`if (process.env.METTA_SKILL === '1') process.exit(0)`) handles the rest without modification.

**Open question for implementation phase:** Verify empirically that variables written to `$CLAUDE_ENV_FILE` by a skill's SessionStart hook are present in `process.env` of hook processes fired during that same skill session. If the Claude Code runtime does not propagate `$CLAUDE_ENV_FILE` writes to hook processes (the bug report[^3] suggests env var plumbing has had issues), fall back to Alternative 1 but accept its forgeability as a known limitation and document it in CLAUDE.md.

[^3]: https://github.com/anthropics/claude-code/issues/9567 accessed 2026-04-20
