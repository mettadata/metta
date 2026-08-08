import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { getErrorMessage } from './errors.js'

const execAsync = promisify(execFile)

/** Default base directory (relative to the project root) for change worktrees. */
export const DEFAULT_WORKTREE_DIR = '.metta/worktrees'

/**
 * Detect the change name from a cwd inside a change worktree.
 *
 * Pure path-segment math — no filesystem I/O (callers do any realpathSync
 * resolution first). Splits the normalized `cwd` into segments, splits
 * `worktreeDir` into its own segments (e.g. `.metta`, `worktrees`), then
 * finds the LAST adjacent occurrence of that segment run which has a
 * following segment and returns that following segment (the change name).
 * Returns null when the cwd is not inside a worktree path.
 */
export function detectWorktreeChangeName(
  cwd: string,
  worktreeDir: string = DEFAULT_WORKTREE_DIR,
): string | null {
  const segments = resolve(cwd)
    .split(sep)
    .filter((segment) => segment.length > 0)
  const pair = worktreeDir
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
  if (pair.length === 0) {
    return null
  }

  // Walk backwards so the LAST occurrence with a following segment wins.
  for (let i = segments.length - pair.length - 1; i >= 0; i--) {
    if (pair.every((part, j) => segments[i + j] === part)) {
      return segments[i + pair.length]
    }
  }
  return null
}

/** Subset of the project git config consumed by worktree setup. */
export interface WorktreeGitConfig {
  enabled?: boolean
  worktree?: {
    enabled?: boolean
    dir?: string
  }
}

export type ChangeGitMode =
  /** New branch created together with a new worktree. */
  | 'created'
  /** Branch already existed — new worktree attached to it. */
  | 'attached'
  /** Worktree directory already existed for this change — reused as-is. */
  | 'reused'
  /** In-place `git checkout -b` (worktrees disabled or worktree add failed). */
  | 'fallback'
  /** Git integration disabled entirely (`git.enabled: false`). */
  | 'skipped'

export interface ChangeGitSetup {
  /** Branch in use for the change, or null when no branch could be set up. */
  branch: string | null
  /** Absolute worktree path, or null in fallback/skipped modes. */
  worktree: string | null
  mode: ChangeGitMode
  /** Human-readable reason when mode is 'fallback'. */
  fallbackReason?: string
}

/**
 * Set up the git side of starting a change: create (or attach/reuse) a
 * worktree at `<projectRoot>/<git.worktree.dir>/<changeName>` on branch
 * `metta/<changeName>`, so the main checkout never switches branches.
 *
 * Behavior rules:
 * - `git.enabled === false` → no git action at all (mode 'skipped').
 * - `git.worktree.enabled === false` or any `git worktree add` failure →
 *   graceful fallback to the historical in-place `git checkout -b`
 *   (mode 'fallback'); never throws for git failures.
 * - Branch already exists → attach the worktree without `-b`.
 * - Worktree directory already exists → reuse it.
 * - No clean-tree precondition on the main checkout.
 */
export async function setupChangeWorktree(
  projectRoot: string,
  changeName: string,
  gitConfig?: WorktreeGitConfig,
): Promise<ChangeGitSetup> {
  if (gitConfig?.enabled === false) {
    return { branch: null, worktree: null, mode: 'skipped' }
  }

  const branch = `metta/${changeName}`

  if (gitConfig?.worktree?.enabled === false) {
    return fallbackCheckout(projectRoot, branch, 'worktrees disabled (git.worktree.enabled: false)')
  }

  const baseDir = gitConfig?.worktree?.dir ?? DEFAULT_WORKTREE_DIR
  const worktreePath = resolve(projectRoot, baseDir, changeName)

  if (await pathExists(worktreePath)) {
    return { branch, worktree: worktreePath, mode: 'reused' }
  }

  const branchExists = await gitBranchExists(projectRoot, branch)
  try {
    const args = branchExists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', worktreePath, '-b', branch]
    await execAsync('git', args, { cwd: projectRoot })
    try {
      await ensureGitignoreEntry(projectRoot, baseDir)
    } catch {
      // Best-effort: a .gitignore write failure must not fail change creation.
    }
    return { branch, worktree: worktreePath, mode: branchExists ? 'attached' : 'created' }
  } catch (err) {
    // A failed `worktree add -b` can leave the branch behind. Remove it so
    // the fallback `checkout -b` sees the exact pre-call state.
    if (!branchExists) {
      try {
        await execAsync('git', ['branch', '-D', branch], { cwd: projectRoot })
      } catch {
        // Branch was never created (or already gone) — nothing to undo.
      }
    }
    return fallbackCheckout(projectRoot, branch, `git worktree add failed: ${getErrorMessage(err)}`)
  }
}

/**
 * Historical in-place branch creation. Mirrors the pre-worktree behavior of
 * propose/quick exactly: attempt `git checkout -b`, and swallow any failure
 * (branch already exists, not a git repo, git unavailable) leaving branch null.
 */
async function fallbackCheckout(
  projectRoot: string,
  branch: string,
  reason: string,
): Promise<ChangeGitSetup> {
  try {
    await execAsync('git', ['checkout', '-b', branch], { cwd: projectRoot })
    return { branch, worktree: null, mode: 'fallback', fallbackReason: reason }
  } catch {
    return { branch: null, worktree: null, mode: 'fallback', fallbackReason: reason }
  }
}

/**
 * Ensure the worktree base dir is gitignored in the project root .gitignore.
 * Appends `<baseDir>/` when no matching entry exists (creates the file when
 * missing). Returns true when an entry was appended.
 */
export async function ensureGitignoreEntry(projectRoot: string, baseDir: string): Promise<boolean> {
  const normalized = baseDir.replace(/^\.\//, '').replace(/\/+$/, '')
  const entry = `${normalized}/`
  const gitignorePath = join(projectRoot, '.gitignore')

  let existing = ''
  try {
    existing = await readFile(gitignorePath, 'utf8')
  } catch {
    // No .gitignore yet — it will be created below.
  }

  const lines = existing.split('\n').map((line) => line.trim())
  const candidates = [entry, normalized, `/${entry}`, `/${normalized}`]
  if (candidates.some((candidate) => lines.includes(candidate))) {
    return false
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  await appendFile(gitignorePath, `${prefix}${entry}\n`, 'utf8')
  return true
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function gitBranchExists(projectRoot: string, branch: string): Promise<boolean> {
  try {
    await execAsync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: projectRoot,
    })
    return true
  } catch {
    return false
  }
}
