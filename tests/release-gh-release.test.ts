import { describe, it, expect, vi } from 'vitest'
import { createGithubRelease } from '../src/release/gh-release.js'
import type { GhExec } from '../src/release/gh-release.js'

const ok = { stdout: '', stderr: '' }

function stubExec(impl: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>) {
  return vi.fn<GhExec>(async (file, args, _options) => impl(file, args))
}

describe('createGithubRelease', () => {
  it('returns created when probes and release create succeed', async () => {
    const exec = stubExec(async () => ok)

    const outcome = await createGithubRelease('/repo', 'v1.2.0', 'v1.2.0', 'notes body', exec)

    expect(outcome).toEqual({ status: 'created', tag: 'v1.2.0' })
    expect(exec.mock.calls.map((call) => [call[0], ...call[1]])).toEqual([
      ['gh', '--version'],
      ['gh', 'auth', 'status'],
      ['gh', 'release', 'create', 'v1.2.0', '--title', 'v1.2.0', '--notes', 'notes body'],
    ])
  })

  it('passes cwd and arg arrays through to exec (no shell string)', async () => {
    const exec = stubExec(async () => ok)
    const trickyNotes = 'line one; $(rm -rf /) `backtick` "quoted"'

    await createGithubRelease('/some/repo', 'v0.5.0', 'Release 0.5.0', trickyNotes, exec)

    for (const call of exec.mock.calls) {
      expect(Array.isArray(call[1])).toBe(true)
      expect(call[2]).toEqual({ cwd: '/some/repo' })
    }
    const release = exec.mock.calls[2]!
    expect(release[1]).toContain(trickyNotes)
  })

  it('returns missing-binary when the gh binary probe fails, without further gh invocations', async () => {
    const exec = stubExec(async (_file, args) => {
      if (args[0] === '--version') {
        const error = new Error('spawn gh ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return ok
    })

    const outcome = await createGithubRelease('/repo', 'v1.2.0', 'v1.2.0', 'notes', exec)

    expect(outcome.status).toBe('missing-binary')
    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec.mock.calls[0]![1]).toEqual(['--version'])
    if (outcome.status !== 'missing-binary') throw new Error('unreachable')
    expect(outcome.remedy).toContain('not found on PATH')
    expect(outcome.remedy).toContain('gh release create v1.2.0')
    expect(outcome.remedy).toContain('local release')
  })

  it('returns unauthenticated when gh auth status fails, without attempting release create', async () => {
    const exec = stubExec(async (_file, args) => {
      if (args[0] === 'auth') {
        throw new Error('You are not logged into any GitHub hosts')
      }
      return ok
    })

    const outcome = await createGithubRelease('/repo', 'v1.2.0', 'v1.2.0', 'notes', exec)

    expect(outcome.status).toBe('unauthenticated')
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[1]![1]).toEqual(['auth', 'status'])
    if (outcome.status !== 'unauthenticated') throw new Error('unreachable')
    expect(outcome.remedy).toContain('not authenticated')
    expect(outcome.remedy).toContain('gh auth login')
    expect(outcome.remedy).toContain('gh release create v1.2.0')
    expect(outcome.remedy).toContain('local release')
  })

  it('returns failed with detail when release create itself fails', async () => {
    const exec = stubExec(async (_file, args) => {
      if (args[0] === 'release') {
        const error = new Error('exit code 1') as Error & { stderr?: string }
        error.stderr = 'HTTP 422: release already exists'
        throw error
      }
      return ok
    })

    const outcome = await createGithubRelease('/repo', 'v1.2.0', 'v1.2.0', 'notes', exec)

    expect(outcome.status).toBe('failed')
    expect(exec).toHaveBeenCalledTimes(3)
    if (outcome.status !== 'failed') throw new Error('unreachable')
    expect(outcome.detail).toContain('gh release create failed for v1.2.0')
    expect(outcome.detail).toContain('HTTP 422: release already exists')
    expect(outcome.detail).toContain('gh release create v1.2.0')
  })

  it('never rejects, even when exec throws a non-Error value', async () => {
    const exec = stubExec(async (_file, args) => {
      if (args[0] === 'release') {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string failure'
      }
      return ok
    })

    await expect(
      createGithubRelease('/repo', 'v1.2.0', 'v1.2.0', 'notes', exec),
    ).resolves.toMatchObject({ status: 'failed', detail: expect.stringContaining('string failure') })
  })
})
