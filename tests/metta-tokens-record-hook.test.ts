import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// metta-tokens-record SubagentStop hook integration tests.
// The TEMPLATE hook is executed as a child process against a temp dir with a
// stub `metta` shim prepended to PATH that captures argv to a file. The
// deployed .claude/hooks/ mirror is covered by the byte-identity and
// syntax-validity assertions at the bottom.

const TEMPLATE_HOOK = join(
  import.meta.dirname,
  '..',
  'src',
  'templates',
  'hooks',
  'metta-tokens-record.mjs',
)
const DEPLOYED_HOOK = join(import.meta.dirname, '..', '.claude', 'hooks', 'metta-tokens-record.mjs')

const tempDirs: string[] = []
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // best-effort cleanup
    }
  }
})

interface Sandbox {
  dir: string
  shimDir: string
  argvFile: string
}

// Builds a temp sandbox with a `metta` shim on its own PATH dir. The shim
// appends its argv (one arg per line) to argvFile and exits with shimExit.
function makeSandbox(opts: { shimExit?: number; withShim?: boolean } = {}): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'metta-tokens-record-hook-'))
  tempDirs.push(dir)
  const shimDir = join(dir, 'bin')
  const argvFile = join(dir, 'metta-argv.txt')
  // Always create the PATH dir; only add the shim when requested.
  mkdirSync(shimDir, { recursive: true })
  if (opts.withShim !== false) {
    const shim = `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvFile}"\nexit ${opts.shimExit ?? 0}\n`
    writeFileSync(join(shimDir, 'metta'), shim, { mode: 0o755 })
  }
  return { dir, shimDir, argvFile }
}

function writeTranscript(sandbox: Sandbox, lines: string[]): string {
  const path = join(sandbox.dir, 'transcript.jsonl')
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

function assistantLine(
  usage: Record<string, unknown> | undefined,
  model?: string,
  type = 'assistant',
): string {
  const message: Record<string, unknown> = {}
  if (usage !== undefined) message.usage = usage
  if (model !== undefined) message.model = model
  return JSON.stringify({ type, message })
}

function runHook(
  sandbox: Sandbox,
  payload: unknown,
  opts: { rawStdin?: string } = {},
): { code: number; stdout: string; stderr: string } {
  const input = opts.rawStdin !== undefined ? opts.rawStdin : JSON.stringify(payload)
  const result = spawnSync(process.execPath, [TEMPLATE_HOOK], {
    input,
    encoding: 'utf8',
    timeout: 15_000,
    cwd: sandbox.dir,
    // PATH contains ONLY the shim dir so a globally installed metta can never
    // leak into these tests (the hook resolves `metta` via the child's PATH).
    env: { ...process.env, PATH: sandbox.shimDir },
  })
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function shimArgs(sandbox: Sandbox): string[] {
  return readFileSync(sandbox.argvFile, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
}

function expectSilentSuccess(result: { code: number; stdout: string }): void {
  expect(result.code).toBe(0)
  expect(result.stdout).toBe('')
}

describe('metta-tokens-record SubagentStop hook', { timeout: 30_000 }, () => {
  // (1) Exact-sum recording: input+output components sum to 42000; cache
  // components and non-assistant usage records are excluded.
  it('records the exact input+output sum with mapped task and model', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine(
        {
          input_tokens: 30_000,
          output_tokens: 10_000,
          cache_creation_input_tokens: 5_000,
          cache_read_input_tokens: 7_000,
        },
        'claude-haiku-4-5-20251001',
      ),
      // Non-assistant record with usage: must NOT contribute to the sum.
      assistantLine({ input_tokens: 999, output_tokens: 999 }, 'claude-opus-4', 'user'),
      assistantLine({ input_tokens: 1_500, output_tokens: 500 }, 'claude-haiku-4-5-20251001'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args).toEqual([
      'tokens',
      'record',
      '--task',
      'implementation',
      '--agent',
      'metta-executor',
      '--model',
      'haiku',
      '--tokens',
      '42000',
      '--source',
      'hook',
    ])
    // Stderr diagnostics carry the prefix and the component sums.
    expect(result.stderr).toContain('metta-tokens-record:')
    expect(result.stderr).toContain('input=31500')
    expect(result.stderr).toContain('output=10500')
  })

  // (2) Agent -> task mapping for another mapped persona.
  it('maps metta-verifier to the verification task', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 10, output_tokens: 5 }, 'claude-sonnet-4-5'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-verifier',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args).toContain('--task')
    expect(args[args.indexOf('--task') + 1]).toBe('verification')
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet')
    expect(args[args.indexOf('--tokens') + 1]).toBe('15')
  })

  // (3) Unmapped metta-* agent type falls back to agent_type as --task.
  it('falls back to the agent_type as --task for an unmapped metta-* agent', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 100, output_tokens: 50 }, 'claude-opus-4-1'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-custom-persona',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args[args.indexOf('--task') + 1]).toBe('metta-custom-persona')
    expect(args[args.indexOf('--agent') + 1]).toBe('metta-custom-persona')
    expect(args[args.indexOf('--model') + 1]).toBe('opus')
  })

  // (4) Unmapped model id -> inherit.
  it('records --model inherit for an unrecognized model id', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 20, output_tokens: 30 }, 'gpt-5-preview'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-planner',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args[args.indexOf('--model') + 1]).toBe('inherit')
    expect(args[args.indexOf('--task') + 1]).toBe('tasks')
  })

  // (5) Absent model field on every usage record -> inherit.
  it('records --model inherit when the usage-bearing records carry no model', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 7, output_tokens: 3 }),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-architect',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args[args.indexOf('--model') + 1]).toBe('inherit')
  })

  // (6) Model comes from the LAST usage-bearing record.
  it('takes --model from the last usage-bearing record', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 1, output_tokens: 1 }, 'claude-haiku-4-5'),
      assistantLine({ input_tokens: 1, output_tokens: 1 }, 'claude-fable-5'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args[args.indexOf('--model') + 1]).toBe('fable')
  })

  // (7) Non-metta agent_type -> no shim invocation.
  it('ignores a non-metta agent_type entirely', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 100, output_tokens: 100 }, 'claude-haiku-4-5'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'general-purpose',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  it('ignores a payload with no agent_type', () => {
    const sandbox = makeSandbox()
    const result = runHook(sandbox, { cwd: sandbox.dir })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (8) Missing transcript path -> no shim invocation.
  it('exits silently when agent_transcript_path is absent', () => {
    const sandbox = makeSandbox()
    const result = runHook(sandbox, { agent_type: 'metta-executor', cwd: sandbox.dir })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (9) Unreadable transcript file -> no shim invocation.
  it('exits silently when the transcript path is unreadable', () => {
    const sandbox = makeSandbox()
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: join(sandbox.dir, 'does-not-exist.jsonl'),
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (10) Empty transcript file -> no shim invocation.
  it('exits silently on an empty transcript file', () => {
    const sandbox = makeSandbox()
    const transcript = join(sandbox.dir, 'transcript.jsonl')
    writeFileSync(transcript, '')
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (11) Usage-free transcript -> no shim invocation.
  it('exits silently when no record carries a usage object', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine(undefined, 'claude-haiku-4-5'),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (12) Zero-sum usage records -> no shim invocation.
  it('exits silently when the input+output sum is not a positive integer', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 500 }),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (13) Malformed lines are skipped while valid lines still sum.
  it('skips malformed transcript lines and still sums the valid ones', () => {
    const sandbox = makeSandbox()
    const transcript = writeTranscript(sandbox, [
      'this is not json {',
      assistantLine({ input_tokens: 40, output_tokens: 2 }, 'claude-haiku-4-5'),
      '{"truncated": ',
      assistantLine({ input_tokens: 5, output_tokens: 3 }, 'claude-haiku-4-5'),
      '',
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    const args = shimArgs(sandbox)
    expect(args[args.indexOf('--tokens') + 1]).toBe('50')
  })

  // (14) Shim exiting non-zero -> hook still exits 0.
  it('exits 0 when metta tokens record fails with a non-zero exit', () => {
    const sandbox = makeSandbox({ shimExit: 3 })
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 10, output_tokens: 10 }, 'claude-haiku-4-5'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    // The shim WAS invoked, and the failure surfaced as a stderr note only.
    expect(shimArgs(sandbox)).toContain('--source')
    expect(result.stderr).toContain('metta-tokens-record:')
    expect(result.stderr).toContain('non-fatal')
  })

  // (15) metta absent from PATH -> hook still exits 0.
  it('exits 0 when metta is not on PATH', () => {
    const sandbox = makeSandbox({ withShim: false })
    const transcript = writeTranscript(sandbox, [
      assistantLine({ input_tokens: 10, output_tokens: 10 }, 'claude-haiku-4-5'),
    ])
    const result = runHook(sandbox, {
      agent_type: 'metta-executor',
      agent_transcript_path: transcript,
      cwd: sandbox.dir,
    })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
    expect(result.stderr).toContain('metta-tokens-record:')
  })

  // (16) Malformed/empty stdin fail-open.
  it('exits 0 with empty stdout on empty stdin', () => {
    const sandbox = makeSandbox()
    const result = runHook(sandbox, null, { rawStdin: '' })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  it('exits 0 with empty stdout on malformed JSON stdin', () => {
    const sandbox = makeSandbox()
    const result = runHook(sandbox, null, { rawStdin: 'not-json{' })
    expectSilentSuccess(result)
    expect(existsSync(sandbox.argvFile)).toBe(false)
  })

  // (17) Template and deployed hook are byte-identical.
  it('template and deployed hook are byte-identical', async () => {
    const [template, deployed] = await Promise.all([
      readFile(TEMPLATE_HOOK, 'utf8'),
      readFile(DEPLOYED_HOOK, 'utf8'),
    ])
    expect(template).toBe(deployed)
  })

  // (18) Both copies are syntactically valid.
  it('both hook copies pass node --check', () => {
    for (const hookPath of [TEMPLATE_HOOK, DEPLOYED_HOOK]) {
      const result = spawnSync(process.execPath, ['--check', hookPath], {
        encoding: 'utf8',
        timeout: 15_000,
      })
      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
    }
  })
})
