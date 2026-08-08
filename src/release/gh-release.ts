import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Outcome of an attempted GitHub release publication.
 *
 * The gh edge never throws into the pipeline — every failure mode maps to a
 * typed outcome so the local release is never rolled back or invalidated by a
 * GitHub publication problem (spec: Graceful Degradation When gh Unavailable).
 */
export type GhOutcome =
  | { status: 'created'; tag: string }
  | { status: 'missing-binary'; remedy: string }
  | { status: 'unauthenticated'; remedy: string }
  | { status: 'failed'; detail: string }

/**
 * Minimal exec contract used by the gh edge. Arguments are passed as an
 * array — never interpolated into a shell string. Tests inject a stub;
 * production uses promisified `execFile` from `node:child_process`.
 */
export type GhExec = (
  file: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>

const defaultExec: GhExec = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], { cwd: options.cwd })
  return { stdout: String(stdout), stderr: String(stderr) }
}

function manualRetryCommand(tag: string, title: string): string {
  return `gh release create ${tag} --title "${title}" --notes "<notes>"`
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as NodeJS.ErrnoException & { stderr?: unknown }).stderr
    const stderrText = typeof stderr === 'string' ? stderr.trim() : ''
    return stderrText.length > 0 ? `${error.message}: ${stderrText}` : error.message
  }
  return String(error)
}

/**
 * Create a GitHub release for `tag` via the `gh` CLI.
 *
 * Probe order: binary presence (`gh --version`), then `gh auth status`, then
 * `gh release create`. A failed probe short-circuits — no further gh
 * invocation is attempted. This function never rejects; every failure maps to
 * a typed {@link GhOutcome} whose remedy names the cause and the manual retry
 * command.
 */
export async function createGithubRelease(
  cwd: string,
  tag: string,
  title: string,
  notes: string,
  exec: GhExec = defaultExec,
): Promise<GhOutcome> {
  const retry = manualRetryCommand(tag, title)

  try {
    await exec('gh', ['--version'], { cwd })
  } catch {
    return {
      status: 'missing-binary',
      remedy:
        `The gh binary was not found on PATH, so the GitHub release for ${tag} was not created. ` +
        `The local release (version file, changelog, commit, tag) is unaffected. ` +
        `Install the GitHub CLI (https://cli.github.com), then publish manually: ${retry}`,
    }
  }

  try {
    await exec('gh', ['auth', 'status'], { cwd })
  } catch {
    return {
      status: 'unauthenticated',
      remedy:
        `gh is installed but not authenticated, so the GitHub release for ${tag} was not created. ` +
        `The local release (version file, changelog, commit, tag) is unaffected. ` +
        `Run gh auth login, then publish manually: ${retry}`,
    }
  }

  try {
    await exec('gh', ['release', 'create', tag, '--title', title, '--notes', notes], { cwd })
    return { status: 'created', tag }
  } catch (error) {
    return {
      status: 'failed',
      detail:
        `gh release create failed for ${tag}: ${errorDetail(error)}. ` +
        `The local release is unaffected. Retry manually: ${retry}`,
    }
  }
}
