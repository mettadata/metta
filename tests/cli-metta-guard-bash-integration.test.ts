import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFile } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

// End-to-end integration tests for the metta-guard-bash PreToolUse hook.
//
// These tests spawn the hook as a real subprocess (piping synthetic Claude
// PreToolUse event JSON on stdin) and exercise the hook <-> install wiring
// seam end-to-end. Unit-level coverage of the classifier lives in
// tests/metta-guard-bash.test.ts; this file focuses on:
//   1. METTA_SKILL=1 bypass works when the hook is spawned as a child process
//      with the env var set.
//   2. Direct metta CLI calls (no METTA_SKILL env) are blocked with exit 2 and
//      a stderr message pointing to the matching skill.
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
  opts: { env?: NodeJS.ProcessEnv } = {},
): { code: number; stderr: string; stdout: string } {
  const env = { ...process.env, ...(opts.env ?? {}) }
  // Ensure METTA_SKILL is not inherited from the outer test process env unless
  // the test explicitly opts in. Vitest runs can be invoked with METTA_SKILL=1
  // in the parent shell, which would silently mask "blocked" assertions.
  if (!('METTA_SKILL' in (opts.env ?? {}))) {
    delete env.METTA_SKILL
  }
  const result = spawnSync('node', [HOOK_TEMPLATE_PATH], {
    input: JSON.stringify(payload),
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })
  return {
    code: result.status ?? -1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

function bashEvent(command: string) {
  return { tool_name: 'Bash', tool_input: { command } }
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
  describe('skill bypass end-to-end', () => {
    it('exits 0 with no stderr when METTA_SKILL=1 is set (metta propose)', () => {
      const { code, stderr } = runHook(bashEvent('metta propose "foo"'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('exits 0 with no stderr when METTA_SKILL=1 is set (metta complete intent)', () => {
      const { code, stderr } = runHook(bashEvent('metta complete intent'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('exits 0 with no stderr when METTA_SKILL=1 is set (metta finalize)', () => {
      const { code, stderr } = runHook(bashEvent('metta finalize'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('exits 0 with no stderr when METTA_SKILL=1 is set (metta issue)', () => {
      const { code, stderr } = runHook(bashEvent('metta issue "x"'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })

    it('exits 0 with no stderr when METTA_SKILL=1 is set (metta quick)', () => {
      const { code, stderr } = runHook(bashEvent('metta quick "tweak"'), {
        env: { METTA_SKILL: '1' },
      })
      expect(code).toBe(0)
      expect(stderr).toBe('')
    })
  })

  describe('direct CLI blocked end-to-end', () => {
    it('blocks `metta propose` without METTA_SKILL — exit 2, stderr names /metta-propose and instructs to use the skill', () => {
      const { code, stderr } = runHook(bashEvent('metta propose "foo"'))
      expect(code).toBe(2)
      expect(stderr).toContain('/metta-propose')
      expect(stderr).toContain('Use the matching skill')
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
