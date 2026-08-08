import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { askYesNo, outputJson, resolveProjectRoot } from '../src/cli/helpers.js'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recordVersionDrift, resetVersionDrift } from '../src/config/version-drift.js'

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

describe('resolveProjectRoot', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'metta-root-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
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
})
