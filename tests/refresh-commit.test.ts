import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { autoCommitFile } from '../src/cli/helpers.js'
import { runRefresh } from '../src/cli/commands/refresh.js'

const execAsync = promisify(execFile)

describe('refresh auto-commit', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-refresh-commit-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function git(args: string[], cwd: string = tempDir): Promise<string> {
    const { stdout } = await execAsync('git', args, { cwd })
    return stdout
  }

  async function seedSpecs(root: string): Promise<void> {
    await mkdir(join(root, 'spec', 'specs', 'widget-engine'), { recursive: true })
    await writeFile(
      join(root, 'spec', 'project.md'),
      `# Constitution
## Project
A refresh auto-commit test project.

## Stack
- TypeScript
- Vitest

## Conventions
- Use classes

## Off-Limits
- No CommonJS
`,
    )
    await writeFile(
      join(root, 'spec', 'specs', 'widget-engine', 'spec.md'),
      'The widget engine MUST load. It SHALL render. It MUST emit events.',
    )
  }

  async function initRepo(root: string = tempDir): Promise<void> {
    await git(['init', '--initial-branch=main'], root)
    await git(['config', 'user.email', 't@t.com'], root)
    await git(['config', 'user.name', 'T'], root)
  }

  async function seedInitialCommit(root: string = tempDir): Promise<void> {
    await writeFile(join(root, 'README.md'), '# seed\n')
    await git(['add', 'README.md'], root)
    await git(['commit', '-m', 'init'], root)
  }

  async function commitCount(root: string = tempDir): Promise<number> {
    try {
      const stdout = await git(['rev-list', '--count', 'HEAD'], root)
      return parseInt(stdout.trim(), 10)
    } catch {
      return 0
    }
  }

  it('commits CLAUDE.md with the refresh message on the happy path', async () => {
    await initRepo()
    await seedInitialCommit()
    await seedSpecs(tempDir)

    const result = await runRefresh(tempDir, false)
    expect(result.written).toBe(true)

    const commitResult = await autoCommitFile(
      tempDir,
      result.filePath,
      'chore(refresh): regenerate CLAUDE.md',
    )
    expect(commitResult.committed).toBe(true)
    expect(commitResult.sha).toMatch(/^[0-9a-f]{40}$/)

    const subject = (await git(['log', '-1', '--pretty=%s'])).trim()
    expect(subject).toBe('chore(refresh): regenerate CLAUDE.md')

    const porcelain = await git(['status', '--porcelain'])
    expect(porcelain).not.toMatch(/CLAUDE\.md/)
  })

  it('leaves CLAUDE.md uncommitted when auto-commit is skipped (--no-commit)', async () => {
    await initRepo()
    await seedInitialCommit()
    await seedSpecs(tempDir)

    const before = await commitCount()

    // Simulate --no-commit by invoking runRefresh alone without autoCommitFile.
    const result = await runRefresh(tempDir, false)
    expect(result.written).toBe(true)

    const after = await commitCount()
    expect(after).toBe(before)

    const porcelain = await git(['status', '--porcelain'])
    expect(porcelain).toMatch(/CLAUDE\.md/)
  })

  it('returns a structured result (no throw) when invoked outside a git repository', async () => {
    await seedSpecs(tempDir)
    const result = await runRefresh(tempDir, false)
    expect(result.written).toBe(true)

    const commitResult = await autoCommitFile(
      tempDir,
      result.filePath,
      'chore(refresh): regenerate CLAUDE.md',
    )
    expect(commitResult).toEqual({ committed: false, reason: 'not a git repository' })
  })

  it('does not create a second commit when content is unchanged', async () => {
    await initRepo()
    await seedInitialCommit()
    await seedSpecs(tempDir)

    // First run — happy path.
    const firstResult = await runRefresh(tempDir, false)
    expect(firstResult.written).toBe(true)
    const firstCommit = await autoCommitFile(
      tempDir,
      firstResult.filePath,
      'chore(refresh): regenerate CLAUDE.md',
    )
    expect(firstCommit.committed).toBe(true)

    const firstCount = await commitCount()

    // Second run — should be a no-op.
    const secondResult = await runRefresh(tempDir, false)
    expect(secondResult.written).toBe(false)

    // Even if we do call autoCommitFile, nothing should change because the
    // tree is clean and CLAUDE.md is unmodified.
    const secondCommit = await autoCommitFile(
      tempDir,
      secondResult.filePath,
      'chore(refresh): regenerate CLAUDE.md',
    )
    expect(secondCommit.committed).toBe(false)

    const secondCount = await commitCount()
    expect(secondCount).toBe(firstCount)
  })

  it('writes CLAUDE.md but refuses to commit when an unrelated tracked file is dirty', async () => {
    await initRepo()
    await seedInitialCommit()
    await seedSpecs(tempDir)

    // Create and commit an unrelated tracked file.
    const unrelated = join(tempDir, 'notes.txt')
    await writeFile(unrelated, 'original\n')
    await git(['add', 'notes.txt'])
    await git(['commit', '-m', 'add notes'])

    // Now dirty that file without committing.
    await writeFile(unrelated, 'dirty edit\n')

    const result = await runRefresh(tempDir, false)
    expect(result.written).toBe(true)

    const commitResult = await autoCommitFile(
      tempDir,
      result.filePath,
      'chore(refresh): regenerate CLAUDE.md',
    )
    expect(commitResult.committed).toBe(false)
    expect(commitResult.reason).toBeTruthy()
  })
})
