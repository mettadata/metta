import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync } from './helpers/cli.js'

describe('CLI: roadmap', { timeout: 300000 }, () => {
  let tempDir: string

  const roadmapPath = (): string => join(tempDir, 'spec', 'roadmap.md')

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-roadmap-'))
    await runCli(['install', '--git-init'], tempDir)
  }, 60000)

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function seedBacklog(title: string): Promise<string> {
    const res = await runCli(['--json', 'backlog', 'add', title], tempDir)
    expect(res.code).toBe(0)
    return (JSON.parse(res.stdout) as { slug: string }).slug
  }

  async function checkoutFeatureBranch(): Promise<void> {
    await execAsync('git', ['checkout', '-b', 'metta/feature-x'], { cwd: tempDir })
  }

  describe('status view (default action)', () => {
    it('empty roadmap renders the friendly state in both modes, exit 0, no file created', async () => {
      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      expect(JSON.parse(jsonRes.stdout)).toEqual({ roadmap: [] })

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('Roadmap is empty. Add entries with: metta roadmap add <backlog-slug>')

      expect(existsSync(roadmapPath())).toBe(false)
    })

    it('lists entries in order with resolved titles and notes in both modes, exit 0, no writes', async () => {
      await seedBacklog('Auth refactor')
      await seedBacklog('Dark mode')
      await runCli(['roadmap', 'add', 'auth-refactor', '--note', 'after schema freeze'], tempDir)
      await runCli(['roadmap', 'add', 'dark-mode'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { roadmap: Array<Record<string, unknown>> }
      expect(data.roadmap).toEqual([
        { position: 1, slug: 'auth-refactor', title: 'Auth refactor', note: 'after schema freeze' },
        { position: 2, slug: 'dark-mode', title: 'Dark mode', note: null },
      ])
      // Healthy entries omit the dangling flag entirely.
      expect('dangling' in data.roadmap[0]).toBe(false)

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/1\. auth-refactor\s+Auth refactor — after schema freeze/)
      expect(textRes.stdout).toMatch(/2\. dark-mode\s+Dark mode/)

      // The read-only view never writes.
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })

    it('works on a non-main branch with no branch guard', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      await checkoutFeatureBranch()
      const { stdout, code } = await runCli(['--json', 'roadmap'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { roadmap: Array<{ slug: string }> }
      expect(data.roadmap[0].slug).toBe('auth-refactor')
    })

    it('marks a dangling entry at its position while healthy entries omit the flag, exit 0', async () => {
      await seedBacklog('Auth refactor')
      await seedBacklog('Old idea')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      await runCli(['roadmap', 'add', 'old-idea'], tempDir)
      await rm(join(tempDir, 'spec', 'backlog', 'old-idea.md'))

      const jsonRes = await runCli(['--json', 'roadmap'], tempDir)
      expect(jsonRes.code).toBe(0)
      const data = JSON.parse(jsonRes.stdout) as { roadmap: Array<Record<string, unknown>> }
      expect(data.roadmap[0]).toEqual({
        position: 1,
        slug: 'auth-refactor',
        title: 'Auth refactor',
        note: null,
      })
      expect(data.roadmap[1]).toEqual({
        position: 2,
        slug: 'old-idea',
        title: null,
        note: null,
        dangling: true,
      })

      const textRes = await runCli(['roadmap'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toMatch(/2\. old-idea\s+\(dangling — backlog item missing\)/)
    })
  })

  describe('roadmap add', () => {
    it('appends with a note, reports the position and auto-commits', async () => {
      await seedBacklog('Auth refactor')
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'add', 'auth-refactor', '--note', 'after schema freeze'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { slug: string; position: number; committed: boolean; commit_sha?: string }
      expect(data.slug).toBe('auth-refactor')
      expect(data.position).toBe(1)
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: add roadmap entry auth-refactor')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(
        '# Roadmap\n\n1. `auth-refactor` — after schema freeze\n',
      )
    })

    it('text mode reports position and commit', async () => {
      await seedBacklog('Dark mode')
      const { stdout, code } = await runCli(['roadmap', 'add', 'dark-mode'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Added to roadmap at position 1: dark-mode')
      expect(stdout).toContain('Committed:')
    })

    it('unknown slug exits 4 with not_found; roadmap.md untouched and spec/backlog/ never written', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const { stdout, code } = await runCli(['--json', 'roadmap', 'add', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout) as { error: { code: number; type: string; message: string } }
      expect(data.error.type).toBe('not_found')
      expect(data.error.code).toBe(4)

      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'ghost-item.md'))).toBe(false)
    })

    it('duplicate slug exits 4 with duplicate_entry', async () => {
      await seedBacklog('Auth refactor')
      await runCli(['roadmap', 'add', 'auth-refactor'], tempDir)
      const before = await readFile(roadmapPath(), 'utf8')

      const { stdout, code } = await runCli(['--json', 'roadmap', 'add', 'auth-refactor'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout) as { error: { type: string } }
      expect(data.error.type).toBe('duplicate_entry')
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('roadmap reorder', () => {
    beforeEach(async () => {
      await seedBacklog('Item a')
      await seedBacklog('Item b')
      await seedBacklog('Item c')
      await runCli(['roadmap', 'add', 'item-a', '--note', 'note a'], tempDir)
      await runCli(['roadmap', 'add', 'item-b'], tempDir)
      await runCli(['roadmap', 'add', 'item-c'], tempDir)
    }, 120000)

    it('rewrites the order preserving notes and auto-commits', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-c', 'item-a', 'item-b'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { reordered: string[]; committed: boolean }
      expect(data.reordered).toEqual(['item-c', 'item-a', 'item-b'])
      expect(data.committed).toBe(true)

      expect(await readFile(roadmapPath(), 'utf8')).toBe(
        '# Roadmap\n\n1. `item-c`\n2. `item-a` — note a\n3. `item-b`\n',
      )
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: reorder roadmap')
    })

    it('omission, addition and duplicate each exit 4 with invalid_reorder; file byte-identical after all three', async () => {
      const before = await readFile(roadmapPath(), 'utf8')

      const omission = await runCli(['--json', 'roadmap', 'reorder', 'item-c', 'item-a'], tempDir)
      expect(omission.code).toBe(4)
      const omissionData = JSON.parse(omission.stdout) as { error: { type: string; message: string } }
      expect(omissionData.error.type).toBe('invalid_reorder')
      expect(omissionData.error.message).toContain('missing: item-b')

      const addition = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-a', 'item-b', 'item-c', 'ghost-item'],
        tempDir,
      )
      expect(addition.code).toBe(4)
      const additionData = JSON.parse(addition.stdout) as { error: { type: string; message: string } }
      expect(additionData.error.type).toBe('invalid_reorder')
      expect(additionData.error.message).toContain('unexpected: ghost-item')

      const duplicate = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-a', 'item-a', 'item-b', 'item-c'],
        tempDir,
      )
      expect(duplicate.code).toBe(4)
      const duplicateData = JSON.parse(duplicate.stdout) as { error: { type: string; message: string } }
      expect(duplicateData.error.type).toBe('invalid_reorder')
      expect(duplicateData.error.message).toContain('duplicated: item-a')

      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('roadmap next', () => {
    it('emits the promote-path handoff, pops the top (second entry becomes top) and auto-commits', async () => {
      await seedBacklog('Foo feature')
      await seedBacklog('Bar feature')
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await runCli(['roadmap', 'add', 'bar-feature'], tempDir)

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { next: string; message: string; committed: boolean; commit_sha?: string }
      expect(data.next).toBe('foo-feature')
      expect(data.message).toBe('Run: metta propose "Foo feature"')
      expect(data.committed).toBe(true)
      expect(data.commit_sha).toBeTruthy()

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: pop roadmap entry foo-feature')

      const view = await runCli(['--json', 'roadmap'], tempDir)
      const viewData = JSON.parse(view.stdout) as { roadmap: Array<{ position: number; slug: string }> }
      expect(viewData.roadmap).toHaveLength(1)
      expect(viewData.roadmap[0]).toMatchObject({ position: 1, slug: 'bar-feature' })
    })

    it('empty roadmap is a no-op in both modes: exit 0, no write, no commit', async () => {
      const { stdout: logBefore } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })

      const jsonRes = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(jsonRes.code).toBe(0)
      expect(JSON.parse(jsonRes.stdout)).toEqual({ next: null })

      const textRes = await runCli(['roadmap', 'next'], tempDir)
      expect(textRes.code).toBe(0)
      expect(textRes.stdout).toContain('Roadmap is empty — nothing to activate.')

      expect(existsSync(roadmapPath())).toBe(false)
      const { stdout: logAfter } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(logAfter).toBe(logBefore)
    })

    it('dangling top entry exits 4 with not_found naming both remedies and does not pop', async () => {
      await seedBacklog('Foo feature')
      await runCli(['roadmap', 'add', 'foo-feature'], tempDir)
      await rm(join(tempDir, 'spec', 'backlog', 'foo-feature.md'))
      const before = await readFile(roadmapPath(), 'utf8')

      const { stdout, code } = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout) as { error: { type: string; message: string } }
      expect(data.error.type).toBe('not_found')
      // Both remedies: restore the backlog file, or reorder it off the top.
      expect(data.error.message).toContain('spec/backlog/foo-feature.md')
      expect(data.error.message).toContain('metta roadmap reorder')

      // No pop: the file is untouched.
      expect(await readFile(roadmapPath(), 'utf8')).toBe(before)
    })
  })

  describe('branch discipline', () => {
    beforeEach(async () => {
      await seedBacklog('Item a')
      await seedBacklog('Item b')
      await runCli(['roadmap', 'add', 'item-a'], tempDir)
      await runCli(['roadmap', 'add', 'item-b'], tempDir)
      await checkoutFeatureBranch()
    }, 120000)

    it('blocks add, reorder and next off-main with branch_guard exit 4', async () => {
      const add = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)
      expect(add.code).toBe(4)
      expect((JSON.parse(add.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')

      // Guard fires BEFORE permutation validation: an invalid reorder off-main
      // is still branch_guard, not invalid_reorder.
      const reorder = await runCli(['--json', 'roadmap', 'reorder', 'item-a'], tempDir)
      expect(reorder.code).toBe(4)
      expect((JSON.parse(reorder.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')

      const next = await runCli(['--json', 'roadmap', 'next'], tempDir)
      expect(next.code).toBe(4)
      expect((JSON.parse(next.stdout) as { error: { type: string } }).error.type).toBe('branch_guard')
    })

    it('--on-branch escape hatch proceeds and commits on the current branch', async () => {
      const { stdout, code } = await runCli(
        ['--json', 'roadmap', 'reorder', 'item-b', 'item-a', '--on-branch', 'metta/feature-x'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { committed: boolean; commit_sha?: string }
      expect(data.committed).toBe(true)

      const { stdout: branch } = await execAsync('git', ['branch', '--show-current'], { cwd: tempDir })
      expect(branch.trim()).toBe('metta/feature-x')
      const { stdout: log } = await execAsync('git', ['log', '-1', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: reorder roadmap')
    })
  })

  describe('error contract', () => {
    it('all four failure types share the envelope shape: code 4, non-empty message', async () => {
      await seedBacklog('Item a')
      await runCli(['roadmap', 'add', 'item-a'], tempDir)

      const notFound = await runCli(['--json', 'roadmap', 'add', 'ghost-item'], tempDir)
      const duplicate = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)
      const invalidReorder = await runCli(['--json', 'roadmap', 'reorder', 'item-a', 'ghost-item'], tempDir)
      await checkoutFeatureBranch()
      const branchGuard = await runCli(['--json', 'roadmap', 'add', 'item-a'], tempDir)

      const cases: Array<[{ stdout: string; code: number }, string]> = [
        [notFound, 'not_found'],
        [duplicate, 'duplicate_entry'],
        [invalidReorder, 'invalid_reorder'],
        [branchGuard, 'branch_guard'],
      ]
      for (const [res, type] of cases) {
        expect(res.code, `exit code for ${type}`).toBe(4)
        const data = JSON.parse(res.stdout) as { error: { code: number; type: string; message: string } }
        expect(data.error.code).toBe(4)
        expect(data.error.type).toBe(type)
        expect(data.error.message.length).toBeGreaterThan(0)
      }
    })

    it('text-mode failures print the message on stderr and exit 4', async () => {
      const { stdout, stderr, code } = await runCli(['roadmap', 'add', 'ghost-item'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain("Backlog item 'ghost-item' not found")
      expect(stdout).not.toContain('ghost-item')
    })
  })

  describe('additive wiring', () => {
    it('createCliContext exposes roadmapStore and RoadmapStore is exported from the barrel', async () => {
      const { createCliContext } = await import('../src/cli/helpers.js')
      const { RoadmapStore } = await import('../src/index.js')
      const ctx = createCliContext(tempDir)
      expect(ctx.roadmapStore).toBeInstanceOf(RoadmapStore)
    })
  })
})
