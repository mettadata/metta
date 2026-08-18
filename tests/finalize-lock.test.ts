import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acquireFinalizeLock,
  checkFinalizeLockStale,
  FinalizeLockError,
  isPidAlive,
} from '../src/finalize/finalize-lock.js'

const CHANGE = 'my-change'
// A very high PID that is virtually guaranteed not to map to a live process.
const DEAD_PID = 2147483646

describe('finalize-lock', () => {
  let projectRoot: string
  let lockPath: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'metta-finalize-lock-'))
    lockPath = join(projectRoot, '.metta', 'locks', `finalize-${CHANGE}.lock`)
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('acquire writes a valid lock file containing the current pid', async () => {
    await acquireFinalizeLock(projectRoot, CHANGE)

    expect(existsSync(lockPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(parsed.pid).toBe(process.pid)
    expect(parsed.change).toBe(CHANGE)
    expect(typeof parsed.startedAt).toBe('string')
  })

  it('throws FinalizeLockError when the lock is held by a live pid', async () => {
    await acquireFinalizeLock(projectRoot, CHANGE)

    await expect(acquireFinalizeLock(projectRoot, CHANGE)).rejects.toBeInstanceOf(
      FinalizeLockError,
    )
  })

  it('FinalizeLockError message tells the caller to retry, not to delete the lock', async () => {
    await acquireFinalizeLock(projectRoot, CHANGE)

    const err = await acquireFinalizeLock(projectRoot, CHANGE).catch((e) => e)
    expect(err).toBeInstanceOf(FinalizeLockError)
    expect(err.message).toContain('Re-run metta finalize')
    expect(err.message).not.toContain('remove the stale lock at')
    expect(err.message).toContain('Do not delete the lock file manually')
  })

  it('FinalizeLockError carries change, pid, and lockPath', async () => {
    await acquireFinalizeLock(projectRoot, CHANGE)

    const err = await acquireFinalizeLock(projectRoot, CHANGE).catch((e) => e)
    expect(err).toBeInstanceOf(FinalizeLockError)
    expect(err.change).toBe(CHANGE)
    expect(err.pid).toBe(process.pid)
    expect(err.lockPath).toBe(lockPath)
  })

  it('reclaims a stale lock held by a dead pid', async () => {
    mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, startedAt: new Date().toISOString(), change: CHANGE }),
      'utf8',
    )

    await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')

    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(parsed.pid).toBe(process.pid)
  })

  it('reclaims a corrupt lock file', async () => {
    mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
    writeFileSync(lockPath, 'not json at all {{{', 'utf8')

    await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')

    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(parsed.pid).toBe(process.pid)
  })

  it('reclaims a structurally-invalid (zod-failing) lock file', async () => {
    mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: 'nope', change: CHANGE }), 'utf8')

    await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')
  })

  describe('acquire mtime fallback for EPERM-ambiguous owners', () => {
    const OLD_MTIME_SECONDS = (Date.now() - 5 * 60_000) / 1000
    const AMBIGUOUS_PID = 54321

    function writeLock(pid: number): void {
      mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
      writeFileSync(
        lockPath,
        JSON.stringify({ pid, startedAt: new Date().toISOString(), change: CHANGE }),
        'utf8',
      )
    }

    function mockKillEperm(): void {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('reclaims an EPERM-ambiguous lock whose mtime exceeds the staleness threshold', async () => {
      writeLock(AMBIGUOUS_PID)
      utimesSync(lockPath, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)
      mockKillEperm()

      await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')

      const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
      expect(parsed.pid).toBe(process.pid)
    })

    it('throws FinalizeLockError for an EPERM-ambiguous lock with a fresh mtime', async () => {
      writeLock(AMBIGUOUS_PID)
      // Fresh mtime: just written, not backdated.
      mockKillEperm()

      const err = await acquireFinalizeLock(projectRoot, CHANGE).catch((e) => e)
      expect(err).toBeInstanceOf(FinalizeLockError)
      expect(err.pid).toBe(AMBIGUOUS_PID)

      // The original lock is untouched.
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
      expect(parsed.pid).toBe(AMBIGUOUS_PID)
    })

    it('still reclaims a dead-pid lock regardless of mtime age', async () => {
      writeLock(DEAD_PID)
      utimesSync(lockPath, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)

      await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')

      const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
      expect(parsed.pid).toBe(process.pid)
    })
  })

  it('release removes the lock file', async () => {
    const release = await acquireFinalizeLock(projectRoot, CHANGE)
    expect(existsSync(lockPath)).toBe(true)

    await release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('release allows a subsequent acquire to succeed', async () => {
    const release = await acquireFinalizeLock(projectRoot, CHANGE)
    await release()

    await expect(acquireFinalizeLock(projectRoot, CHANGE)).resolves.toBeTypeOf('function')
  })

  describe('checkFinalizeLockStale', () => {
    const OLD_MTIME_SECONDS = (Date.now() - 5 * 60_000) / 1000

    function writeLock(pid: number): void {
      mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
      writeFileSync(
        lockPath,
        JSON.stringify({ pid, startedAt: new Date().toISOString(), change: CHANGE }),
        'utf8',
      )
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns { stale: false } when no lock file is present', async () => {
      await expect(checkFinalizeLockStale(projectRoot, CHANGE)).resolves.toEqual({
        stale: false,
      })
    })

    it('reports a dead-pid lock as stale regardless of mtime age', async () => {
      writeLock(DEAD_PID)
      // Explicitly old mtime to prove mtime is irrelevant on the dead-pid path.
      utimesSync(lockPath, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)

      await expect(checkFinalizeLockStale(projectRoot, CHANGE)).resolves.toEqual({
        stale: true,
        reason: 'dead-pid',
        pid: DEAD_PID,
      })
    })

    it('reports a corrupt lock file as stale (dead-pid)', async () => {
      mkdirSync(join(projectRoot, '.metta', 'locks'), { recursive: true })
      writeFileSync(lockPath, 'not json at all {{{', 'utf8')

      await expect(checkFinalizeLockStale(projectRoot, CHANGE)).resolves.toEqual({
        stale: true,
        reason: 'dead-pid',
      })
    })

    it('respects a confirmed-live owner regardless of lock age', async () => {
      writeLock(process.pid)
      // Backdate well past the 60s threshold: a clean liveness probe wins anyway.
      utimesSync(lockPath, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)

      await expect(checkFinalizeLockStale(projectRoot, CHANGE)).resolves.toEqual({
        stale: false,
      })
    })

    it('EPERM-ambiguous owner with an expired mtime is stale (mtime-expired)', async () => {
      const AMBIGUOUS_PID = 54321
      writeLock(AMBIGUOUS_PID)
      utimesSync(lockPath, OLD_MTIME_SECONDS, OLD_MTIME_SECONDS)

      vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })

      const result = await checkFinalizeLockStale(projectRoot, CHANGE)
      expect(result.stale).toBe(true)
      expect(result.reason).toBe('mtime-expired')
      expect(result.pid).toBe(AMBIGUOUS_PID)
      expect(result.ageMs).toBeGreaterThan(60_000)
    })

    it('EPERM-ambiguous owner with a fresh mtime is not stale', async () => {
      const AMBIGUOUS_PID = 54321
      writeLock(AMBIGUOUS_PID)
      // Fresh mtime: just written, not backdated.

      vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })

      await expect(checkFinalizeLockStale(projectRoot, CHANGE)).resolves.toEqual({
        stale: false,
      })
    })
  })

  describe('isPidAlive', () => {
    it('returns true for the current process', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it('returns false for a dead pid', () => {
      expect(isPidAlive(DEAD_PID)).toBe(false)
    })
  })
})
