import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-guard-agent-dispatch PreToolUse hook integration tests.
// The source template and the deployed mirror must stay byte-identical; tests
// run against both. All cases are driven by synthetic stdin payloads only —
// no live Claude Code runtime.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-agent-dispatch.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-guard-agent-dispatch.mjs'),
]

// Shared sandbox cwd for hook invocations that do not explicitly opt into their
// own tempDir, so audit-log writes never pollute the real repo tree.
const SHARED_SANDBOX = mkdtempSync(join(tmpdir(), 'metta-guard-dispatch-shared-'))
afterAll(() => {
  try {
    rmSync(SHARED_SANDBOX, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

function runHook(
  hookPath: string,
  payload: unknown,
  opts: { rawStdin?: string; cwd?: string } = {},
): { code: number; stderr: string } {
  const input = opts.rawStdin !== undefined ? opts.rawStdin : JSON.stringify(payload)
  const result = spawnSync('node', [hookPath], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.cwd ?? SHARED_SANDBOX,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

function agentEvent(
  overrides: {
    tool_name?: string
    agent_type?: string
    cwd?: string
    subagent_type?: string
    run_in_background?: unknown
    omitToolInput?: boolean
  } = {},
): Record<string, unknown> {
  const toolInput: Record<string, unknown> = {}
  toolInput.subagent_type = overrides.subagent_type ?? 'metta-executor'
  if (overrides.run_in_background !== undefined) {
    toolInput.run_in_background = overrides.run_in_background
  }
  const event: Record<string, unknown> = { tool_name: overrides.tool_name ?? 'Agent' }
  if (!overrides.omitToolInput) event.tool_input = toolInput
  if (overrides.agent_type !== undefined) event.agent_type = overrides.agent_type
  if (overrides.cwd !== undefined) event.cwd = overrides.cwd
  return event
}

describe('metta-guard-agent-dispatch hook', { timeout: 30_000 }, () => {
  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      const tempDirs: string[] = []
      afterEach(() => {
        while (tempDirs.length) {
          const dir = tempDirs.pop()!
          try {
            rmSync(dir, { recursive: true, force: true })
          } catch {
            // best-effort cleanup
          }
        }
      })
      function makeTempCwd(): string {
        const dir = mkdtempSync(join(tmpdir(), 'metta-guard-dispatch-'))
        tempDirs.push(dir)
        return dir
      }
      function readAuditEntries(cwd: string): Array<Record<string, unknown>> {
        const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
        return readFileSync(logPath, 'utf8')
          .split('\n')
          .filter((l) => l.length > 0)
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      }

      // (1) Background dispatch is rejected.
      it('rejects a backgrounded Agent dispatch (exit 2) with a wait-for-the-child instruction', () => {
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ run_in_background: true, agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(2)
        expect(stderr).toContain('metta-guard-agent-dispatch:')
        expect(stderr).toContain('Blocked a backgrounded Agent dispatch')
        expect(stderr).toContain('metta-skill-host')
        // Not just a bare rejection — the fork is instructed to wait for the
        // outstanding dispatched child before returning.
        expect(stderr).toContain('wait for the outstanding dispatched child')
        expect(stderr).toContain('Synchronous completion (hard rule)')
        expect(stderr).toContain('Residual orphaning recovery protocol')
        expect(stderr).toContain('.claude/settings.local.json')
      })

      // (2) Audit record on rejection.
      it('writes exactly one JSON audit-log entry on rejection', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(
          hookPath,
          agentEvent({
            run_in_background: true,
            agent_type: 'metta-skill-host',
            subagent_type: 'metta-executor',
            cwd,
          }),
          { cwd },
        )
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        expect(entries.length).toBe(1)
        const entry = entries[0]
        expect(entry.verdict).toBe('block')
        expect(entry.tool_name).toBe('Agent')
        expect(entry.reason).toBe('rejected-async-agent-dispatch')
        expect(entry.tier).toBe('fork')
        expect(entry.subcommand).toBe(null)
        expect(entry.third).toBe(null)
        expect(entry.agent_type).toBe('metta-skill-host')
        expect(entry.subagent_type).toBe('metta-executor')
        expect(Array.isArray(entry.event_keys)).toBe(true)
        expect((entry.event_keys as unknown[]).length).toBeGreaterThan(0)
        // Valid ISO-8601 ts round-trip.
        expect(typeof entry.ts).toBe('string')
        expect(new Date(entry.ts as string).toISOString()).toBe(entry.ts)
      })

      // (3) Foreground dispatch (flag absent) passes through.
      it('passes through a foreground dispatch with run_in_background absent (exit 0, no audit log)', () => {
        const cwd = makeTempCwd()
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ agent_type: 'metta-skill-host', cwd }),
          { cwd },
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
        expect(existsSync(join(cwd, '.metta', 'logs', 'guard-bypass.log'))).toBe(false)
      })

      // (4) Explicit run_in_background: false passes through.
      it('passes through an explicit run_in_background: false (exit 0, no audit log)', () => {
        const cwd = makeTempCwd()
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ run_in_background: false, agent_type: 'metta-skill-host', cwd }),
          { cwd },
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
        expect(existsSync(join(cwd, '.metta', 'logs', 'guard-bypass.log'))).toBe(false)
      })

      // (5) Non-Agent tools pass through even with run_in_background: true present.
      it('passes through tool_name: Bash even with run_in_background: true (exit 0)', () => {
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ tool_name: 'Bash', run_in_background: true, agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      it('passes through tool_name: Edit even with run_in_background: true (exit 0)', () => {
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ tool_name: 'Edit', run_in_background: true, agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
      })

      // (6) Malformed/empty stdin fail-open.
      it('passes through empty stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: '' })
        expect(code).toBe(0)
      })

      it('passes through malformed JSON stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: 'not-json{' })
        expect(code).toBe(0)
      })

      // (7) Unrecognized field shape fail-open (harness-drift simulation).
      // The hook never guesses at a reshaped field: the dispatch passes through, and
      // per the amended spec the fail-open is audited — one 'allow' record capturing
      // the unrecognized shape (recognized shapes — absent/false — stay unaudited).
      it('fails open on run_in_background: "true" (string) with an audited allow record (exit 0)', () => {
        const cwd = makeTempCwd()
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ run_in_background: 'true', agent_type: 'metta-skill-host', cwd }),
          { cwd },
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
        const entries = readAuditEntries(cwd)
        expect(entries.length).toBe(1)
        const entry = entries[0]
        expect(entry.verdict).toBe('allow')
        expect(entry.reason).toBe('fail-open-unrecognized-shape')
        expect(entry.tool_name).toBe('Agent')
        expect(entry.tier).toBe('fork')
        expect(entry.observed_run_in_background).toBe('"true"')
      })

      it('fails open when tool_input is entirely absent (recognized-absent shape: exit 0, no audit log)', () => {
        const cwd = makeTempCwd()
        const { code, stderr } = runHook(
          hookPath,
          agentEvent({ omitToolInput: true, agent_type: 'metta-skill-host', cwd }),
          { cwd },
        )
        expect(code).toBe(0)
        expect(stderr).toBe('')
        expect(existsSync(join(cwd, '.metta', 'logs', 'guard-bypass.log'))).toBe(false)
      })

      // (8) agent_type is recorded but not required for the reject to fire.
      it('rejects a backgrounded dispatch even when agent_type is absent (exit 2, null in audit)', () => {
        const cwd = makeTempCwd()
        const { code } = runHook(
          hookPath,
          agentEvent({ run_in_background: true, cwd }),
          { cwd },
        )
        expect(code).toBe(2)
        const entries = readAuditEntries(cwd)
        expect(entries.length).toBe(1)
        expect(entries[0].verdict).toBe('block')
        expect(entries[0].reason).toBe('rejected-async-agent-dispatch')
        expect(entries[0].agent_type).toBe(null)
      })
    })
  }

  // (9) Source and deployed hook are byte-identical.
  it('source and deployed hook are byte-identical', async () => {
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})
