import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  askYesNo,
  askYesNoDetailed,
  handleError,
  outputJson,
  resolveChangeRoot,
  resolveProjectRoot,
} from '../src/cli/helpers.js'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { recordVersionDrift, resetVersionDrift } from '../src/config/version-drift.js'

// Scripted TTY prompt state for the askYesNoDetailed interactive-answer
// tests. When `answers` is non-empty, the node:readline mock below
// intercepts createInterface and replays the queued answer; otherwise it
// delegates to the real implementation so every other test is unaffected —
// same pattern as tests/cli-complete.test.ts's harness.
const ttyPrompt = vi.hoisted(() => ({
  answers: [] as string[],
  questions: [] as string[],
}))

vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline')>()
  return {
    ...actual,
    createInterface: (options: Parameters<typeof actual.createInterface>[0]) => {
      if (ttyPrompt.answers.length === 0) {
        return actual.createInterface(options)
      }
      return {
        question(query: string, cb: (answer: string) => void): void {
          ttyPrompt.questions.push(query)
          cb(ttyPrompt.answers.shift() ?? '')
        },
        close(): void {},
      } as unknown as ReturnType<typeof actual.createInterface>
    },
  }
})

describe('askYesNo', () => {
  const originalIsTTY = process.stdin.isTTY

  afterEach(() => {
    // Restore original TTY state so other tests are unaffected.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    })
  })

  function setTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      value,
      configurable: true,
      writable: true,
    })
  }

  it('returns defaultYes=false when stdin is not a TTY', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?', { defaultYes: false })).resolves.toBe(false)
  })

  it('returns defaultYes=true when stdin is not a TTY', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?', { defaultYes: true })).resolves.toBe(true)
  })

  it('returns defaultYes when jsonMode is true (even if TTY)', async () => {
    setTTY(true)
    await expect(
      askYesNo('prompt?', { defaultYes: true, jsonMode: true }),
    ).resolves.toBe(true)
    await expect(
      askYesNo('prompt?', { defaultYes: false, jsonMode: true }),
    ).resolves.toBe(false)
  })

  it('defaults to false in non-TTY when defaultYes is omitted', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?')).resolves.toBe(false)
  })

  it('defaults to false in non-TTY when opts object is omitted entirely', async () => {
    setTTY(false)
    await expect(askYesNo('prompt?')).resolves.toBe(false)
  })

  it('defaults to false in jsonMode when defaultYes is omitted', async () => {
    setTTY(true)
    await expect(askYesNo('prompt?', { jsonMode: true })).resolves.toBe(false)
  })
})

describe('askYesNoDetailed', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    ttyPrompt.answers = []
    ttyPrompt.questions = []
  })

  afterEach(() => {
    // Restore original TTY state so other tests are unaffected.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    })
    ttyPrompt.answers = []
    ttyPrompt.questions = []
  })

  function setTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      value,
      configurable: true,
      writable: true,
    })
  }

  it('non-TTY/jsonMode early return: viaDefault true, value === defaultYes', async () => {
    setTTY(false)
    await expect(askYesNoDetailed('prompt?', { defaultYes: true })).resolves.toEqual({
      value: true,
      viaDefault: true,
    })
    await expect(askYesNoDetailed('prompt?', { defaultYes: false })).resolves.toEqual({
      value: false,
      viaDefault: true,
    })

    setTTY(true)
    await expect(
      askYesNoDetailed('prompt?', { defaultYes: true, jsonMode: true }),
    ).resolves.toEqual({ value: true, viaDefault: true })
  })

  it('empty answer: viaDefault true, value === defaultYes', async () => {
    setTTY(true)
    ttyPrompt.answers = ['']
    await expect(askYesNoDetailed('prompt?', { defaultYes: true })).resolves.toEqual({
      value: true,
      viaDefault: true,
    })
  })

  it('explicit y: viaDefault false, value true', async () => {
    setTTY(true)
    ttyPrompt.answers = ['y']
    await expect(askYesNoDetailed('prompt?', { defaultYes: false })).resolves.toEqual({
      value: true,
      viaDefault: false,
    })
  })

  it('explicit n: viaDefault false, value false', async () => {
    setTTY(true)
    ttyPrompt.answers = ['n']
    await expect(askYesNoDetailed('prompt?', { defaultYes: true })).resolves.toEqual({
      value: false,
      viaDefault: false,
    })
  })

  it('unrecognized answer: viaDefault true, value === defaultYes', async () => {
    setTTY(true)
    ttyPrompt.answers = ['garbage']
    await expect(askYesNoDetailed('prompt?', { defaultYes: true })).resolves.toEqual({
      value: true,
      viaDefault: true,
    })
  })

  it('askYesNo wrapper still returns the bare boolean', async () => {
    setTTY(true)
    ttyPrompt.answers = ['y']
    await expect(askYesNo('prompt?', { defaultYes: false })).resolves.toBe(true)

    ttyPrompt.answers = ['n']
    await expect(askYesNo('prompt?', { defaultYes: true })).resolves.toBe(false)
  })
})

describe('outputJson', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetVersionDrift()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    resetVersionDrift()
    logSpy.mockRestore()
  })

  function printed(): string {
    expect(logSpy).toHaveBeenCalledTimes(1)
    return logSpy.mock.calls[0][0] as string
  }

  it('appends template_version_mismatch to object payloads when drift is recorded', () => {
    recordVersionDrift({ installed: '0.1.0', running: '0.2.0' })
    outputJson({ status: 'ok', count: 3 })
    const parsed = JSON.parse(printed()) as Record<string, unknown>
    expect(parsed).toEqual({
      status: 'ok',
      count: 3,
      template_version_mismatch: { installed: '0.1.0', running: '0.2.0' },
    })
  })

  it('omits the key entirely when no drift is recorded', () => {
    outputJson({ status: 'ok' })
    expect(printed()).toBe(JSON.stringify({ status: 'ok' }, null, 2))
  })

  it('leaves array payloads untouched even when drift is recorded', () => {
    recordVersionDrift({ installed: '0.1.0', running: '0.2.0' })
    outputJson([{ id: 1 }, { id: 2 }])
    expect(printed()).toBe(JSON.stringify([{ id: 1 }, { id: 2 }], null, 2))
  })

  it('does not displace a pre-existing template_version_mismatch key', () => {
    recordVersionDrift({ installed: '0.1.0', running: '0.2.0' })
    const payload = {
      status: 'ok',
      template_version_mismatch: { installed: 'a', running: 'b' },
    }
    outputJson(payload)
    expect(printed()).toBe(JSON.stringify(payload, null, 2))
  })
})

describe('handleError with a raw ZodError', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetVersionDrift()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) called`)
    }) as never)
  })

  afterEach(() => {
    resetVersionDrift()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  function releaseSchemeError(): z.ZodError {
    const schema = z.object({ release: z.object({ scheme: z.literal('semver') }) })
    const result = schema.safeParse({ release: { scheme: 'calver' } })
    if (result.success) throw new Error('expected schema to reject value')
    return result.error
  }

  it('text mode prints Error: path: message lines, not the raw issues array', () => {
    const err = releaseSchemeError()
    expect(() => handleError(err, false)).toThrow('process.exit(4) called')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const printed = errorSpy.mock.calls[0][0] as string
    expect(printed).toBe(`Error: release.scheme: ${err.issues[0].message}`)
    expect(printed).not.toContain('[')
    expect(printed).not.toContain('"code"')
    expect(exitSpy).toHaveBeenCalledWith(4)
  })

  it('json mode keeps the validation_error envelope with a formatted message', () => {
    const err = releaseSchemeError()
    expect(() => handleError(err, true)).toThrow('process.exit(4) called')
    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string) as {
      error: { code: number; type: string; message: string }
    }
    expect(payload.error.code).toBe(4)
    expect(payload.error.type).toBe('validation_error')
    expect(payload.error.message).toBe(`release.scheme: ${err.issues[0].message}`)
    expect(payload.error.message).not.toContain('[')
    expect(exitSpy).toHaveBeenCalledWith(4)
  })

  it('non-Zod errors still render via getErrorMessage (generic fallback unchanged)', () => {
    expect(() => handleError(new Error('plain failure'), false)).toThrow('process.exit(4) called')
    expect(errorSpy).toHaveBeenCalledWith('Error: plain failure')
  })
})

describe('resolveChangeRoot', () => {
  it('returns the hosting worktree checkout root when metadata carries one', () => {
    const worktree = join('/repo', '.metta', 'worktrees', 'demo')
    expect(resolveChangeRoot('/repo', { worktree })).toBe(worktree)
  })

  it('falls back to the project root for non-worktree changes', () => {
    expect(resolveChangeRoot('/repo', {})).toBe('/repo')
    expect(resolveChangeRoot('/repo', { worktree: undefined })).toBe('/repo')
  })

  it('is pure given the metadata — no filesystem existence requirement', () => {
    // The paths involved do not exist; the helper only maps metadata → root.
    const worktree = join('/nonexistent', '.metta', 'worktrees', 'ghost')
    expect(resolveChangeRoot('/nonexistent', { worktree })).toBe(worktree)
  })

  it('accepts a valid .metta/worktrees/<name> path under the project root', () => {
    const worktree = join('/repo', '.metta', 'worktrees', 'my-change')
    expect(resolveChangeRoot('/repo', { worktree })).toBe(worktree)
  })

  it('rejects an absolute worktree path outside the project (falls back to projectRoot)', () => {
    expect(resolveChangeRoot('/repo', { worktree: '/elsewhere/evil' })).toBe('/repo')
    expect(resolveChangeRoot('/repo', { worktree: '/repo/other-dir' })).toBe('/repo')
  })

  it('rejects a ..-relative escape out of the worktrees dir (falls back to projectRoot)', () => {
    const worktree = join('/repo', '.metta', 'worktrees', '..', '..', 'escape')
    expect(resolveChangeRoot('/repo', { worktree })).toBe('/repo')
    expect(
      resolveChangeRoot('/repo', { worktree: '/repo/.metta/worktrees/../../../etc' }),
    ).toBe('/repo')
  })

  it('resolves a relative worktree value against projectRoot, independent of cwd', () => {
    // A relative persisted value like `.metta/worktrees/foo` must resolve
    // deterministically against the project root — never process.cwd().
    expect(resolveChangeRoot('/repo', { worktree: join('.metta', 'worktrees', 'foo') })).toBe(
      join('/repo', '.metta', 'worktrees', 'foo'),
    )
    // A relative escape falls back to projectRoot like any other escape.
    expect(resolveChangeRoot('/repo', { worktree: join('..', 'outside') })).toBe('/repo')
  })

  it('rejects the worktrees dir itself — only strict children qualify', () => {
    const worktreesDir = join('/repo', '.metta', 'worktrees')
    expect(resolveChangeRoot('/repo', { worktree: worktreesDir })).toBe('/repo')
  })
})

describe('resolveProjectRoot', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'metta-root-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns cwd when it has its own spec/changes', async () => {
    await mkdir(join(rootDir, 'spec', 'changes'), { recursive: true })
    expect(resolveProjectRoot(rootDir)).toBe(rootDir)
  })

  it('resolves the checkout top level from a nested subdirectory', async () => {
    await mkdir(join(rootDir, 'spec', 'changes'), { recursive: true })
    const nested = join(rootDir, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    expect(resolveProjectRoot(nested)).toBe(rootDir)
  })

  it('resolves a worktree checkout root instead of the outer main root', async () => {
    await mkdir(join(rootDir, 'spec', 'changes'), { recursive: true })
    const worktree = join(rootDir, '.metta', 'worktrees', 'demo')
    await mkdir(join(worktree, 'spec', 'changes'), { recursive: true })
    const inside = join(worktree, 'src')
    await mkdir(inside, { recursive: true })
    expect(resolveProjectRoot(inside)).toBe(worktree)
  })

  it('never escapes a git checkout that lacks spec/changes', async () => {
    await mkdir(join(rootDir, 'spec', 'changes'), { recursive: true })
    const innerRepo = join(rootDir, 'vendor', 'other')
    await mkdir(join(innerRepo, '.git'), { recursive: true })
    const inner = join(innerRepo, 'src')
    await mkdir(inner, { recursive: true })
    expect(resolveProjectRoot(inner)).toBe(inner)
  })

  it('falls back to cwd when nothing qualifies', async () => {
    const bare = join(rootDir, 'bare')
    await mkdir(bare, { recursive: true })
    expect(resolveProjectRoot(bare)).toBe(bare)
  })

  it('returns a resolved path from every fallback branch (unnormalized input)', async () => {
    // Plain fallback (nothing qualifies): the raw argument must be normalized.
    const bare = join(rootDir, 'bare')
    await mkdir(bare, { recursive: true })
    expect(resolveProjectRoot(`${bare}/../bare`)).toBe(bare)

    // Git-boundary fallback: same guarantee when the walk stops at a checkout
    // that lacks spec/changes.
    const innerRepo = join(rootDir, 'vendor', 'other')
    await mkdir(join(innerRepo, '.git'), { recursive: true })
    const inner = join(innerRepo, 'src')
    await mkdir(inner, { recursive: true })
    expect(resolveProjectRoot(`${inner}/../src`)).toBe(inner)
  })
})
