import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm } from 'node:fs/promises'

const execAsync = promisify(execFile)

export class HeadAdvancedError extends Error {
  constructor(
    public readonly baseCommit: string,
    public readonly currentHead: string,
    public readonly branch: string,
  ) {
    super(
      `HEAD has advanced since worktree was created for branch ${branch}. ` +
      `Base commit: ${baseCommit}, current HEAD: ${currentHead}. ` +
      `Rebase failed — aborting merge to prevent silent data loss.`,
    )
    this.name = 'HeadAdvancedError'
  }
}

export interface Worktree {
  path: string
  branch: string
  baseCommit: string
}

export interface WorktreeMergeResult {
  status: 'clean' | 'conflict' | 'error'
  changedFiles: string[]
  detail?: string
}

export class WorktreeManager {
  constructor(private readonly repoRoot: string) {}

  async create(changeName: string, taskId: string): Promise<Worktree> {
    const branch = `metta/${changeName}/task-${taskId}`
    const worktreePath = join(tmpdir(), `metta-worktree-${changeName}-${taskId}-${Date.now()}`)

    // Get current HEAD
    const { stdout: baseCommit } = await execAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: this.repoRoot },
    )

    // Create branch from current HEAD
    await execAsync(
      'git', ['branch', branch, 'HEAD'],
      { cwd: this.repoRoot },
    ).catch(() => {
      // Branch may already exist
    })

    // Create worktree
    await mkdir(worktreePath, { recursive: true })
    await execAsync(
      'git', ['worktree', 'add', worktreePath, branch],
      { cwd: this.repoRoot },
    )

    return {
      path: worktreePath,
      branch,
      baseCommit: baseCommit.trim(),
    }
  }

  /**
   * Merge order contract:
   *
   * When merging parallel task worktrees, the engine MUST merge them in the
   * order tasks appear in `BatchPlan.batches[n].tasks`. Each merge MUST
   * complete before the next begins (sequential merge after parallel execution).
   *
   * Before merging, we verify that the repository HEAD has not advanced past
   * the worktree's `baseCommit`. If HEAD has advanced (e.g., a prior worktree
   * merge moved it forward, or an external process committed), we attempt a
   * rebase of the worktree branch onto the current HEAD. If the rebase fails
   * (conflicts), the merge is aborted with a `HeadAdvancedError` to prevent
   * silent data loss.
   */
  async merge(worktree: Worktree, targetBranch?: string): Promise<WorktreeMergeResult> {
    const target = targetBranch ?? await this.currentBranch()

    // Base commit safety check: verify HEAD has not advanced since worktree creation.
    // If it has, rebase the worktree branch onto the current HEAD before merging.
    const currentHead = await this.resolveHead()
    if (currentHead !== worktree.baseCommit) {
      try {
        await execAsync(
          'git', ['rebase', currentHead, worktree.branch],
          { cwd: this.repoRoot },
        )
      } catch {
        // Abort the failed rebase to leave the repo in a clean state
        await execAsync('git', ['rebase', '--abort'], { cwd: this.repoRoot }).catch(() => {})
        throw new HeadAdvancedError(worktree.baseCommit, currentHead, worktree.branch)
      }
    }

    // Get changed files (use current HEAD as the base since we may have rebased)
    const mergeBase = currentHead !== worktree.baseCommit ? currentHead : worktree.baseCommit
    const { stdout: diffOutput } = await execAsync(
      'git', ['diff', '--name-only', `${mergeBase}...${worktree.branch}`],
      { cwd: this.repoRoot },
    ).catch(() => ({ stdout: '' }))
    const changedFiles = diffOutput.trim().split('\n').filter(Boolean)

    // Try merge
    try {
      await execAsync(
        'git', ['merge', '--no-ff', worktree.branch, '-m', `chore: merge task worktree ${worktree.branch}`],
        { cwd: this.repoRoot },
      )
      return { status: 'clean', changedFiles }
    } catch (err) {
      // Abort failed merge
      await execAsync('git', ['merge', '--abort'], { cwd: this.repoRoot }).catch(() => {})
      return {
        status: 'conflict',
        changedFiles,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async remove(worktree: Worktree): Promise<void> {
    try {
      await execAsync(
        'git', ['worktree', 'remove', worktree.path, '--force'],
        { cwd: this.repoRoot },
      )
    } catch {
      // Worktree may already be removed
      await rm(worktree.path, { recursive: true, force: true })
    }

    // Clean up branch
    try {
      await execAsync(
        'git', ['branch', '-D', worktree.branch],
        { cwd: this.repoRoot },
      )
    } catch {
      // Branch may already be deleted
    }
  }

  async list(): Promise<Array<{ path: string; branch: string }>> {
    try {
      const { stdout } = await execAsync(
        'git', ['worktree', 'list', '--porcelain'],
        { cwd: this.repoRoot },
      )
      const worktrees: Array<{ path: string; branch: string }> = []
      let current: { path?: string; branch?: string } = {}

      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          current.path = line.slice(9)
        } else if (line.startsWith('branch refs/heads/')) {
          current.branch = line.slice(18)
        } else if (line === '') {
          if (current.path && current.branch?.startsWith('metta/')) {
            worktrees.push({ path: current.path, branch: current.branch })
          }
          current = {}
        }
      }
      return worktrees
    } catch {
      return []
    }
  }

  async cleanup(): Promise<number> {
    const worktrees = await this.list()
    let cleaned = 0
    for (const wt of worktrees) {
      await this.remove({ path: wt.path, branch: wt.branch, baseCommit: '' })
      cleaned++
    }
    return cleaned
  }

  async resolveHead(): Promise<string> {
    const { stdout } = await execAsync(
      'git', ['rev-parse', 'HEAD'],
      { cwd: this.repoRoot },
    )
    return stdout.trim()
  }

  private async currentBranch(): Promise<string> {
    const { stdout } = await execAsync(
      'git', ['branch', '--show-current'],
      { cwd: this.repoRoot },
    )
    return stdout.trim()
  }
}
