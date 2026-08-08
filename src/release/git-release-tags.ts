import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CommitInput } from './bump-derivation.js'

const execFileAsync = promisify(execFile)

/** Record separator emitted via `%x1e` in the git log format. */
const RECORD_SEPARATOR = '\x1e'
/** Field separator emitted via `%x1f` between subject and body. */
const FIELD_SEPARATOR = '\x1f'

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

/**
 * List release tags matching `{tagPrefix}[0-9]*`, newest first by version
 * order (`--sort=-version:refname`), so `v0.10.0` sorts above `v0.2.0`.
 *
 * The glob is passed as a plain argument to `git tag --list` — git performs
 * the matching; no shell is involved.
 */
export async function listReleaseTags(cwd: string, tagPrefix: string): Promise<string[]> {
  const stdout = await git(cwd, [
    'tag',
    '--list',
    `${tagPrefix}[0-9]*`,
    '--sort=-version:refname',
  ])
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

/**
 * True when `refs/tags/<tag>` resolves. A non-zero `git rev-parse` exit
 * (unknown tag) resolves to `false` rather than throwing.
 */
export async function tagExists(cwd: string, tag: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
    return true
  } catch {
    return false
  }
}

/**
 * Collect commits reachable from HEAD — restricted to those after `tag` when
 * one is given — as `CommitInput` records for bump derivation.
 *
 * Uses `git log --format=%s%x1f%b%x1e` and parses the 0x1f/0x1e-delimited
 * stream, so multi-line bodies (e.g. `BREAKING CHANGE:` footers) survive
 * intact. Deliberately NOT `--first-parent`: the bump signal lives on branch
 * commits underneath `chore: merge metta/x` merge commits, so the full log is
 * required. Commits are returned newest first, matching git log order.
 */
export async function collectCommitsSince(
  cwd: string,
  tag: string | undefined,
): Promise<CommitInput[]> {
  const range = tag === undefined ? 'HEAD' : `${tag}..HEAD`
  const stdout = await git(cwd, [
    'log',
    range,
    `--format=%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
  ])
  const commits: CommitInput[] = []
  for (const rawRecord of stdout.split(RECORD_SEPARATOR)) {
    // git inserts a newline between records; strip it plus any stray
    // whitespace-only trailing chunk after the final separator.
    const record = rawRecord.replace(/^\n/, '')
    if (record.trim().length === 0 && !record.includes(FIELD_SEPARATOR)) continue
    const fieldIndex = record.indexOf(FIELD_SEPARATOR)
    if (fieldIndex === -1) continue
    const subject = record.slice(0, fieldIndex)
    const body = record.slice(fieldIndex + 1).replace(/\n+$/, '')
    commits.push({ subject, body })
  }
  return commits
}

/**
 * Backfill attribution: map each release tag to the archive dirNames it is
 * the *earliest* tag to contain, by checking each tag's tree with
 * `git ls-tree -d <tag> -- spec/archive/<dir>` (empty output = not
 * contained).
 *
 * - `tagsOldestFirst` must be ordered oldest → newest; each dir is attributed
 *   to the first (earliest) tag whose tree contains it.
 * - Returned map is keyed by tag (insertion order follows
 *   `tagsOldestFirst`); tags containing no attributed dir are omitted.
 * - Dirs contained in no tag are omitted entirely (they remain Unreleased).
 */
export async function attributeArchiveDirsToTags(
  cwd: string,
  tagsOldestFirst: string[],
  dirNames: string[],
): Promise<Map<string, string[]>> {
  const byTag = new Map<string, string[]>()
  for (const dirName of dirNames) {
    for (const tag of tagsOldestFirst) {
      const stdout = await git(cwd, ['ls-tree', '-d', tag, '--', `spec/archive/${dirName}`])
      if (stdout.trim().length === 0) continue
      const existing = byTag.get(tag)
      if (existing) {
        existing.push(dirName)
      } else {
        byTag.set(tag, [dirName])
      }
      break
    }
  }
  // Re-key in tagsOldestFirst order for deterministic iteration.
  const ordered = new Map<string, string[]>()
  for (const tag of tagsOldestFirst) {
    const dirs = byTag.get(tag)
    if (dirs) ordered.set(tag, dirs)
  }
  return ordered
}
