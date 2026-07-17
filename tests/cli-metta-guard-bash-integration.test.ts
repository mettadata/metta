import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFile } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

// End-to-end integration tests for the metta-guard-bash PreToolUse hook.
//
// These tests spawn the hook as a real subprocess (piping synthetic Claude
// PreToolUse event JSON on stdin) and exercise the hook <-> install wiring
// seam end-to-end. Unit-level coverage of the classifier lives in
// tests/metta-guard-bash.test.ts; this file focuses on:
//   1. The retired METTA_SKILL mechanisms (hook-process env var and inline
//      command prefix) credit nothing — Tier-1 calls are authorized by the
//      verified fork caller identity (event.agent_type) alone.
//   2. Direct metta CLI calls (no trusted caller, no session credential) are
//      blocked with exit 2 and a stderr message pointing to the matching skill.
//   3. `metta install` wires the hook into .claude/settings.json exactly once
//      (idempotent across repeated installs).
//
// Note on scope: the byte-identical copy check for
// `.claude/hooks/metta-guard-bash.mjs` vs the template is already covered by
// `tests/cli.test.ts` ("copies metta-guard-bash.mjs byte-identical to the
// template"), so it is intentionally omitted here to avoid duplication.

const execAsync = promisify(execFile)

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')
const HOOK_TEMPLATE_PATH = join(
  import.meta.dirname,
  '..',
  'src',
  'templates',
  'hooks',
  'metta-guard-bash.mjs',
)

function runHook(
  payload: unknown,
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): { code: number; stderr: string; stdout: string } {
  const env = { ...process.env, ...(opts.env ?? {}) }
  // The retired METTA_SKILL env bypass is ignored by the hook; strip any value
  // inherited from the outer test process unless the test explicitly opts in
  // (tests opt in only to prove the retired variable is inert).
  if (!('METTA_SKILL' in (opts.env ?? {}))) {
    delete env.METTA_SKILL
  }
  const result = spawnSync('node', [HOOK_TEMPLATE_PATH], {
    input: JSON.stringify(payload),
    env,
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.cwd,
  })
  return {
    code: result.status ?? -1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

function bashEvent(
  command: string,
  extra: { agent_type?: string; cwd?: string; run_in_background?: boolean } = {},
): Record<string, unknown> {
  const toolInput: Record<string, unknown> = { command }
  if (extra.run_in_background !== undefined) toolInput.run_in_background = extra.run_in_background
  const event: Record<string, unknown> = { tool_name: 'Bash', tool_input: toolInput }
  if (extra.agent_type !== undefined) event.agent_type = extra.agent_type
  if (extra.cwd !== undefined) event.cwd = extra.cwd
  return event
}

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync('npx', ['tsx', CLI_PATH, ...args], {
      cwd,
      timeout: 15_000,
    })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('metta-guard-bash integration', { timeout: 60_000 }, () => {
  describe('retired METTA_SKILL env bypass end-to-end', () => {
    it('blocks metta propose even with METTA_SKILL=1 set on the hook process (exit 2)', () => {
      const { code } = runHook(bashEvent('metta propose "foo"'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(2)
    })

    it('blocks metta finalize even with METTA_SKILL=1 set on the hook process (exit 2)', () => {
      const { code } = runHook(bashEvent('metta finalize'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(2)
    })
  })

  describe('Tier-1 agent-identity-only authorization end-to-end', () => {
    it('allows bare metta propose from agent_type=metta-skill-host (exit 0)', () => {
      const { code, stderr } = runHook(
        bashEvent('metta propose "foo"', { agent_type: 'metta-skill-host' }),
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('allows bare metta ship --change x from agent_type=metta-skill-host (exit 0)', () => {
      const { code, stderr } = runHook(
        bashEvent('metta ship --change x', { agent_type: 'metta-skill-host' }),
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('allows metta next --json without any credential (read-only allowlist) (exit 0)', () => {
      const { code, stderr } = runHook(bashEvent('metta next --json'))
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })
  })

  describe('direct CLI blocked end-to-end', () => {
    it('blocks `metta propose` without METTA_SKILL — exit 2, stderr names the matching skill and instructs to use it', () => {
      const { code, stderr } = runHook(bashEvent('metta propose "foo"'))
      expect(code).toBe(2)
      expect(stderr).toContain('/metta-')
      expect(stderr).toContain('Use the matching')
      expect(stderr).toContain('skill')
    })
  })

  describe('caller-identity enforcement end-to-end', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'metta-guard-int-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('blocks main-session direct call with inline METTA_SKILL=1 and no agent_type — exit 2, stderr names /metta-issue', () => {
      const { code, stderr } = runHook(
        bashEvent('METTA_SKILL=1 metta issue "test"', { cwd: tempDir }),
        { cwd: tempDir },
      )
      expect(code).toBe(2)
      expect(stderr).toContain('/metta-issue')
    })

    it('allows subagent dispatch when event carries agent_type=metta-skill-host — exit 0', () => {
      const { code } = runHook(
        bashEvent('metta issue "test"', {
          agent_type: 'metta-skill-host',
          cwd: tempDir,
        }),
        { cwd: tempDir },
      )
      expect(code).toBe(0)
    })

    it('audit log records block verdict for orchestrator attempt and no block verdict for subagent attempt', () => {
      // (a) Orchestrator attempt — no agent_type, should block and log verdict=block.
      // The legacy inline prefix credits nothing.
      const blocked = runHook(
        bashEvent('METTA_SKILL=1 metta issue "test"', { cwd: tempDir }),
        { cwd: tempDir },
      )
      expect(blocked.code).toBe(2)

      // (b) Subagent attempt — trusted agent_type alone authorizes the bare call.
      const allowed = runHook(
        bashEvent('metta issue "test"', {
          agent_type: 'metta-skill-host',
          cwd: tempDir,
        }),
        { cwd: tempDir },
      )
      expect(allowed.code).toBe(0)

      const logPath = join(tempDir, '.metta', 'logs', 'guard-bypass.log')
      expect(existsSync(logPath)).toBe(true)
      const logRaw = readFileSync(logPath, 'utf8')
      const lines = logRaw.split('\n').filter((l) => l.trim().length > 0)
      expect(lines.length).toBeGreaterThanOrEqual(1)

      const entries = lines.map((l) => JSON.parse(l) as { verdict: string; subcommand: string | null; agent_type: string | null })

      // The orchestrator attempt MUST have produced a 'block' verdict entry.
      const blockEntries = entries.filter((e) => e.verdict === 'block')
      expect(blockEntries.length).toBeGreaterThanOrEqual(1)
      expect(blockEntries[0].subcommand).toBe('issue')
      expect(blockEntries[0].agent_type).toBe(null)

      // The subagent attempt (agent_type=metta-skill-host) MUST NOT have produced a 'block' entry.
      const blockEntriesForTrusted = entries.filter(
        (e) => e.verdict === 'block' && e.agent_type === 'metta-skill-host',
      )
      expect(blockEntriesForTrusted.length).toBe(0)
    })
  })

  describe('Tier-2 session-credential validation end-to-end', () => {
    const TTL_MS = 300_000
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'metta-guard-tier2-int-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    function seedToken(
      overrides: Partial<{
        token: string
        skill: string
        subcommands: string[]
        mintedAt: number
        ttlMs: number
      }> = {},
    ): void {
      mkdirSync(join(tempDir, '.metta', 'scratch'), { recursive: true })
      const tok = {
        token: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        skill: 'metta-next',
        subcommands: ['complete', 'finalize'],
        mintedAt: Date.now(),
        ttlMs: TTL_MS,
        ...overrides,
      }
      writeFileSync(
        join(tempDir, '.metta', 'scratch', 'skill-session.token'),
        JSON.stringify(tok),
        { mode: 0o600 },
      )
    }

    function readAuditEntries(): Array<Record<string, unknown>> {
      const logPath = join(tempDir, '.metta', 'logs', 'guard-bypass.log')
      return readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    }

    it('allows metta finalize with a fresh in-scope token and logs the session-tier acceptance', () => {
      seedToken()
      const { code, stderr } = runHook(bashEvent('metta finalize', { cwd: tempDir }), {
        cwd: tempDir,
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
      const entries = readAuditEntries()
      const last = entries[entries.length - 1]
      expect(last.tier).toBe('session')
      expect(last.reason).toBe('session-credential-verified')
      expect(last.verdict).toBe('allow')
    })

    it('blocks metta finalize with no token file — reason missing-credential, tier session', () => {
      const { code, stderr } = runHook(bashEvent('metta finalize', { cwd: tempDir }), {
        cwd: tempDir,
      })
      expect(code).toBe(2)
      expect(stderr).toContain('/metta-')
      const entries = readAuditEntries()
      const last = entries[entries.length - 1]
      expect(last.verdict).toBe('block')
      expect(last.reason).toBe('missing-credential')
      expect(last.tier).toBe('session')
    })

    it('blocks metta finalize with an expired token — reason credential-expired, tier session', () => {
      seedToken({ mintedAt: Date.now() - TTL_MS - 1000 })
      const { code } = runHook(bashEvent('metta finalize', { cwd: tempDir }), { cwd: tempDir })
      expect(code).toBe(2)
      const entries = readAuditEntries()
      const last = entries[entries.length - 1]
      expect(last.reason).toBe('credential-expired')
      expect(last.tier).toBe('session')
    })

    it('blocks an out-of-scope subcommand — metta-refresh token cannot authorize metta finalize', () => {
      seedToken({ skill: 'metta-refresh', subcommands: ['refresh'] })
      const { code } = runHook(bashEvent('metta finalize', { cwd: tempDir }), { cwd: tempDir })
      expect(code).toBe(2)
      const entries = readAuditEntries()
      const last = entries[entries.length - 1]
      expect(last.reason).toBe('subcommand-not-in-scope')
      expect(last.tier).toBe('session')
    })

    it('accepts a fork body calling a Tier-2 sub with no token (trusted agent_type)', () => {
      const { code } = runHook(
        bashEvent('metta finalize', { agent_type: 'metta-skill-host', cwd: tempDir }),
        { cwd: tempDir },
      )
      expect(code).toBe(0)
    })

    // Legacy branch deleted (task 4.1): the inline METTA_SKILL=1 prefix credits nothing —
    // with no token and no trusted agent_type the call is rejected as missing-credential.
    it('rejects legacy inline METTA_SKILL=1 metta finalize — exit 2, reason missing-credential', () => {
      const { code, stderr } = runHook(bashEvent('METTA_SKILL=1 metta finalize', { cwd: tempDir }), {
        cwd: tempDir,
      })
      expect(code).toBe(2)
      expect(stderr).not.toContain('session-credential-verified')
      const entries = readAuditEntries()
      const last = entries[entries.length - 1]
      expect(last.verdict).toBe('block')
      expect(last.reason).toBe('missing-credential')
      expect(last.tier).toBe('session')
    })
  })

  describe('background Bash rejection end-to-end', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'metta-guard-bg-int-'))
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('blocks run_in_background from a forked metta agent — exit 2, stderr points at the synchronous-completion rule', () => {
      const { code, stderr } = runHook(
        bashEvent('sleep 100', {
          agent_type: 'metta-skill-host',
          run_in_background: true,
          cwd: tempDir,
        }),
        { cwd: tempDir },
      )
      expect(code).toBe(2)
      expect(stderr).toContain('Blocked Bash run_in_background')
      expect(stderr).toContain('.claude/agents/metta-skill-host.md')

      // Audit log records the block with the dedicated reason.
      const logPath = join(tempDir, '.metta', 'logs', 'guard-bypass.log')
      expect(existsSync(logPath)).toBe(true)
      const entries = readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as { verdict: string; reason: string; agent_type: string | null })
      const bgBlocks = entries.filter((e) => e.reason === 'background-bash-from-fork')
      expect(bgBlocks.length).toBe(1)
      expect(bgBlocks[0].verdict).toBe('block')
      expect(bgBlocks[0].agent_type).toBe('metta-skill-host')
    })

    it('allows the same background command from a non-metta caller — exit 0 (caller-scoped, not command-scoped)', () => {
      const { code, stderr } = runHook(
        bashEvent('sleep 100', { agent_type: 'orchestrator', run_in_background: true, cwd: tempDir }),
        { cwd: tempDir },
      )
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('blocks run_in_background from metta-executor too (broad metta-* prefix) — exit 2', () => {
      const { code, stderr } = runHook(
        bashEvent('sleep 100', { agent_type: 'metta-executor', run_in_background: true, cwd: tempDir }),
        { cwd: tempDir },
      )
      expect(code).toBe(2)
      expect(stderr).toContain('metta-executor')
    })

    it('foreground calls from trusted agents keep existing classify behavior — exit 0', () => {
      const { code } = runHook(
        bashEvent('metta issue "test"', {
          agent_type: 'metta-skill-host',
          cwd: tempDir,
        }),
        { cwd: tempDir },
      )
      expect(code).toBe(0)
    })
  })

  describe('install wiring verification', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'metta-guard-bash-integ-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('first install registers exactly one Bash PreToolUse entry pointing at metta-guard-bash.mjs', async () => {
      const { code } = await runCli(['install', '--git-init', '--json'], tempDir)
      expect(code).toBe(0)

      const settingsRaw = await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8')
      const settings = JSON.parse(settingsRaw) as {
        hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> }
      }
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const bashEntries = preToolUse.filter(
        (e) =>
          e.matcher === 'Bash' &&
          (e.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('metta-guard-bash.mjs')),
      )
      expect(bashEntries.length).toBe(1)
    })

    it('second install is idempotent — Bash matcher entry count remains exactly 1', async () => {
      const first = await runCli(['install', '--git-init', '--json'], tempDir)
      expect(first.code).toBe(0)
      const second = await runCli(['install', '--json'], tempDir)
      expect(second.code).toBe(0)

      const settingsRaw = await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8')
      const settings = JSON.parse(settingsRaw) as {
        hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> }
      }
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const bashEntries = preToolUse.filter(
        (e) =>
          e.matcher === 'Bash' &&
          (e.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('metta-guard-bash.mjs')),
      )
      expect(bashEntries.length).toBe(1)
    })
  })
})
