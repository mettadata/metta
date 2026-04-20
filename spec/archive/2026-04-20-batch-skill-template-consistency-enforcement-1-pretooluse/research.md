# Research: batch-skill-template-consistency-enforcement-1-pretooluse

## Decision

Three chosen approaches, one per concern:

1. **Hook blocking strategy:** minimal command-string tokenizer — split command on whitespace, first token = `metta`, second token classifies via static map. Eliminates regex false-positives (e.g. `metta propose` inside an `echo` arg), zero dependencies, maintainable as a decision table.
2. **Skill-side bypass:** `METTA_SKILL=1` environment variable prefix — hook exits 0 when set. Zero install cost, one `process.env` check, uniform one-line prefix in every SKILL.md. Explicitly acceptable spoofability (guardrail, not security boundary).
3. **Fan-out path enforcement:** prose mandate in SKILL.md **plus** post-hoc orchestrator existence check (`test -s spec/changes/<name>/review/<persona>.md`) and `mkdir -p` pre-step. Prose-only (like the research-step fix) is insufficient because the current SKILL.md counter-instructs ("no reviewer writes to disk") — the post-hoc gate gives a loud actionable failure the orchestrator can re-spawn on.

### Approaches Considered

**A. Hook blocking strategy:**
1. Regex on `tool_input.command` — false-positive on `echo "metta propose"` and similar strings.
2. **Minimal tokenizer (selected)** — whitespace split, classify by second token, handles `FOO=bar metta ...` env prefix and `cd /foo && metta ...` chains.
3. Full shell AST parse — overkill, no dependency wanted.

**B. Skill-side bypass:**
1. **`METTA_SKILL=1` env var (selected)** — simplest, mirrors existing hook patterns.
2. Dedicated `metta-internal` binary — rejected; new install artifact, no security gain.
3. Hook-metadata flag — rejected; Claude Code's PreToolUse event JSON has no skill-controllable metadata field per current docs.

**C. Fan-out path enforcement:**
1. Prose-only mandate — worked for research; risky for review/verify because SKILL.md currently counter-instructs ("no reviewer writes to disk").
2. **Prose + post-hoc existence check + `mkdir -p` (selected)** — actionable failure signal reuses the numbered-`MUST`-bullets pattern already in the implementation batch self-check.
3. `<OUTPUT_FILE>` tags — helpful for humans, no runtime guarantee beyond Approach 2.

### Rationale

The three approaches compose cleanly: tokenizer hook gives O(1) classification with no false positives; env var bypass is a one-liner that every SKILL.md can set identically; prose-plus-check is the minimum mechanism needed to override the SKILL.md's existing "reviewers don't write to disk" bias.

### Artifacts Produced

- [Hook Strategy Research](research-hook-strategy.md)
- [Bypass Mechanism Research](research-bypass-mechanism.md)
- [Fan-out Path Enforcement Research](research-fanout-path-enforcement.md)

### Implementation notes for tasks.md

- `src/templates/hooks/metta-guard-bash.mjs`: tokenizer with static `{ blocked: Set, allowed: Set }` plus env-var bypass check at top; mirror the stdin/stderr/exit-2 pattern of `metta-guard-edit.mjs`.
- `src/templates/skills/metta-propose/SKILL.md` review step 5 + verify step 6: rewrite with (a) prose naming `spec/changes/<name>/review/<persona>.md` / `.../verify/<aspect>.md`, (b) numbered `MUST` bullets matching the implementation-batch self-check style, (c) `mkdir -p` pre-step in the orchestrator instructions, (d) post-hoc `test -s` check, (e) explicit "`/tmp` is forbidden" statement.
- Three skills need env-var prefix updates for skill-internal CLI calls: `metta-issue` (one call site), `metta-propose` (three call sites), `metta-quick` (one call site) — per the bypass-research finding. Track as Out-of-Scope for this change if we only want to land the hook + path fix here; include if we want the bypass operational on day one.

### Scope confirmation

The user's intent explicitly scoped this change to: the hook, the `metta-propose` review step, and the `metta-propose` verify step. Applying the env-var prefix to `metta-issue` and `metta-quick` SKILL.md is technically required for the bypass to work when those skills drive the CLI — recommend including at minimum the call sites that would be blocked by the hook on day one, to avoid shipping a broken state. The design doc will make this concrete.
