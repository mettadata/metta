import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-guard-bash PreToolUse hook integration tests.
// The source template and the deployed mirror must stay byte-identical; tests
// run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-bash.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-guard-bash.mjs'),
]

// Shared sandbox cwd for hook invocations that do not explicitly opt into their
// own tempDir. Since Task 3.1 added an audit log written to
// <cwd>/.metta/logs/guard-bypass.log, every test run that inherits the repo
// cwd would pollute the real working tree. Default all runHook calls to this
// throwaway dir and nuke it after the file finishes.
const SHARED_SANDBOX = mkdtempSync(join(tmpdir(), 'metta-guard-shared-'))
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
  opts: { env?: NodeJS.ProcessEnv; rawStdin?: string; cwd?: string } = {},
): { code: number; stderr: string } {
  const env = { ...process.env, ...(opts.env ?? {}) }
  // Ensure METTA_SKILL is not inherited unless the test opts in.
  if (!('METTA_SKILL' in (opts.env ?? {}))) {
    delete env.METTA_SKILL
  }
  const input = opts.rawStdin !== undefined ? opts.rawStdin : JSON.stringify(payload)
  const result = spawnSync('node', [hookPath], {
    input,
    env,
    encoding: 'utf8',
    timeout: 10_000,
    cwd: opts.cwd ?? SHARED_SANDBOX,
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

function bashEvent(
  command: string,
  extra: { agent_type?: string; cwd?: string } = {},
): Record<string, unknown> {
  const event: Record<string, unknown> = { tool_name: 'Bash', tool_input: { command } }
  if (extra.agent_type !== undefined) event.agent_type = extra.agent_type
  if (extra.cwd !== undefined) event.cwd = extra.cwd
  return event
}

describe('metta-guard-bash hook', { timeout: 30_000 }, () => {
  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      // ----- Blocked cases (explicit BLOCK list) -----
      it('blocks `metta propose "foo"` without env (exit 2, stderr mentions /metta-)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta propose "foo"'))
        expect(code).toBe(2)
        expect(stderr).toContain('/metta-')
        expect(stderr).toContain('metta propose')
      })

      it('blocks `metta quick "foo"` without env (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta quick "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta issue "foo"` without env (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta issue "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta complete intent` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta complete intent'))
        expect(code).toBe(2)
      })

      it('blocks `metta backlog add "foo"` two-word (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog add "foo"'))
        expect(code).toBe(2)
      })

      it('blocks `metta changes abandon` two-word (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('metta changes abandon'))
        expect(code).toBe(2)
      })

      // ----- Unknown subcommands (conservative-block) -----
      it('blocks unknown single-word `metta unknowncmd` conservatively (exit 2)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta unknowncmd'))
        expect(code).toBe(2)
        expect(stderr).toContain('unknown metta subcommand')
        expect(stderr).toContain('unknowncmd')
      })

      it('blocks unknown two-word `metta unknown foo` conservatively (exit 2)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta unknown foo'))
        expect(code).toBe(2)
        expect(stderr).toContain('unknown metta subcommand')
      })

      // ----- Allowed cases (explicit ALLOW list) -----
      it('allows `metta status` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta status'))
        expect(code).toBe(0)
      })

      it('allows `metta instructions intent --change foo` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta instructions intent --change foo'))
        expect(code).toBe(0)
      })

      it('allows `metta issues list` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta issues list'))
        expect(code).toBe(0)
      })

      it('allows `metta gate list` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta gate list'))
        expect(code).toBe(0)
      })

      it('allows `metta progress` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta progress'))
        expect(code).toBe(0)
      })

      it('allows `metta changes list` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta changes list'))
        expect(code).toBe(0)
      })

      it('allows `metta doctor` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta doctor'))
        expect(code).toBe(0)
      })

      it('allows `metta install` (explicit pass-through, no matching skill) (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta install'))
        expect(code).toBe(0)
      })

      it('allows `metta backlog list` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog list'))
        expect(code).toBe(0)
      })

      it('allows `metta backlog show foo` two-word (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta backlog show foo'))
        expect(code).toBe(0)
      })

      // ----- Bypass / env / chains -----
      it('bypasses with METTA_SKILL=1 env on hook process for `metta propose "foo"` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta propose "foo"'), {
          env: { METTA_SKILL: '1' },
        })
        expect(code).toBe(0)
      })

      it('bypasses with inline env-var prefix `METTA_SKILL=1 metta propose "foo"` (exit 0)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('METTA_SKILL=1 metta propose "foo"', { agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
      })

      it('bypasses with multiple env prefixes `FOO=bar METTA_SKILL=1 metta propose` (exit 0)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('FOO=bar METTA_SKILL=1 metta propose', { agent_type: 'metta-skill-host' }),
        )
        expect(code).toBe(0)
      })

      it('bypasses inline for two-word `METTA_SKILL=1 metta backlog add "foo"` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta backlog add "foo"'))
        expect(code).toBe(0)
      })

      it('inline bypass applies per-invocation: chain with unprefixed metta still blocks (exit 2)', () => {
        const { code } = runHook(
          hookPath,
          bashEvent('METTA_SKILL=1 metta status && metta propose "foo"'),
        )
        expect(code).toBe(2)
      })

      it('detects metta after non-bypass env prefix `FOO=bar metta propose "foo"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('FOO=bar metta propose "foo"'))
        expect(code).toBe(2)
      })

      it('scans chain `cd /foo && metta issue "bar"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('cd /foo && metta issue "bar"'))
        expect(code).toBe(2)
      })

      // ----- Skill-enforced caller-identity enforcement + audit log -----
      describe('skill-enforced caller-identity enforcement', () => {
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
          const dir = mkdtempSync(join(tmpdir(), 'metta-guard-'))
          tempDirs.push(dir)
          return dir
        }

        // (a) Enforced subcommand + METTA_SKILL=1 + NO agent_type -> block
        it('blocks enforced subcommand with inline METTA_SKILL=1 but no agent_type (exit 2)', () => {
          const { code, stderr } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"'),
          )
          expect(code).toBe(2)
          expect(stderr).toContain('/metta-issue')
          expect(stderr).toContain('Inline METTA_SKILL=1 prefix no longer bypasses')
        })

        // (b) Enforced subcommand + METTA_SKILL=1 + agent_type='metta-skill-host' -> allow
        it('allows enforced subcommand with inline bypass + agent_type=metta-skill-host (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"', { agent_type: 'metta-skill-host' }),
          )
          expect(code).toBe(0)
        })

        // (c) Enforced subcommand + METTA_SKILL=1 + agent_type='metta-issue' -> allow
        it('allows enforced subcommand with any metta-* agent_type prefix (exit 0)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"', { agent_type: 'metta-issue' }),
          )
          expect(code).toBe(0)
        })

        // (d) Enforced subcommand + METTA_SKILL=1 + agent_type='other-agent' -> block
        it('blocks enforced subcommand with non-metta agent_type (exit 2)', () => {
          const { code } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"', { agent_type: 'other-agent' }),
          )
          expect(code).toBe(2)
        })

        // (e) Enforced subcommand + NO METTA_SKILL=1 + NO agent_type -> block with unified skill-enforced message
        it('blocks bare enforced subcommand with unified skill-enforced message (exit 2)', () => {
          const { code, stderr } = runHook(hookPath, bashEvent('metta issue "foo"'))
          expect(code).toBe(2)
          // Per spec R1: ANY block of an enforced subcommand emits the unified advisory,
          // even when no inline bypass was attempted.
          expect(stderr).toContain('/metta-issue')
          expect(stderr).toContain(
            'Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands',
          )
        })

        // (f) Non-enforced subcommand + METTA_SKILL=1 + NO agent_type -> allow
        it('allows non-enforced subcommand with inline METTA_SKILL=1 and no agent_type (exit 0)', () => {
          const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh'))
          expect(code).toBe(0)
        })

        // (g) Allowed subcommand -> exit 0 and no audit log created
        it('does not create an audit log entry for an allowed subcommand', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('metta status'), { cwd })
          expect(code).toBe(0)
          expect(existsSync(join(cwd, '.metta', 'logs', 'guard-bypass.log'))).toBe(false)
        })

        // (h) Audit log written on enforced block
        it('writes a JSON audit log entry when an enforced block fires', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(
            hookPath,
            bashEvent('METTA_SKILL=1 metta issue "hello"', { cwd }),
            { cwd },
          )
          expect(code).toBe(2)
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          expect(existsSync(logPath)).toBe(true)
          const raw = readFileSync(logPath, 'utf8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          expect(lines.length).toBe(1)
          const entry = JSON.parse(lines[0])
          expect(entry.verdict).toBe('block')
          expect(entry.subcommand).toBe('issue')
          expect(entry.agent_type).toBe(null)
          expect(entry.skill_bypass).toBe(true)
          expect(typeof entry.reason).toBe('string')
          expect(Array.isArray(entry.event_keys)).toBe(true)
          expect(entry.event_keys.length).toBeGreaterThan(0)
          expect(typeof entry.ts).toBe('string')
          // ISO 8601 date string roundtrip
          const parsed = new Date(entry.ts)
          expect(Number.isNaN(parsed.getTime())).toBe(false)
          expect(parsed.toISOString()).toBe(entry.ts)
        })

        // (i) Audit log on allow-with-bypass for non-enforced subcommand
        it('writes an allow_with_bypass audit entry for non-enforced inline bypass', () => {
          const cwd = makeTempCwd()
          const { code } = runHook(hookPath, bashEvent('METTA_SKILL=1 metta refresh', { cwd }), {
            cwd,
          })
          expect(code).toBe(0)
          const logPath = join(cwd, '.metta', 'logs', 'guard-bypass.log')
          expect(existsSync(logPath)).toBe(true)
          const raw = readFileSync(logPath, 'utf8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          expect(lines.length).toBe(1)
          const entry = JSON.parse(lines[0])
          expect(entry.verdict).toBe('allow_with_bypass')
          expect(entry.subcommand).toBe('refresh')
        })
      })

      // ----- Non-Bash / edge cases -----
      it('passes through non-Bash events (tool_name: Edit) (exit 0)', () => {
        const { code } = runHook(hookPath, { tool_name: 'Edit', tool_input: { file_path: 'x.ts' } })
        expect(code).toBe(0)
      })

      it('passes through empty stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: '' })
        expect(code).toBe(0)
      })

      it('passes through malformed JSON stdin (exit 0)', () => {
        const { code } = runHook(hookPath, null, { rawStdin: 'not-json{' })
        expect(code).toBe(0)
      })

      it('passes through commands with no metta (e.g. `ls -la`) (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('ls -la'))
        expect(code).toBe(0)
      })
    })
  }

  it('source and deployed hook are byte-identical', async () => {
    const [a, b] = await Promise.all(HOOK_SOURCES.map((p) => readFile(p, 'utf8')))
    expect(a).toBe(b)
  })
})
