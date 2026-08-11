import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, disableWorktrees } from './helpers/cli.js'

describe('CLI: propose / quick create git worktrees', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    // realpath so path comparisons survive symlinked tmpdirs (the CLI resolves
    // its cwd to the real path).
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-cli-wt-')))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function currentBranch(cwd: string): Promise<string> {
    const { stdout } = await execAsync('git', ['branch', '--show-current'], { cwd })
    return stdout.trim()
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  it('propose creates the worktree, writes change state inside it, and leaves main alone', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const mainBefore = await currentBranch(tempDir)

    const { stdout, code } = await runCli(['--json', 'propose', 'add user profiles'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)

    const worktreePath = join(tempDir, '.metta', 'worktrees', 'user-profiles')
    expect(data.change).toBe('user-profiles')
    expect(data.branch).toBe('metta/user-profiles')
    expect(data.worktree).toBe(worktreePath)

    // Change state lives inside the worktree, not the main checkout
    expect(data.path).toBe(join(worktreePath, 'spec', 'changes', 'user-profiles'))
    expect(await exists(join(worktreePath, 'spec', 'changes', 'user-profiles', '.metta.yaml'))).toBe(true)
    expect(await exists(join(tempDir, 'spec', 'changes', 'user-profiles', '.metta.yaml'))).toBe(false)

    // The worktree path is persisted on the change record
    const meta = await readFile(
      join(worktreePath, 'spec', 'changes', 'user-profiles', '.metta.yaml'),
      'utf8',
    )
    expect(meta).toContain(`worktree: ${worktreePath}`)

    // Main checkout never switched branches; worktree is on the feature branch
    expect(await currentBranch(tempDir)).toBe(mainBefore)
    expect(await currentBranch(worktreePath)).toBe('metta/user-profiles')

    // Worktree base dir is gitignored
    const gitignore = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.metta/worktrees/')
  })

  it('quick creates a worktree with the same semantics', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const mainBefore = await currentBranch(tempDir)

    const { stdout, code } = await runCli(['--json', 'quick', 'fix typo'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)

    const worktreePath = join(tempDir, '.metta', 'worktrees', 'fix-typo')
    expect(data.change).toBe('fix-typo')
    expect(data.branch).toBe('metta/fix-typo')
    expect(data.worktree).toBe(worktreePath)
    expect(await exists(join(worktreePath, 'spec', 'changes', 'fix-typo', '.metta.yaml'))).toBe(true)
    expect(await currentBranch(tempDir)).toBe(mainBefore)
    expect(await currentBranch(worktreePath)).toBe('metta/fix-typo')
  })

  it('propose works with a dirty main checkout (no clean-tree precondition)', async () => {
    await runCli(['install', '--git-init'], tempDir)
    // install leaves .metta/config.yaml committed; dirty it up
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(tempDir, 'spec', 'project.md'), '\ndirty edit\n', 'utf8')

    const { stdout, code } = await runCli(['--json', 'propose', 'dirty tree change'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.worktree).toBe(join(tempDir, '.metta', 'worktrees', 'dirty-tree-change'))
  })

  it('falls back to in-place checkout when git.worktree.enabled is false', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await disableWorktrees(tempDir)

    const { stdout, code } = await runCli(['--json', 'propose', 'opt out change'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)

    expect(data.worktree).toBeNull()
    expect(data.branch).toBe('metta/opt-out-change')

    // In-place behavior: change state in the project root, main checkout switched
    expect(await exists(join(tempDir, 'spec', 'changes', 'opt-out-change', '.metta.yaml'))).toBe(true)
    expect(await currentBranch(tempDir)).toBe('metta/opt-out-change')

    // No worktree path persisted on the change record
    const meta = await readFile(
      join(tempDir, 'spec', 'changes', 'opt-out-change', '.metta.yaml'),
      'utf8',
    )
    expect(meta).not.toContain('worktree:')
  })

  it('never fails propose when worktree creation fails (graceful fallback)', async () => {
    await runCli(['install', '--git-init'], tempDir)
    // Point the worktree base dir at a path blocked by a regular file
    const { appendFile, writeFile } = await import('node:fs/promises')
    await writeFile(join(tempDir, 'blocker'), 'not a directory\n', 'utf8')
    await appendFile(
      join(tempDir, '.metta', 'config.yaml'),
      '\ngit:\n  worktree:\n    dir: blocker\n',
      'utf8',
    )

    const { stdout, code } = await runCli(['--json', 'propose', 'blocked worktree change'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.worktree).toBeNull()
    expect(data.branch).toBe('metta/blocked-worktree-change')
    expect(await exists(join(tempDir, 'spec', 'changes', 'blocked-worktree-change', '.metta.yaml'))).toBe(true)
    expect(await currentBranch(tempDir)).toBe('metta/blocked-worktree-change')
  })

  it('human output reports the worktree path', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const { stdout, code } = await runCli(['propose', 'human output change'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain(`Worktree: ${join(tempDir, '.metta', 'worktrees', 'human-output-change')}`)
    expect(stdout).toContain('Branch: metta/human-output-change')
  })
})
