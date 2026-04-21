import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Read git author-date history for a single file relative to `projectRoot`
 * and return its earliest and latest commit timestamps. Intended as a
 * zero-infra fallback for artifact wall-clock when a change's
 * `artifact_timings` map is absent (e.g. a change authored before the
 * timing schema existed).
 *
 * Always resolves; never throws. Returns `null` when git is unavailable,
 * the path is untracked, or the file has no commit history.
 */
export async function getGitLogTimings(
  projectRoot: string,
  relativePath: string,
): Promise<{ first: Date; last: Date } | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--format=%aI', '--', relativePath],
      { cwd: projectRoot },
    )
    const lines = stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) return null
    // `git log` emits newest first.
    const last = new Date(lines[0])
    const first = new Date(lines[lines.length - 1])
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null
    return { first, last }
  } catch {
    return null
  }
}
