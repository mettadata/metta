import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { FinalizeLockSchema } from '../schemas/finalize-lock.js'

/**
 * Raised when a finalize is already running for a change and its lock is held
 * by a live process. Carries the change name, owning PID, and the lock path so
 * callers can surface a precise, actionable message.
 */
export class FinalizeLockError extends Error {
  readonly change: string
  readonly pid: number
  readonly lockPath: string

  constructor(change: string, pid: number, lockPath: string) {
    super(
      `A finalize is already running for "${change}" (PID ${pid}). ` +
        `Wait for it to finish, or remove the stale lock at ${lockPath}.`,
    )
    this.name = 'FinalizeLockError'
    this.change = change
    this.pid = pid
    this.lockPath = lockPath
  }
}

/**
 * Returns true if `pid` refers to a process this host can see.
 * `process.kill(pid, 0)` sends no signal — it only probes existence.
 * EPERM means the process is alive but owned by another user; ESRCH means dead.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true
    return false
  }
}

/**
 * Acquire a per-change finalize lock under `.metta/locks/finalize-<change>.lock`.
 *
 * If a lock already exists, parses validly, and its PID is alive, throws
 * {@link FinalizeLockError}. A missing, corrupt, or stale-PID lock is reclaimed.
 *
 * Cleanup is registered on `process.once('exit', ...)` because `finalize.ts`
 * calls `process.exit()` on several branches — a finally-only release would
 * leak the lock. Since a live PID is never reclaimed, the owning (still-alive)
 * process is the only one that deletes its own lock, so the unconditional
 * `unlinkSync` on exit is safe.
 *
 * @returns an async release that detaches the exit handler and removes the lock.
 */
export async function acquireFinalizeLock(
  projectRoot: string,
  change: string,
): Promise<() => Promise<void>> {
  const lockPath = join(projectRoot, '.metta', 'locks', `finalize-${change}.lock`)
  await mkdir(dirname(lockPath), { recursive: true })

  try {
    const raw = await readFile(lockPath, 'utf8')
    const existing = FinalizeLockSchema.parse(JSON.parse(raw))
    if (isPidAlive(existing.pid)) {
      throw new FinalizeLockError(change, existing.pid, lockPath)
    }
    // Dead PID → stale lock, fall through to reclaim.
  } catch (err) {
    // Never swallow a real lock conflict.
    if (err instanceof FinalizeLockError) throw err
    // ENOENT (missing) or parse/zod error (corrupt) → reclaim.
  }

  const lock = { pid: process.pid, startedAt: new Date().toISOString(), change }
  await writeFile(lockPath, JSON.stringify(lock, null, 2), 'utf8')

  const cleanup = () => {
    try {
      unlinkSync(lockPath)
    } catch {
      // already gone
    }
  }
  process.once('exit', cleanup)

  return async () => {
    process.removeListener('exit', cleanup)
    await unlink(lockPath).catch(() => {})
  }
}
