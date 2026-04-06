import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import YAML from 'yaml'

export class StateValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'StateValidationError'
  }
}

export class StateLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateLockError'
  }
}

/** Threshold in milliseconds after which an existing lock file is considered stale and eligible for removal. */
export const STALE_LOCK_THRESHOLD_MS = 60_000

export class StateStore {
  private readonly basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  async read<T>(filePath: string, schema: z.ZodSchema<T>): Promise<T> {
    const fullPath = join(this.basePath, filePath)
    const content = await readFile(fullPath, 'utf-8')
    const data = YAML.parse(content)
    const result = schema.safeParse(data)
    if (!result.success) {
      throw new StateValidationError(
        `Schema validation failed for ${filePath}: ${result.error.message}`,
        result.error.issues,
      )
    }
    return result.data
  }

  async write<T>(filePath: string, schema: z.ZodSchema<T>, data: T): Promise<void> {
    const result = schema.safeParse(data)
    if (!result.success) {
      throw new StateValidationError(
        `Schema validation failed before writing ${filePath}: ${result.error.message}`,
        result.error.issues,
      )
    }
    const fullPath = join(this.basePath, filePath)
    await mkdir(dirname(fullPath), { recursive: true })
    const content = YAML.stringify(result.data, { lineWidth: 0 })
    await writeFile(fullPath, content, 'utf-8')
  }

  async exists(filePath: string): Promise<boolean> {
    const fullPath = join(this.basePath, filePath)
    try {
      await stat(fullPath)
      return true
    } catch {
      return false
    }
  }

  async readRaw(filePath: string): Promise<string> {
    const fullPath = join(this.basePath, filePath)
    return readFile(fullPath, 'utf-8')
  }

  async writeRaw(filePath: string, content: string): Promise<void> {
    const fullPath = join(this.basePath, filePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, 'utf-8')
  }

  async delete(filePath: string): Promise<void> {
    const fullPath = join(this.basePath, filePath)
    await unlink(fullPath)
  }

  /** Deletes a file if it exists. Unlike `delete`, does not throw when the file is missing. */
  async deleteIfExists(filePath: string): Promise<void> {
    const fullPath = join(this.basePath, filePath)
    try {
      await unlink(fullPath)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw err
    }
  }

  /**
   * Acquires an advisory lock by creating a file at `lockFile` (resolved relative to basePath).
   *
   * Lock file placement convention: lock files should be placed alongside the state file
   * they guard, using the pattern `<state-file>.lock`. For example, a lock guarding
   * `changes/abc.yaml` should be `changes/abc.yaml.lock`. Parent directories are created
   * automatically if they do not exist.
   */
  async acquireLock(lockFile: string, timeout: number = 5000): Promise<() => Promise<void>> {
    const fullPath = join(this.basePath, lockFile)
    const start = Date.now()

    while (Date.now() - start < timeout) {
      try {
        await mkdir(dirname(fullPath), { recursive: true })
        const fd = await writeFile(fullPath, JSON.stringify({
          pid: process.pid,
          acquired: new Date().toISOString(),
        }), { flag: 'wx' })
        return async () => {
          try {
            await unlink(fullPath)
          } catch {
            // Lock file already removed
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Check if the lock is stale (older than STALE_LOCK_THRESHOLD_MS)
          try {
            const lockStat = await stat(fullPath)
            const age = Date.now() - lockStat.mtimeMs
            if (age > STALE_LOCK_THRESHOLD_MS) {
              await unlink(fullPath)
              continue
            }
          } catch {
            continue
          }
          await new Promise(resolve => setTimeout(resolve, 100))
          continue
        }
        throw err
      }
    }

    throw new StateLockError(
      `Failed to acquire lock ${lockFile} within ${timeout}ms. Another process may be holding it.`,
    )
  }

  getFullPath(filePath: string): string {
    return join(this.basePath, filePath)
  }
}
