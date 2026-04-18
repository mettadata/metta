import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { autoCommitFile } from '../src/cli/helpers.js'

const execAsync = promisify(execFile)

describe('autoCommitFile', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-autocommit-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function git(args: string[]): Promise<void> {
    await execAsync('git', args, { cwd: tempDir })
  }

  async function initRepo(): Promise<void> {
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.email', 't@t.com'])
    await git(['config', 'user.name', 'T'])
    await writeFile(join(tempDir, 'seed.txt'), 'seed\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'init'])
  }

  it('commits the file when working tree is clean', async () => {
    await initRepo()
    const filePath = join(tempDir, 'issue.md')
    await writeFile(filePath, '# issue\n')
    const result = await autoCommitFile(tempDir, filePath, 'chore: log issue x')
    expect(result.committed).toBe(true)
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('returns not committed when not a git repository', async () => {
    const filePath = join(tempDir, 'issue.md')
    await writeFile(filePath, '# issue\n')
    const result = await autoCommitFile(tempDir, filePath, 'chore: log issue x')
    expect(result.committed).toBe(false)
    expect(result.reason).toMatch(/not a git repository/i)
  })

  it('skips commit when tracked files have other uncommitted changes and lists them', async () => {
    await initRepo()
    await writeFile(join(tempDir, 'seed.txt'), 'modified\n')
    await writeFile(join(tempDir, 'other.txt'), 'tracked\n')
    await git(['add', 'other.txt'])
    await git(['commit', '-m', 'add other'])
    await writeFile(join(tempDir, 'other.txt'), 'modified-other\n')
    const filePath = join(tempDir, 'issue.md')
    await writeFile(filePath, '# issue\n')
    const result = await autoCommitFile(tempDir, filePath, 'chore: log issue x')
    expect(result.committed).toBe(false)
    expect(result.reason).toMatch(/uncommitted tracked change/i)
    expect(result.reason).toContain('seed.txt')
    expect(result.reason).toContain('other.txt')
    expect(result.reason).toMatch(/^working tree has 2 /)
  })

  it('commits even when unrelated untracked files exist', async () => {
    await initRepo()
    await writeFile(join(tempDir, 'scratch.tmp'), 'stray\n')
    const filePath = join(tempDir, 'issue.md')
    await writeFile(filePath, '# issue\n')
    const result = await autoCommitFile(tempDir, filePath, 'chore: log issue x')
    expect(result.committed).toBe(true)
  })
})
