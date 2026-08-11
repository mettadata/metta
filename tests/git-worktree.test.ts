import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  setupChangeWorktree,
  ensureGitignoreEntry,
  detectWorktreeChangeName,
  DEFAULT_WORKTREE_DIR,
} from '../src/util/git-worktree.js'

const execAsync = promisify(execFile)

describe('setupChangeWorktree', () => {
  let tempDir: string

  beforeEach(async () => {
    // realpath: on macOS/some Linux setups tmpdir is a symlink; git prints
    // resolved paths, so resolve up front to keep comparisons stable.
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'metta-worktree-')))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function git(args: string[], cwd: string = tempDir): Promise<string> {
    const { stdout } = await execAsync('git', args, { cwd })
    return stdout.trim()
  }

  async function initRepo(): Promise<void> {
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.email', 't@t.com'])
    await git(['config', 'user.name', 'T'])
    await writeFile(join(tempDir, 'seed.txt'), 'seed\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'init'])
  }

  it('creates a new branch and worktree; main checkout stays on main', async () => {
    await initRepo()
    const result = await setupChangeWorktree(tempDir, 'my-change')

    expect(result.mode).toBe('created')
    expect(result.branch).toBe('metta/my-change')
    expect(result.worktree).toBe(join(tempDir, DEFAULT_WORKTREE_DIR, 'my-change'))

    // Worktree exists and is checked out on the feature branch
    const wtBranch = await git(['branch', '--show-current'], result.worktree!)
    expect(wtBranch).toBe('metta/my-change')

    // Main checkout never switched branches
    const mainBranch = await git(['branch', '--show-current'])
    expect(mainBranch).toBe('main')
  })

  it('works with a dirty main checkout (no clean-tree precondition)', async () => {
    await initRepo()
    await writeFile(join(tempDir, 'seed.txt'), 'dirty edit\n')
    const result = await setupChangeWorktree(tempDir, 'dirty-ok')
    expect(result.mode).toBe('created')
    expect(result.worktree).not.toBeNull()
  })

  it('attaches to an existing branch instead of erroring', async () => {
    await initRepo()
    await git(['branch', 'metta/existing-branch'])
    const result = await setupChangeWorktree(tempDir, 'existing-branch')

    expect(result.mode).toBe('attached')
    expect(result.branch).toBe('metta/existing-branch')
    const wtBranch = await git(['branch', '--show-current'], result.worktree!)
    expect(wtBranch).toBe('metta/existing-branch')
  })

  it('reuses an existing worktree directory for the same change', async () => {
    await initRepo()
    const first = await setupChangeWorktree(tempDir, 'again')
    expect(first.mode).toBe('created')

    const second = await setupChangeWorktree(tempDir, 'again')
    expect(second.mode).toBe('reused')
    expect(second.worktree).toBe(first.worktree)
    expect(second.branch).toBe('metta/again')
  })

  it('respects a custom git.worktree.dir', async () => {
    await initRepo()
    const result = await setupChangeWorktree(tempDir, 'custom-dir', {
      worktree: { enabled: true, dir: '.wt' },
    })
    expect(result.mode).toBe('created')
    expect(result.worktree).toBe(join(tempDir, '.wt', 'custom-dir'))
    await stat(result.worktree!)
  })

  it('falls back to in-place checkout when worktrees are disabled', async () => {
    await initRepo()
    const result = await setupChangeWorktree(tempDir, 'opt-out', {
      worktree: { enabled: false },
    })

    expect(result.mode).toBe('fallback')
    expect(result.worktree).toBeNull()
    expect(result.branch).toBe('metta/opt-out')
    expect(result.fallbackReason).toContain('git.worktree.enabled')

    // In-place checkout: main checkout IS on the feature branch
    const mainBranch = await git(['branch', '--show-current'])
    expect(mainBranch).toBe('metta/opt-out')
  })

  it('falls back to in-place checkout when git worktree add fails', async () => {
    await initRepo()
    // Block the worktree base dir with a regular file so `git worktree add`
    // fails, but `git checkout -b` succeeds — the graceful fallback path.
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(join(tempDir, '.metta', 'worktrees'), 'blocker\n')
    const result = await setupChangeWorktree(tempDir, 'blocked-dir')

    expect(result.mode).toBe('fallback')
    expect(result.worktree).toBeNull()
    expect(result.branch).toBe('metta/blocked-dir')
    expect(result.fallbackReason).toContain('git worktree add failed')

    const mainBranch = await git(['branch', '--show-current'])
    expect(mainBranch).toBe('metta/blocked-dir')
  })

  it('returns branch null (still fallback, never throws) outside a git repo', async () => {
    const result = await setupChangeWorktree(tempDir, 'not-a-repo')
    expect(result.mode).toBe('fallback')
    expect(result.branch).toBeNull()
    expect(result.worktree).toBeNull()
  })

  it('does nothing when git is disabled entirely', async () => {
    await initRepo()
    const result = await setupChangeWorktree(tempDir, 'git-off', { enabled: false })
    expect(result.mode).toBe('skipped')
    expect(result.branch).toBeNull()
    expect(result.worktree).toBeNull()
    const mainBranch = await git(['branch', '--show-current'])
    expect(mainBranch).toBe('main')
  })

  it('adds the worktree base dir to .gitignore on first worktree creation', async () => {
    await initRepo()
    await setupChangeWorktree(tempDir, 'ignore-me')
    const gitignore = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.metta/worktrees/')
  })
})

describe('detectWorktreeChangeName', () => {
  it('returns the change name when cwd is exactly the worktree root', () => {
    expect(detectWorktreeChangeName('/repo/.metta/worktrees/beta')).toBe('beta')
  })

  it('returns the change name when cwd is nested below the worktree root', () => {
    expect(detectWorktreeChangeName('/repo/.metta/worktrees/beta/src/deep')).toBe('beta')
  })

  it('last occurrence wins when the path contains two worktree-pair occurrences', () => {
    expect(
      detectWorktreeChangeName('/repo/.metta/worktrees/alpha/.metta/worktrees/beta/src'),
    ).toBe('beta')
  })

  it('returns null for the repo root', () => {
    expect(detectWorktreeChangeName('/repo')).toBeNull()
  })

  it('returns null for an unrelated cwd', () => {
    expect(detectWorktreeChangeName('/home/user/projects/other')).toBeNull()
  })

  it('returns null when the pair segments are not adjacent', () => {
    expect(detectWorktreeChangeName('/x/.metta/other/worktrees/y')).toBeNull()
  })

  it('returns null when the pair has no following segment', () => {
    expect(detectWorktreeChangeName('/repo/.metta/worktrees')).toBeNull()
  })

  it('tolerates trailing separators', () => {
    expect(detectWorktreeChangeName('/repo/.metta/worktrees/beta/')).toBe('beta')
    expect(detectWorktreeChangeName('/repo/.metta/worktrees/beta///')).toBe('beta')
  })

  it('respects a custom worktreeDir', () => {
    expect(detectWorktreeChangeName('/repo/.wt/gamma/src', '.wt')).toBe('gamma')
    expect(detectWorktreeChangeName('/repo/.metta/worktrees/beta', '.wt')).toBeNull()
  })
})

describe('ensureGitignoreEntry', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-gitignore-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('creates .gitignore when missing', async () => {
    const added = await ensureGitignoreEntry(tempDir, '.metta/worktrees')
    expect(added).toBe(true)
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(content).toBe('.metta/worktrees/\n')
  })

  it('appends to an existing .gitignore, preserving content', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'node_modules/\n')
    const added = await ensureGitignoreEntry(tempDir, '.metta/worktrees')
    expect(added).toBe(true)
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(content).toBe('node_modules/\n.metta/worktrees/\n')
  })

  it('adds a trailing newline separator when the file does not end in one', async () => {
    await writeFile(join(tempDir, '.gitignore'), 'dist')
    await ensureGitignoreEntry(tempDir, '.metta/worktrees')
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(content).toBe('dist\n.metta/worktrees/\n')
  })

  it('is idempotent — does not duplicate an existing entry', async () => {
    await writeFile(join(tempDir, '.gitignore'), '.metta/worktrees/\n')
    const added = await ensureGitignoreEntry(tempDir, '.metta/worktrees')
    expect(added).toBe(false)
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(content).toBe('.metta/worktrees/\n')
  })

  it('recognizes equivalent entry spellings (no trailing slash, leading slash)', async () => {
    await writeFile(join(tempDir, '.gitignore'), '/.metta/worktrees\n')
    const added = await ensureGitignoreEntry(tempDir, '.metta/worktrees')
    expect(added).toBe(false)
  })

  it('normalizes leading ./ and trailing slashes in the configured dir', async () => {
    const added = await ensureGitignoreEntry(tempDir, './custom/wt//')
    expect(added).toBe(true)
    const content = await readFile(join(tempDir, '.gitignore'), 'utf8')
    expect(content).toBe('custom/wt/\n')
  })
})
