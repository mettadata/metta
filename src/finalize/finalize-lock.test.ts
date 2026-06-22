import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireFinalizeLock, FinalizeLockError, isPidAlive } from './finalize-lock.js'

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
    rmSync(projectRoot, { recursive: true, force: true })
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

  describe('isPidAlive', () => {
    it('returns true for the current process', () => {
      expect(isPidAlive(process.pid)).toBe(true)
    })

    it('returns false for a dead pid', () => {
      expect(isPidAlive(DEAD_PID)).toBe(false)
    })
  })
})
