---
name: metta:plan
description: Build planning artifacts for the active change
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-plan
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for building planning artifacts. Spawn subagents for each artifact.

## Steps

1. `metta status --json` → find which artifacts are ready
2. For each ready artifact:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona. The payload's `output_path` is an absolute path inside the checkout hosting the change, and `change_root` is that checkout's root — use them verbatim; never re-derive paths from the session cwd.
   b. **Spawn a subagent** with the right metta agent type based on the artifact (research→metta-researcher, design→metta-architect, tasks→metta-planner), the agent persona, template, output_path, and change_root
   c. Subagent writes the artifact file with real content, then git commits
   d. Token recording is automatic — a SubagentStop hook records each subagent's harness-measured usage; do not run `metta tokens record` after subagent returns. Only if the hook is unavailable, record manually: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name> --source prose`.
   e. `metta complete <artifact> --json --change <name>` → returns next artifact
3. Continue until all planning artifacts are complete
4. **Run constitution check (emit → spawn → record):**
   After all planning artifacts are committed:
   a. **Emit.** Run `metta check-constitution --change <name> --json` via Bash. This produces the check contract — capture `articles`, `spec_path`, `spec_content`, `instructions`, `output_path`, and `change_root` from the JSON. `spec_path` and `output_path` are absolute — use them verbatim from any cwd. Exit 0 here only means the contract was emitted; it is NOT a check result.
   b. **Spawn.** Spawn the `metta-constitution-checker` subagent with the emitted constitution content framed in `<CONSTITUTION>...</CONSTITUTION>` tags, the spec content framed in `<SPEC path="...">...</SPEC>` tags (from `spec_path`/`spec_content`), and the emitted `instructions` as task framing. Write its `{"violations": [...]}` output verbatim to `output_path` (create parent directories as needed).
   c. **Record.** Run `metta check-constitution --change <name> --record <output_path> --json` via Bash. Key all halt/proceed behavior on THIS invocation's exit code:
   - On exit 0: report "Constitution check passed" with the violations_path. Proceed to implementation.
   - On exit 4: read the JSON output's `violations` array. For each blocking violation (severity critical, OR major without justification), surface it to the user with the violations_path. Tell the user to either:
     (a) edit spec.md to eliminate the violation, or
     (b) for major severity only, add a `## Complexity Tracking` section (or append to existing) with a bullet `- <article>: <rationale>` justifying it. Critical violations are never justifiable — they must be removed.
   - Do NOT advance to implementation on exit 4. Halt and await user action.
   - On re-entry to this skill after user edits, the check re-runs automatically.

## Subagent Prompt

"You are: {agent.persona}

Write the file {output_path} (an absolute path — use it exactly as given) following this template:
{template}

Read existing artifacts from {change_root}/spec/changes/<change>/ for context.

Rules:
- Fill in ALL sections with real, specific content — no placeholders
- When done, run: git -C "{change_root}" add "{output_path}" && git -C "{change_root}" commit -m 'docs(<change>): create <artifact>' — always `git -C "{change_root}"` with the paths quoted, never plain git from your cwd: for a worktree-hosted change a plain `git add` would target the wrong checkout or fail with 'outside repository'
- Research: explore 2-4 approaches, recommend one, explain tradeoffs
- Design: reference spec requirements and research decisions
- Tasks: use checklist format with `- [ ] **Task 1.1: name**` followed by indented Files, Action, Verify, Done fields. Group into Batch sections."
