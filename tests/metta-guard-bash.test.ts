import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

// metta-guard-bash PreToolUse hook integration tests.
// The source template and the deployed mirror must stay byte-identical; tests
// run against both.

const HOOK_SOURCES = [
  join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-bash.mjs'),
  join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-guard-bash.mjs'),
]

function runHook(
  hookPath: string,
  payload: unknown,
  opts: { env?: NodeJS.ProcessEnv; rawStdin?: string } = {},
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
  })
  return { code: result.status ?? -1, stderr: result.stderr ?? '' }
}

function bashEvent(command: string) {
  return { tool_name: 'Bash', tool_input: { command } }
}

describe('metta-guard-bash hook', { timeout: 30_000 }, () => {
  for (const hookPath of HOOK_SOURCES) {
    const label = hookPath.includes('.claude') ? 'deployed' : 'source'

    describe(`${label} hook (${hookPath})`, () => {
      // ----- Blocked cases -----
      it('blocks `metta propose "foo"` without env (exit 2, stderr mentions /metta-propose)', () => {
        const { code, stderr } = runHook(hookPath, bashEvent('metta propose "foo"'))
        expect(code).toBe(2)
        expect(stderr).toContain('/metta-propose')
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

      // ----- Allowed cases -----
      it('allows `metta status` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta status'))
        expect(code).toBe(0)
      })

      it('allows `metta instructions intent --change foo` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta instructions intent --change foo'))
        expect(code).toBe(0)
      })

      it('allows `metta issues list` two-word not in blocked map (exit 0)', () => {
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

      // ----- Bypass / env / chains -----
      it('bypasses with METTA_SKILL=1 env for `metta propose "foo"` (exit 0)', () => {
        const { code } = runHook(hookPath, bashEvent('metta propose "foo"'), {
          env: { METTA_SKILL: '1' },
        })
        expect(code).toBe(0)
      })

      it('detects metta after env prefix `FOO=bar metta propose "foo"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('FOO=bar metta propose "foo"'))
        expect(code).toBe(2)
      })

      it('scans chain `cd /foo && metta issue "bar"` (exit 2)', () => {
        const { code } = runHook(hookPath, bashEvent('cd /foo && metta issue "bar"'))
        expect(code).toBe(2)
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
