# Tasks: fix-forked-skill-agent-dispatch-orphaning-recurred-after

<!--
Requirement / user-story -> task map (see spec.md, research.md, design.md):

- R1 "Fork Dispatch Completion Guarantee" (US-1, US-2, mechanism-(b) forced-synchronous
  branch) -> Task 1.1 (hook implementation), Task 1.2 (hook unit tests),
  Task 2.1 (frontmatter wiring that scopes the hook to metta-skill-host), Task 4.1 (sweep + proof).
- R2 "Truthful Fork Results" (US-2) -> Task 2.1 (Synchronous completion hard rule +
  recovery-protocol section jointly establish that in-progress narration is a failed,
  non-terminal result), Task 4.1 (grep proof).
- R3 "Residual Orphaning Recovery Protocol Is Codified in Every Fork Contract" (US-3) ->
  Task 2.1 (protocol section in metta-skill-host.md + one-line pointer in all six fork
  skills), Task 4.1 (grep proof of presence in every contract).
- R4 "Fork-Dispatch Enforcement Events Are Recorded" (US-4) -> Task 1.1 (duplicated
  appendAuditLog + reason/tier schema), Task 1.2 (audit-log assertions), Task 3.1
  (documents that recovery invocations are contractually, not mechanically, recorded —
  consistent with design.md's Observability section).
- Live-experiment task from design.md's "Live experiment" API Design section (US-1
  mechanism verification for the deferred SubagentStop-ledger Approach A; ledger is
  NOT built in this change) -> Task 3.1.
-->

## Batch 1: New PreToolUse hook — `metta-guard-agent-dispatch.mjs`

### 1.1 [x] Create the `metta-guard-agent-dispatch.mjs` hook (template + deployed)

**Files:**
- `src/templates/hooks/metta-guard-agent-dispatch.mjs` (new)
- `.claude/hooks/metta-guard-agent-dispatch.mjs` (new)

**Action:**
Create both files with byte-identical content (mirror `src/templates/hooks/metta-guard-bash.mjs`'s / `.claude/hooks/metta-guard-bash.mjs`'s existing template/deployed pairing discipline). Make both executable (`chmod +x`) with a `#!/usr/bin/env node` shebang, matching the mode bits of the existing hook files (`rwxr-xr-x`).

Implement exactly the behavior design.md specifies (do not invent additional checks):

1. Read stdin (`readFileSync(0, 'utf8')`), swallow read errors, exit 0 on empty stdin.
2. `JSON.parse` the payload; on any parse error, exit 0 (fail-open on malformed input — same pattern as `metta-guard-bash.mjs`'s `main()`).
3. If `event.tool_name !== 'Agent'`, exit 0 (the hook only ever inspects `Agent` tool calls).
4. If `event.tool_input?.run_in_background === true` (strict `===` against the boolean literal `true` — nothing else), this is the sole reject condition:
   - Write one audit-log entry (see schema below).
   - Write a stderr message that: names the hook (`metta-guard-agent-dispatch:`), states a backgrounded `Agent` dispatch was blocked, cites `event.agent_type` if present, quotes the design's required instruction to the fork — explicitly tell the fork to **wait for the outstanding dispatched child before returning** rather than merely rejecting with no guidance (this satisfies spec.md's "Truthful Fork Results" scenario "The enforcement reason instructs the fork to wait rather than return early"), points at the `Synchronous completion (hard rule)` / recovery-protocol sections of `metta-skill-host.md`, and notes the emergency bypass (`.claude/settings.local.json`, or removing the `hooks:` entry from `.claude/agents/metta-skill-host.md`).
   - `process.exit(2)`.
5. Every other shape — `run_in_background` absent, `false`, or any non-boolean/renamed value (e.g. a future harness renaming the field) — passes through unmodified: no audit-log entry, `process.exit(0)`. This is the deliberate fail-open behavior design.md's "Harness version drift" risk describes: the hook checks exactly one field name; anything it does not recognize as the literal reject shape is allowed through undetected, and the residual gap is covered by the Layer-3 recovery protocol (Task 2.1), not by this hook.
6. Do **not** branch on `event.agent_type` for authorization — this hook is scoped to `Agent` calls solely by being declared in `metta-skill-host.md`'s own `hooks:` frontmatter (wired in Task 2.1), not by a global `.claude/settings.json` registration. Frontmatter registration is itself the caller-identity boundary (design.md "Components"). Still read `event.agent_type` into the audit entry for forensic value, per design.md.
7. **Reject, not rewrite.** Never attempt to mutate `tool_input` (e.g. flip `run_in_background` to `false`) — no `PreToolUse` mutation output is documented; only block/allow are available.

**Duplicated `appendAuditLog` helper** — reimplement inline (do not import from `metta-guard-bash.mjs` or any shared `.claude/hooks/lib/` module; design.md is explicit that duplication is the correct choice here). Append one JSON line to `<cwd>/.metta/logs/guard-bypass.log` (same file `metta-guard-bash.mjs` already writes) with exactly this shape on a block:

```json
{
  "ts": "<ISO-8601 timestamp>",
  "verdict": "block",
  "subcommand": null,
  "third": null,
  "tool_name": "Agent",
  "agent_type": "<event.agent_type ?? null>",
  "subagent_type": "<event.tool_input?.subagent_type ?? null>",
  "reason": "rejected-async-agent-dispatch",
  "tier": "fork",
  "event_keys": ["<Object.keys(event)>"]
}
```

`subcommand`/`third` are `null` (this hook does not classify CLI subcommands — schema parity with `metta-guard-bash.mjs`'s existing JSONL entries, per design.md's Data Model section). Swallow all I/O errors in the audit-log write (`mkdirSync` + `appendFileSync` wrapped in try/catch) so a logging failure never breaks the enforcement path — same discipline as `metta-guard-bash.mjs:139-158`.

**Verify:**
```bash
node --check /home/utx0/Code/metta/src/templates/hooks/metta-guard-agent-dispatch.mjs
node --check /home/utx0/Code/metta/.claude/hooks/metta-guard-agent-dispatch.mjs
diff /home/utx0/Code/metta/src/templates/hooks/metta-guard-agent-dispatch.mjs /home/utx0/Code/metta/.claude/hooks/metta-guard-agent-dispatch.mjs
test -x /home/utx0/Code/metta/src/templates/hooks/metta-guard-agent-dispatch.mjs
test -x /home/utx0/Code/metta/.claude/hooks/metta-guard-agent-dispatch.mjs
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"metta-executor","run_in_background":true},"agent_type":"metta-skill-host"}' | node /home/utx0/Code/metta/.claude/hooks/metta-guard-agent-dispatch.mjs; echo "exit=$?"
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"metta-executor"}}' | node /home/utx0/Code/metta/.claude/hooks/metta-guard-agent-dispatch.mjs; echo "exit=$?"
```
First manual run MUST print `exit=2`; second MUST print `exit=0`. `diff` MUST produce no output. `node --check` MUST print nothing (exit 0) for both files.

**Done:** Both hook files exist, are byte-identical, executable, pass `node --check`, and implement exactly the reject-on-`run_in_background===true` / fail-open-on-everything-else behavior described above with no `tool_input` mutation.

---

### 1.2 [x] Hook unit tests — `tests/metta-guard-agent-dispatch.test.ts`

**Files:**
- `tests/metta-guard-agent-dispatch.test.ts` (new)

**Action:**
Mirror the structure of `tests/metta-guard-bash.test.ts` (`spawnSync('node', [hookPath], { input, cwd, ... })`, a `HOOK_SOURCES` array of both the template and deployed hook paths so every case runs against both, a shared temp-dir sandbox with `afterAll` cleanup so audit-log writes never pollute the real repo tree, and a final top-level byte-identity assertion between the two `HOOK_SOURCES` files). Add an `agentEvent(overrides)` helper analogous to `bashEvent()` that builds `{ tool_name: 'Agent', tool_input: { subagent_type, run_in_background }, agent_type, cwd }` payloads.

Cover, for **both** hook sources (source + deployed), driven by synthetic stdin payloads only — no live Claude Code runtime:

1. **Background dispatch is rejected.** `tool_name: 'Agent'`, `tool_input.run_in_background: true`, `agent_type: 'metta-skill-host'` -> exit code `2`; stderr mentions the block and instructs waiting for the outstanding child (assert stderr contains a wait/retry instruction, not just a bare rejection).
2. **Audit record on rejection.** Same payload run with a fresh temp `cwd` -> `.metta/logs/guard-bypass.log` contains exactly one JSON line with `verdict: 'block'`, `tool_name: 'Agent'`, `reason: 'rejected-async-agent-dispatch'`, `tier: 'fork'`, `subcommand: null`, `third: null`, `agent_type` and `subagent_type` matching the input, and a valid ISO-8601 `ts` field (round-trips through `new Date(ts).toISOString() === ts`).
3. **Foreground dispatch passes through.** `run_in_background` absent -> exit `0`, empty stderr, no audit-log file created in a fresh temp `cwd`.
4. **Explicit `run_in_background: false` passes through.** Same assertions as case 3.
5. **Non-`Agent` tool passes through (fail-open by tool-name filter).** `tool_name: 'Bash'` and `tool_name: 'Edit'` payloads with `run_in_background: true` present anyway -> exit `0` (the hook must not fire on any tool other than `Agent`, even if a same-named field happens to be present).
6. **Malformed/empty stdin fail-open.** Empty stdin and `rawStdin: 'not-json{'` -> exit `0` for both.
7. **Unrecognized field shape fail-open (harness-drift simulation).** `tool_input.run_in_background: "true"` (string, not boolean) and `tool_input` entirely absent -> exit `0`, no audit-log entry — proves the hook does not guess at a renamed/reshaped field, matching design.md's documented "Harness version drift" risk.
8. **`agent_type` is recorded but not required for the reject to fire.** Background dispatch with `agent_type` absent still rejects (exit `2`) — the hook's reject condition is the dispatch shape alone, per design.md's "does not branch on it" wording; only the audit entry's `agent_type` field is null in that case.
9. **Source and deployed hook are byte-identical** (top-level `it`, outside the per-source loop, same pattern as `metta-guard-bash.test.ts`'s final assertion).

**Verify:**
```bash
npx vitest run tests/metta-guard-agent-dispatch.test.ts
```
All tests pass; zero skipped.

**Done:** `tests/metta-guard-agent-dispatch.test.ts` exists, exercises both hook copies against every case above, and passes.

---

## Batch 2: Frontmatter wiring + codified recovery protocol (Layer 3, US-3)

### 2.1 [x] Wire the hook into `metta-skill-host.md` frontmatter, add the recovery-protocol section, and add the one-line pointer to all six fork skills

**Files:**
- `src/templates/agents/metta-skill-host.md`
- `.claude/agents/metta-skill-host.md`
- `src/templates/skills/metta-issue/SKILL.md`
- `.claude/skills/metta-issue/SKILL.md`
- `src/templates/skills/metta-fix-issues/SKILL.md`
- `.claude/skills/metta-fix-issues/SKILL.md`
- `src/templates/skills/metta-propose/SKILL.md`
- `.claude/skills/metta-propose/SKILL.md`
- `src/templates/skills/metta-quick/SKILL.md`
- `.claude/skills/metta-quick/SKILL.md`
- `src/templates/skills/metta-auto/SKILL.md`
- `.claude/skills/metta-auto/SKILL.md`
- `src/templates/skills/metta-ship/SKILL.md`
- `.claude/skills/metta-ship/SKILL.md`

**Action:**

**(a) Frontmatter hook wiring — `metta-skill-host.md` (both copies).** `metta-skill-host.md` currently has only `name:` and `description:` in its frontmatter. Add a `hooks:` block exactly as design.md's API Design section specifies:

```yaml
hooks:
  PreToolUse:
    - matcher: Agent
      hooks:
        - type: command
          command: .claude/hooks/metta-guard-agent-dispatch.mjs
```

Apply this identically to `src/templates/agents/metta-skill-host.md` and `.claude/agents/metta-skill-host.md` so they stay byte-identical after the edit.

**(b) Recovery-protocol section — `metta-skill-host.md` (both copies).** Immediately after the existing `### Synchronous completion (hard rule)` section (currently the file's last lines), add a new section `### Residual orphaning recovery protocol` covering, in the orchestrator's voice (this text is read by the orchestrator that dispatched the fork, not by the fork itself), all three parts spec.md's "Residual Orphaning Recovery Protocol" requirement demands:

- **(a) Detection:** any fork result that narrates in-progress or background work (e.g. "still running", "in the background", "will report back") is a failed, non-terminal result — never treat it as success.
- **(b) Wait/attach, never duplicate:** when an orphaned agent is detected, the orchestrator MUST wait for or attach to the still-running orphan; it MUST NOT dispatch a duplicate `Agent` call for the same in-flight work.
- **(c) Confirmed-dead re-dispatch:** only once the orphaned agent is confirmed dead or complete may the orchestrator dispatch fresh work, resuming from the change's persisted state (`spec/changes/<name>/`) rather than restarting from scratch.
- **Observability note (US-4):** state explicitly that recovery-protocol invocations are not mechanically logged the way a blocked dispatch or blocked stop is (design.md's Observability section) — when the orchestrator invokes this protocol it MUST note the invocation and the orphaned agent's identity in the change's commit message or artifact trail (e.g. the `metta issue` log entry or the fork's summary) so a maintainer can discern it after the fact.

**(c) One-line pointer in every fork skill.** Add exactly one line — "If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md." — to each of the six fork skills, in the file's existing rules-equivalent section (do not duplicate the protocol's full text — this is a pointer, matching how the existing "Synchronous completion (hard rule)" is inherited today rather than restated per-skill):
  - `metta-issue/SKILL.md`: under `## Rules` (~line 56).
  - `metta-fix-issues/SKILL.md`: under `## Rules` (~line 113).
  - `metta-propose/SKILL.md`: under `## Critical: You MUST verify, finalize, and merge` (~line 277) — the file has no `## Rules` heading; this is its closest rules-equivalent bullet list.
  - `metta-quick/SKILL.md`: under `## Subagent Rules` (~line 211).
  - `metta-auto/SKILL.md`: under `## Rules` (~line 86).
  - `metta-ship/SKILL.md`: under `## Rules` (~line 20).

Apply each skill's edit identically to its `src/templates/skills/<skill>/SKILL.md` and `.claude/skills/<skill>/SKILL.md` copy so template and deployed stay byte-identical.

**Verify:**
```bash
npx vitest run tests/template-deploy-sync.test.ts
grep -n "hooks:" -A6 /home/utx0/Code/metta/.claude/agents/metta-skill-host.md
grep -n "metta-guard-agent-dispatch.mjs" /home/utx0/Code/metta/.claude/agents/metta-skill-host.md /home/utx0/Code/metta/src/templates/agents/metta-skill-host.md
grep -n "Residual orphaning recovery protocol" /home/utx0/Code/metta/.claude/agents/metta-skill-host.md /home/utx0/Code/metta/src/templates/agents/metta-skill-host.md
for s in metta-issue metta-fix-issues metta-propose metta-quick metta-auto metta-ship; do
  grep -q "residual orphaning recovery protocol" /home/utx0/Code/metta/.claude/skills/$s/SKILL.md || echo "MISSING pointer: $s"
  diff /home/utx0/Code/metta/src/templates/skills/$s/SKILL.md /home/utx0/Code/metta/.claude/skills/$s/SKILL.md
done
```
`template-deploy-sync.test.ts` MUST pass in full (it auto-discovers every file under `src/templates/agents`, `skills`, `hooks`, `statusline` and asserts byte-identity with the deployed copy — no separate byte-identity test is needed for this task). No `diff` output. No "MISSING pointer" lines.

**Done:** `metta-skill-host.md` (both copies) declares the `PreToolUse`/`Agent` hook in frontmatter and carries the full recovery-protocol section; all six fork skills (both copies each) carry the one-line pointer; `template-deploy-sync.test.ts` passes.

---

## Batch 3: Live experiment — `PostToolUse` timing for a backgrounded `Agent` dispatch (US-1 mechanism verification; SubagentStop-ledger Approach A is NOT built)

### 3.1 [x] Run the live `PostToolUse` timing experiment and record findings

**Files:**
- `spec/changes/fix-forked-skill-agent-dispatch-orphaning-recurred-after/experiment-posttooluse-timing.md` (new)

**Action:**
This task produces **evidence, not production code** — per design.md's API Design section ("Live experiment (implementation task, not production code, US-1 mechanism verification)"). Do not build the `SubagentStop`-ledger design (Approach A) in this task or any other task in this change; research.md and design.md both defer it pending exactly this experiment.

1. In a real Claude Code session (not a `spawnSync` unit test — this requires actual runtime `PostToolUse` semantics, which are unverified against public docs per research.md:7,19), register a temporary diagnostic `PostToolUse` hook matched on `Agent` (e.g. a disposable script wired via `.claude/settings.local.json` so it is never committed) that appends `{ts: Date.now(), event: 'PostToolUse-Agent'}` to a scratch log file on every fire.
2. From a `metta-*`-fork caller context (e.g. dispatch through an actual fork skill, or simulate an equivalent `agent_type` caller), issue a real `Agent` call with `run_in_background` unset (the post-v2.1.198 default) to a child subagent whose prompt makes it perform an easily-timed, non-trivial amount of work (e.g. explicitly instruct it to sleep or perform N distinguishable steps taking a known number of seconds) before it returns.
3. Record three timestamps: (i) the moment the `Agent` dispatch tool call was issued, (ii) the moment the diagnostic `PostToolUse` hook fired for that call, (iii) the moment the child subagent actually completed its work (observable from its own reported output/elapsed time).
4. **Define green precisely:** PASS ("green") if and only if timestamp (ii) is close to timestamp (iii) — i.e. `PostToolUse` fires at or after the child's actual completion, with elapsed time between (i) and (ii) approximately matching the child's real work duration (not near-zero). FAIL if (ii) is close to (i) — i.e. `PostToolUse` fires near-instantly at dispatch, regardless of how long the child actually ran, which is what research.md:7,19 predicts and which would make `PostToolUse`-based ledger-clearing unsound.
5. Write the observed timestamps, the elapsed-time comparison, and an explicit `PASS` / `FAIL` verdict against the green definition above to `spec/changes/fix-forked-skill-agent-dispatch-orphaning-recurred-after/experiment-posttooluse-timing.md`.
6. **Conditional follow-up — only if PASS:** log a follow-up issue via the `/metta-issue` skill (never call the `metta issue` CLI directly — see CLAUDE.md's orchestrator-invocation rule) scoping the `SubagentStop`-ledger design (Approach A) as a future build, and record the resulting issue slug in the experiment findings file. **If FAIL** (the expected outcome per research.md): record the FAIL verdict and state explicitly that no follow-up issue is logged — the ledger approach is a closed dead end, per design.md's "no follow-up: the ledger is a closed dead end."
7. Remove the temporary diagnostic hook and its `.claude/settings.local.json` registration after the experiment completes — it must not ship as part of this change.

**Verify:**
```bash
test -f /home/utx0/Code/metta/spec/changes/fix-forked-skill-agent-dispatch-orphaning-recurred-after/experiment-posttooluse-timing.md
grep -E "PASS|FAIL" /home/utx0/Code/metta/spec/changes/fix-forked-skill-agent-dispatch-orphaning-recurred-after/experiment-posttooluse-timing.md
git status --porcelain /home/utx0/Code/metta/.claude/settings.local.json
```
The findings file exists and contains an explicit `PASS` or `FAIL` verdict with supporting timestamps. `git status` on `.claude/settings.local.json` shows no leftover diagnostic-hook registration (file absent, unchanged, or reverted).

**Done:** `experiment-posttooluse-timing.md` exists with recorded timestamps and an explicit PASS/FAIL verdict against the defined green condition; a follow-up issue was logged via `/metta-issue` if and only if the verdict is PASS; no diagnostic hook artifacts remain in the tree.

---

## Batch 4: Full verification sweep

### 4.1 [x] Run the full test/build sweep and grep-based proofs

**Files:** none (verification-only; touches no source files)

**Action:**
Run the full project verification sweep and the grep proofs below to confirm every requirement lands as specified. Do not edit any files as part of this task — if any check fails, the failure belongs to the batch that owns the broken file, not to this task.

**Verify:**
```bash
cd /home/utx0/Code/metta
npm test
npx tsc --noEmit
npm run build
node --check .claude/hooks/metta-guard-agent-dispatch.mjs
node --check src/templates/hooks/metta-guard-agent-dispatch.mjs
node --check dist/templates/hooks/metta-guard-agent-dispatch.mjs

# R3 / US-3: recovery protocol present in the host contract and every fork skill contract.
grep -ril "residual orphaning recovery protocol" .claude/agents/metta-skill-host.md src/templates/agents/metta-skill-host.md
for s in metta-issue metta-fix-issues metta-propose metta-quick metta-auto metta-ship; do
  grep -q -i "residual orphaning recovery protocol" .claude/skills/$s/SKILL.md && grep -q -i "residual orphaning recovery protocol" src/templates/skills/$s/SKILL.md || echo "FAIL: $s missing recovery-protocol pointer"
done

# R1 / US-1, US-2: hook registered in metta-skill-host.md frontmatter (not global settings.json).
grep -n "metta-guard-agent-dispatch.mjs" .claude/agents/metta-skill-host.md src/templates/agents/metta-skill-host.md
grep -q "metta-guard-agent-dispatch.mjs" .claude/settings.json && echo "FAIL: hook must NOT be registered globally" || echo "OK: not globally registered"
```
`npm test` MUST report all suites passing including `tests/metta-guard-agent-dispatch.test.ts` and `tests/template-deploy-sync.test.ts`. `npx tsc --noEmit` and `npm run build` MUST exit 0. Every `node --check` MUST exit 0 with no output. The recovery-protocol grep MUST find matches in the host file and in all twelve skill copies (no "FAIL:" lines). The hook-registration grep MUST find the command in both `metta-skill-host.md` copies and MUST print "OK: not globally registered" for `.claude/settings.json`.

**Done:** `npm test`, `npx tsc --noEmit`, and `npm run build` all pass; every hook file passes `node --check`; the recovery protocol is present in the host contract and all six fork-skill contracts (template + deployed); the new hook is scoped via `metta-skill-host.md` frontmatter only, not the global `.claude/settings.json`.
