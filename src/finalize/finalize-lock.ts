import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
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
        `Re-run metta finalize once it finishes — a dead-pid lock is reclaimed automatically. ` +
        `Do not delete the lock file manually.`,
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
 * Staleness threshold for the mtime fallback, matching the value/convention of
 * `STALE_LOCK_THRESHOLD_MS` in `src/state/state-store.ts` (no cross-module
 * import required).
 */
const FINALIZE_LOCK_STALE_MS = 60_000

/**
 * Determine whether the finalize lock for `change` is stale without mutating it.
 *
 * - Missing lock file → not stale (nothing blocks a retry).
 * - Unreadable / corrupt / schema-invalid lock → stale (`dead-pid`): an
 *   unreadable lock cannot block a retry.
 * - Lock owner probed dead (`ESRCH` or any non-EPERM throw) → stale (`dead-pid`).
 * - Lock owner unambiguously alive (clean `process.kill(pid, 0)`) → not stale,
 *   regardless of lock age.
 * - `EPERM` (ambiguous — alive but unprobeable, or a recycled pid) → fall back
 *   to the lock file's mtime: older than {@link FINALIZE_LOCK_STALE_MS} →
 *   stale (`mtime-expired`), otherwise not stale.
 */
export async function checkFinalizeLockStale(
  projectRoot: string,
  change: string,
): Promise<{ stale: boolean; reason?: 'dead-pid' | 'mtime-expired'; pid?: number; ageMs?: number }> {
  const lockPath = join(projectRoot, '.metta', 'locks', `finalize-${change}.lock`)

  let pid: number
  try {
    const raw = await readFile(lockPath, 'utf8')
    pid = FinalizeLockSchema.parse(JSON.parse(raw)).pid
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { stale: false }
    // Unreadable, corrupt, or zod-invalid lock cannot block a retry.
    return { stale: true, reason: 'dead-pid' }
  }

  // Probe liveness directly rather than via isPidAlive: its boolean-only
  // return collapses the EPERM-vs-clean-alive distinction needed here.
  try {
    process.kill(pid, 0)
    // Clean probe → unambiguously alive; respected regardless of lock age.
    return { stale: false }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
      return { stale: true, reason: 'dead-pid', pid }
    }
  }

  // EPERM-ambiguous owner → fall back to the lock file's mtime.
  const lockStat = await stat(lockPath)
  const ageMs = Date.now() - lockStat.mtimeMs
  if (ageMs > FINALIZE_LOCK_STALE_MS) {
    return { stale: true, reason: 'mtime-expired', pid, ageMs }
  }
  return { stale: false }
}

/**
 * Acquire a per-change finalize lock under `.metta/locks/finalize-<change>.lock`.
 *
 * Staleness is delegated to {@link checkFinalizeLockStale} so acquisition and
 * read-only reporting (`metta status` / `metta next`) can never diverge: a lock
 * those commands report as stale (`dead-pid` or `mtime-expired`) is reclaimed
 * here, and only a non-stale lock (confirmed-live owner, or an EPERM-ambiguous
 * owner with a fresh mtime) throws {@link FinalizeLockError}. A missing or
 * corrupt lock is likewise reclaimed.
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
    const { stale } = await checkFinalizeLockStale(projectRoot, change)
    if (!stale) {
      // Confirmed-live owner, or EPERM-ambiguous owner with a fresh mtime.
      throw new FinalizeLockError(change, existing.pid, lockPath)
    }
    // Stale (dead-pid or mtime-expired) → reclaim: remove before rewriting.
    await unlink(lockPath).catch(() => {})
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
    // Best-effort unlink on release: the lock file may already be gone (removed
    // by the exit handler or a prior release), and a missing file is a no-op here.
    await unlink(lockPath).catch(() => {})
  }
}
