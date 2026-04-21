# Tasks for fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## Batch 1 — Agent scaffolding

- [ ] **Task 1.1: Create `metta-skill-host` subagent (template + deployed, byte-identical)**
  - **Files**:
    - `src/templates/agents/metta-skill-host.md` (NEW)
    - `.claude/agents/metta-skill-host.md` (NEW, byte-identical)
    - `tests/agents-byte-identity.test.ts` (MODIFIED)
  - **Action**: Create both agent files with this exact content (byte-identical):
    ```
    ---
    name: metta-skill-host
    description: Runs a forked metta skill in an isolated context with the tools the skill needs.
    model: sonnet
    tools: Bash, AskUserQuestion, Read, Grep, Glob, Agent
    ---
    You are the subagent that hosts a single metta skill invocation. You receive the skill's content as your prompt. Execute each numbered step faithfully. When dispatching CLI calls, the guard hook allows your invocations because the Claude Code runtime sets `agent_type` to your name, satisfying the `agent_type.startsWith('metta-')` check.
    ```
    Then in `tests/agents-byte-identity.test.ts`, add `'metta-skill-host'` to the `agents` array alongside the existing entries.
  - **Verify**: `diff -q src/templates/agents/metta-skill-host.md .claude/agents/metta-skill-host.md` exits 0 with no output. `npx vitest run tests/agents-byte-identity.test.ts` passes.
  - **Done**: Both files exist, are byte-identical, and the parity test passes.

## Batch 2 — Skill frontmatter migration (parallel; depends on Batch 1)

- [ ] **Task 2.1: Add `context: fork` + `agent: metta-skill-host` to metta-issue**
  - **Files**:
    - `src/templates/skills/metta-issue/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-issue/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Bash, AskUserQuestion, Read, Grep, Glob]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-issue/SKILL.md .claude/skills/metta-issue/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

- [ ] **Task 2.2: Add `context: fork` + `agent: metta-skill-host` to metta-fix-issues**
  - **Files**:
    - `src/templates/skills/metta-fix-issues/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-fix-issues/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

- [ ] **Task 2.3: Add `context: fork` + `agent: metta-skill-host` to metta-propose**
  - **Files**:
    - `src/templates/skills/metta-propose/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-propose/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

- [ ] **Task 2.4: Add `context: fork` + `agent: metta-skill-host` to metta-quick**
  - **Files**:
    - `src/templates/skills/metta-quick/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-quick/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-quick/SKILL.md .claude/skills/metta-quick/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

- [ ] **Task 2.5: Add `context: fork` + `agent: metta-skill-host` to metta-auto**
  - **Files**:
    - `src/templates/skills/metta-auto/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-auto/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-auto/SKILL.md .claude/skills/metta-auto/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

- [ ] **Task 2.6: Add `context: fork` + `agent: metta-skill-host` to metta-ship**
  - **Files**:
    - `src/templates/skills/metta-ship/SKILL.md` (MODIFIED)
    - `.claude/skills/metta-ship/SKILL.md` (MODIFIED, byte-identical)
  - **Action**: In each file, insert two lines at the end of the existing frontmatter block (after `allowed-tools: [Read, Write, Bash, Grep, Glob]`, before the closing `---`):
    ```
    context: fork
    agent: metta-skill-host
    ```
    Preserve the entire body verbatim. Apply the identical edit to both copies.
  - **Verify**: `diff -q src/templates/skills/metta-ship/SKILL.md .claude/skills/metta-ship/SKILL.md` exits 0. `npx vitest run` passes.
  - **Done**: Both copies are byte-identical and the frontmatter contains `context: fork` and `agent: metta-skill-host`.

## Batch 3 — Hook enforcement + audit log (depends on Batch 1)

- [ ] **Task 3.1: Update `metta-guard-bash.mjs` with `classifyWithIdentity`, `SKILL_ENFORCED_SUBCOMMANDS`, `ENFORCED_SKILL_MAP`, and `appendAuditLog`**
  - **Files**:
    - `src/templates/hooks/metta-guard-bash.mjs` (MODIFIED)
    - `.claude/hooks/metta-guard-bash.mjs` (MODIFIED, byte-identical)
  - **Action**: Apply the following four targeted edits to the current 122-line hook source, then copy the result byte-identically to `.claude/hooks/metta-guard-bash.mjs`:

    **(a)** At the top of the file, extend the imports to include `appendFileSync` and `mkdirSync` from `node:fs`, and add `dirname` from `node:path` (add `import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';` replacing the current `readFileSync`-only import, and add `import { dirname } from 'node:path';`).

    **(b)** Immediately after the `BLOCKED_TWO_WORD` declaration, add:
    ```js
    // Subcommands that require a forked skill subagent (agent_type check) to bypass.
    const SKILL_ENFORCED_SUBCOMMANDS = new Set([
      'issue', 'fix-issue', 'propose', 'quick', 'auto',
      'ship', 'finalize', 'complete',
    ]);

    const ENFORCED_SKILL_MAP = new Map([
      ['issue',     '/metta-issue'],
      ['fix-issue', '/metta-fix-issues'],
      ['propose',   '/metta-propose'],
      ['quick',     '/metta-quick'],
      ['auto',      '/metta-auto'],
      ['ship',      '/metta-ship'],
      ['finalize',  '/metta-ship'],
      ['complete',  '/metta-complete'],
    ]);
    ```

    **(c)** After the existing `classify` function, add two new functions:
    ```js
    // Returns 'allow' | 'block_enforced' | 'allow_with_bypass' | 'block' | 'unknown'
    function classifyWithIdentity(inv, event) {
      const base = classify(inv);
      if (base === 'allow') return 'allow';
      if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
        const callerIsSkill = typeof event.agent_type === 'string' && event.agent_type.startsWith('metta-');
        if (inv.skillBypass && callerIsSkill) return 'allow';
        return 'block_enforced';
      }
      if (base === 'block' && inv.skillBypass) return 'allow_with_bypass';
      return base;
    }

    function appendAuditLog(event, verdict, inv, reason) {
      try {
        // Resolve project root: walk up from this file to the nearest dir containing .metta/
        let dir = dirname(new URL(import.meta.url).pathname);
        let projectRoot = null;
        for (let i = 0; i < 10; i++) {
          try {
            const candidate = dir + '/.metta';
            // Use mkdirSync in check mode — if it throws ENOENT the dir doesn't exist
            mkdirSync(candidate, { recursive: true }); // no-op if exists
            // Verify it was pre-existing by checking if we created it just now:
            // Actually just attempt the access — if we got here without error, .metta exists or was created
          } catch { /* ignore */ }
          try {
            readFileSync(dir + '/.metta', 'utf8');
          } catch (e) {
            if (e.code === 'EISDIR' || e.code === 'ENOENT') {
              if (e.code === 'EISDIR') { projectRoot = dir; break; }
            }
          }
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
        if (!projectRoot) projectRoot = process.cwd();
        const logsDir = projectRoot + '/.metta/logs';
        mkdirSync(logsDir, { recursive: true });
        const logPath = logsDir + '/guard-bypass.log';
        const entry = {
          ts: new Date().toISOString(),
          verdict: verdict === 'block_enforced' ? 'block' : verdict,
          subcommand: inv.sub ?? null,
          third: inv.third ?? null,
          skill_hint: ENFORCED_SKILL_MAP.get(inv.sub) ?? null,
          reason,
          event_keys: Object.keys(event),
        };
        appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
      } catch { /* audit log failure MUST NOT fail the hook */ }
    }
    ```

    **(d)** In `main()`, replace the existing offender-finding logic (lines 92–96) with:
    ```js
      const offender = invocations.find(inv => {
        const v = classifyWithIdentity(inv, event);
        return v !== 'allow';
      });
      if (!offender) process.exit(0);

      const verdict = classifyWithIdentity(offender, event);

      // Log allow_with_bypass (non-enforced subcommand with inline bypass) then allow through.
      if (verdict === 'allow_with_bypass') {
        appendAuditLog(event, 'allow_with_bypass', offender, 'inline bypass on non-enforced subcommand');
        process.exit(0);
      }
    ```

    Replace the existing `const verdict = classify(offender);` line and the `if (verdict === 'unknown')` block and the final `// verdict === 'block'` block with:
    ```js
      const subDisplay = `metta ${offender.sub ?? ''}${offender.third ? ' ' + offender.third : ''}`.trim();

      if (verdict === 'block_enforced') {
        const skillName = ENFORCED_SKILL_MAP.get(offender.sub) ?? '/metta-<skill>';
        appendAuditLog(event, 'block_enforced', offender, `skill-enforced block: ${event.agent_type ? 'agent_type mismatch' : 'no agent_type'}`);
        process.stderr.write(
          `metta-guard-bash: Blocked direct CLI call '${subDisplay}' — subcommand '${offender.sub}' requires skill dispatch via ${skillName}.\n` +
          `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.\n` +
          `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
        );
        process.exit(2);
      }

      if (verdict === 'unknown') {
        appendAuditLog(event, 'block', offender, 'unknown subcommand');
        process.stderr.write(
          `metta-guard-bash: Blocked unknown metta subcommand '${offender.sub}' in '${subDisplay}'.\n` +
          `Update the allowlist in metta-guard-bash.mjs if this is a legitimate read-only command.\n` +
          `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
          `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
        );
        process.exit(2);
      }

      // verdict === 'block' (non-enforced subcommand, no bypass)
      appendAuditLog(event, 'block', offender, 'direct CLI call without skill bypass');
      process.stderr.write(
        `metta-guard-bash: Blocked direct CLI call '${subDisplay}' from AI orchestrator session.\n` +
        `Use the matching /metta-<skill> skill via the Skill tool; see CLAUDE.md for the mapping.\n` +
        `If this is a skill-internal CLI call, prefix with METTA_SKILL=1.\n` +
        `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
      );
      process.exit(2);
    ```

    After completing all edits to `src/templates/hooks/metta-guard-bash.mjs`, copy it byte-identically to `.claude/hooks/metta-guard-bash.mjs`.

  - **Verify**: `diff -q src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` exits 0 with no output. Manual smoke-test: `echo '{"tool_name":"Bash","tool_input":{"command":"METTA_SKILL=1 metta issue \"x\""}}' | node src/templates/hooks/metta-guard-bash.mjs` exits 2 and stderr contains `/metta-issue` and `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands`.
  - **Done**: Both hook files are byte-identical, the new constants and functions are present, and the smoke-test assertions hold.

## Batch 4 — Unit tests for hook (depends on Batch 3)

- [ ] **Task 4.1: Extend `tests/metta-guard-bash.test.ts` with new enforcement and audit-log cases**
  - **Files**:
    - `tests/metta-guard-bash.test.ts` (MODIFIED)
  - **Action**: The existing test file uses a `for (const hookPath of HOOK_SOURCES)` loop with a `runHook` helper that accepts `(hookPath, payload, opts)`. The `bashEvent` helper produces `{ tool_name: 'Bash', tool_input: { command } }`.

    **(1)** Extend `bashEvent` to accept an optional second argument for extra event fields:
    ```ts
    function bashEvent(command: string, extra: Record<string, unknown> = {}) {
      return { tool_name: 'Bash', tool_input: { command }, ...extra }
    }
    ```

    **(2)** Extend `runHook` to accept an optional `cwd` in opts and pass it to `spawnSync`:
    ```ts
    function runHook(
      hookPath: string,
      payload: unknown,
      opts: { env?: NodeJS.ProcessEnv; rawStdin?: string; cwd?: string } = {},
    ): { code: number; stderr: string }
    ```
    Pass `cwd: opts.cwd` to `spawnSync` options when present.

    **(3)** Add imports at the top: `import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'` and `import { tmpdir } from 'node:os'`.

    **(4)** Inside the existing `for (const hookPath of HOOK_SOURCES)` loop, inside the per-hook `describe` block, add the following new test cases. Each test that writes audit logs uses a `tmpDir` created via `mkdtempSync` and cleaned up in `afterEach`. Use `import { afterEach, beforeEach } from 'vitest'` (already present) and declare a `let tmpDir: string` at the top of the describe block; initialize and clean up per test using `beforeEach`/`afterEach`.

    Cases to add:

    **(a)** Enforced subcommand + inline `METTA_SKILL=1` + no `agent_type` → blocks with exit 2; stderr contains `/metta-issue` and `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands`:
    ```ts
    it('blocks METTA_SKILL=1 metta issue when no agent_type (exit 2, names skill)', () => {
      const { code, stderr } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta issue "x"'), { cwd: tmpDir })
      expect(code).toBe(2)
      expect(stderr).toContain('/metta-issue')
      expect(stderr).toContain('Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands')
    })
    ```

    **(b)** Enforced subcommand + inline `METTA_SKILL=1` + `agent_type: 'metta-skill-host'` → allows (exit 0):
    ```ts
    it('allows METTA_SKILL=1 metta issue when agent_type is metta-skill-host (exit 0)', () => {
      const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta issue "x"', { agent_type: 'metta-skill-host' }), { cwd: tmpDir })
      expect(code).toBe(0)
    })
    ```

    **(c)** Enforced subcommand + inline `METTA_SKILL=1` + `agent_type: 'metta-issue'` → allows (any `metta-*` prefix works):
    ```ts
    it('allows METTA_SKILL=1 metta issue when agent_type is metta-issue (exit 0)', () => {
      const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta issue "x"', { agent_type: 'metta-issue' }), { cwd: tmpDir })
      expect(code).toBe(0)
    })
    ```

    **(d)** Enforced subcommand + no `METTA_SKILL=1` + no `agent_type` → blocks (existing behavior preserved):
    ```ts
    it('blocks metta issue with no bypass and no agent_type (exit 2)', () => {
      const { code } = runHook(hookPath, bashEvent('metta issue "x"'), { cwd: tmpDir })
      expect(code).toBe(2)
    })
    ```

    **(e)** Non-enforced subcommand (`metta refresh`) + inline `METTA_SKILL=1` + no `agent_type` → allows (inline bypass preserved for non-enforced):
    ```ts
    it('allows METTA_SKILL=1 metta refresh (non-enforced, inline bypass honored, exit 0)', () => {
      const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh'), { cwd: tmpDir })
      expect(code).toBe(0)
    })
    ```

    **(f)** Allowed read-only subcommand (`metta status`) → exit 0, no audit log entry written:
    ```ts
    it('allows metta status and writes no audit log entry (exit 0)', () => {
      const { code } = runHook(hookPath, bashEvent('metta status'), { cwd: tmpDir })
      expect(code).toBe(0)
      const logPath = `${tmpDir}/.metta/logs/guard-bypass.log`
      let logExists = false
      try { readFileSync(logPath, 'utf8'); logExists = true } catch { /* expected */ }
      expect(logExists).toBe(false)
    })
    ```

    **(g)** Audit log content after a block: `.metta/logs/guard-bypass.log` contains one valid JSON line with expected schema:
    ```ts
    it('appends one JSON line to guard-bypass.log on a block_enforced verdict', () => {
      runHook(hookPath, bashEvent('METTA_SKILL=1 metta issue "x"'), { cwd: tmpDir })
      const logPath = `${tmpDir}/.metta/logs/guard-bypass.log`
      const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      expect(lines.length).toBe(1)
      const entry = JSON.parse(lines[0])
      expect(entry.verdict).toBe('block')
      expect(entry.subcommand).toBe('issue')
      expect(entry.skill_hint).toBe('/metta-issue')
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(Array.isArray(entry.event_keys)).toBe(true)
      expect(entry.event_keys).toContain('tool_name')
      expect(entry.event_keys).toContain('tool_input')
    })
    ```

    **(h)** Audit log after allow-with-bypass (non-enforced + `METTA_SKILL=1`): one JSON line with `verdict: 'allow_with_bypass'`:
    ```ts
    it('appends allow_with_bypass line to guard-bypass.log for non-enforced inline bypass', () => {
      runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh'), { cwd: tmpDir })
      const logPath = `${tmpDir}/.metta/logs/guard-bypass.log`
      const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      expect(lines.length).toBe(1)
      const entry = JSON.parse(lines[0])
      expect(entry.verdict).toBe('allow_with_bypass')
      expect(entry.subcommand).toBe('refresh')
    })
    ```

    **(i)** Belt-and-suspenders `process.env.METTA_SKILL === '1'` on hook process allows any enforced subcommand:
    ```ts
    it('allows enforced subcommand when METTA_SKILL=1 is set on hook process (exit 0)', () => {
      const { code } = runHook(hookPath, bashEvent('metta issue "x"'), { env: { METTA_SKILL: '1' }, cwd: tmpDir })
      expect(code).toBe(0)
    })
    ```

  - **Verify**: `npx vitest run tests/metta-guard-bash.test.ts` — all new and existing cases pass.
  - **Done**: All nine new cases pass in both the `source` and `deployed` describe blocks.

## Batch 5 — Integration tests (depends on Batch 3)

- [ ] **Task 5.1: Extend `tests/cli-metta-guard-bash-integration.test.ts` with enforced-subcommand end-to-end cases**
  - **Files**:
    - `tests/cli-metta-guard-bash-integration.test.ts` (MODIFIED)
  - **Action**: The existing file has a `runHook` helper that builds `spawnSync('node', [HOOK_TEMPLATE_PATH], ...)` and a `bashEvent(command)` helper that returns `{ tool_name: 'Bash', tool_input: { command } }`. The existing `skill bypass end-to-end` describe block tests `METTA_SKILL=1` env-on-process bypass.

    **(1)** Extend `bashEvent` to accept an optional `agentType` parameter:
    ```ts
    function bashEvent(command: string, agentType?: string) {
      const base = { tool_name: 'Bash', tool_input: { command } }
      return agentType ? { ...base, agent_type: agentType } : base
    }
    ```

    **(2)** Extend `runHook` to accept an optional `cwd` in opts and forward it to `spawnSync`.

    **(3)** Add imports: `import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'` and `import { tmpdir } from 'node:os'` (consolidate with existing imports as needed).

    **(4)** Add a new `describe('enforced-subcommand caller-identity enforcement')` block using `beforeEach`/`afterEach` with a `tmpDir` fixture:

    - Case (a): main-session call (`agent_type` absent) of `METTA_SKILL=1 metta issue "test"` exits non-zero:
      ```ts
      it('blocks METTA_SKILL=1 metta issue from main session (no agent_type) — exit 2', () => {
        const { code, stderr } = runHook(bashEvent('METTA_SKILL=1 metta issue "test"'), { cwd: tmpDir })
        expect(code).toBe(2)
        expect(stderr).toContain('/metta-issue')
        expect(stderr).toContain('Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands')
      })
      ```

    - Case (b): skill subagent call (`agent_type: 'metta-skill-host'`) of same command exits 0:
      ```ts
      it('allows METTA_SKILL=1 metta issue from metta-skill-host subagent (agent_type present) — exit 0', () => {
        const { code } = runHook(bashEvent('METTA_SKILL=1 metta issue "test"', 'metta-skill-host'), { cwd: tmpDir })
        expect(code).toBe(0)
      })
      ```

    - Case (c): after the blocked call, `.metta/logs/guard-bypass.log` is populated:
      ```ts
      it('populates guard-bypass.log after blocked enforced-subcommand call', () => {
        runHook(bashEvent('METTA_SKILL=1 metta issue "test"'), { cwd: tmpDir })
        const logPath = `${tmpDir}/.metta/logs/guard-bypass.log`
        const content = readFileSync(logPath, 'utf8')
        expect(content.trim().length).toBeGreaterThan(0)
        const entry = JSON.parse(content.trim().split('\n')[0])
        expect(entry.verdict).toBe('block')
        expect(entry.subcommand).toBe('issue')
      })
      ```

    **(5)** Update existing tests in the `skill bypass end-to-end` describe block that test enforced subcommands (`metta propose`, `metta complete intent`, `metta finalize`, `metta issue`, `metta quick`) via inline prefix — those tests must now use the `METTA_SKILL` env-on-process path to remain valid (they already do, since they pass `env: { METTA_SKILL: '1' }` to `runHook`). No changes needed to those specific tests as they use the env-on-process belt-and-suspenders path, which is unconditional.

  - **Verify**: `npx vitest run tests/cli-metta-guard-bash-integration.test.ts` — all new and existing cases pass.
  - **Done**: Three new cases pass; existing bypass and install-wiring cases are unaffected.

## Batch 6 — CLAUDE.md documentation update (no dependencies)

- [ ] **Task 6.1: Update `CLAUDE.md` Forbidden section**
  - **Files**:
    - `CLAUDE.md` (MODIFIED)
  - **Action**: Locate the "### Forbidden" section under "## Metta Workflow". After the existing bullet "Invoking `metta quick`, `metta propose`, `metta finalize`, `metta complete`, `metta issue`, or any other `metta <cmd>` directly from an AI orchestrator session. Use the matching skill.", add a new sentence on the same line or as a follow-on note: "As of change `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill`, the `metta-guard-bash` hook enforces this at the PreToolUse layer by verifying `event.agent_type` — orchestrator direct calls to `metta issue`, `metta fix-issue`, `metta propose`, `metta quick`, `metta auto`, or `metta ship` are now hard-blocked regardless of inline `METTA_SKILL=1` prefix. Bypass attempts are logged to `.metta/logs/guard-bypass.log`." Do not modify any other section.
  - **Verify**: The file parses cleanly (no broken markdown). Only the Forbidden section bullet is changed; confirm with `grep -n 'Forbidden' CLAUDE.md` that no duplicate sections were introduced.
  - **Done**: The Forbidden section contains the new sentence; all other sections are unchanged.

## Batch 7 — Summary (depends on all prior batches)

- [ ] **Task 7.1: Write `summary.md`**
  - **Files**:
    - `spec/changes/fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill/summary.md` (NEW)
  - **Action**: Create `summary.md` enumerating every file touched in this change with a one-line rationale for each:

    - `src/templates/agents/metta-skill-host.md` — new minimal subagent definition providing the `agent:` target for `context: fork` skill migration; its name yields `event.agent_type === 'metta-skill-host'` in the hook.
    - `.claude/agents/metta-skill-host.md` — byte-identical deployed copy of the above; consumed directly by Claude Code.
    - `tests/agents-byte-identity.test.ts` — extended with `'metta-skill-host'` entry so the parity assertion covers the new agent pair.
    - `src/templates/skills/metta-issue/SKILL.md` — frontmatter gains `context: fork` + `agent: metta-skill-host` so the hook receives a non-forgeable `agent_type` when the skill dispatches `metta issue`.
    - `.claude/skills/metta-issue/SKILL.md` — byte-identical deployed copy of the above.
    - `src/templates/skills/metta-fix-issues/SKILL.md` — same frontmatter migration for the fix-issues skill.
    - `.claude/skills/metta-fix-issues/SKILL.md` — byte-identical deployed copy.
    - `src/templates/skills/metta-propose/SKILL.md` — same frontmatter migration for the propose skill.
    - `.claude/skills/metta-propose/SKILL.md` — byte-identical deployed copy.
    - `src/templates/skills/metta-quick/SKILL.md` — same frontmatter migration for the quick skill.
    - `.claude/skills/metta-quick/SKILL.md` — byte-identical deployed copy.
    - `src/templates/skills/metta-auto/SKILL.md` — same frontmatter migration for the auto skill.
    - `.claude/skills/metta-auto/SKILL.md` — byte-identical deployed copy.
    - `src/templates/skills/metta-ship/SKILL.md` — same frontmatter migration for the ship skill.
    - `.claude/skills/metta-ship/SKILL.md` — byte-identical deployed copy.
    - `src/templates/hooks/metta-guard-bash.mjs` — primary enforcement change: adds `SKILL_ENFORCED_SUBCOMMANDS`, `ENFORCED_SKILL_MAP`, `classifyWithIdentity`, and `appendAuditLog`; inline `METTA_SKILL=1` no longer bypasses enforced subcommands without a matching `agent_type`.
    - `.claude/hooks/metta-guard-bash.mjs` — byte-identical deployed copy of the hook.
    - `tests/metta-guard-bash.test.ts` — extended with nine new cases covering the block/allow matrix for enforced subcommands, audit-log output, and the belt-and-suspenders env path.
    - `tests/cli-metta-guard-bash-integration.test.ts` — extended with three end-to-end cases covering the main-session block, skill-subagent allow, and log population.
    - `CLAUDE.md` — Forbidden section updated to state that `metta-guard-bash` now hard-blocks enforced subcommands at the PreToolUse layer and names the audit log location.

  - **Verify**: File exists at the correct path and contains all entries listed above.
  - **Done**: `summary.md` is present and complete.
