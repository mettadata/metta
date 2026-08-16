import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isArchivedChangeDir } from '../src/util/archive-dirs.js'
import { ReleasePipeline } from '../src/release/release-pipeline.js'
import { ProjectConfigSchema } from '../src/schemas/project-config.js'
import { runCli, installFixture, disableWorktrees } from './helpers/cli.js'

describe('isArchivedChangeDir', () => {
  it('accepts date-prefixed archived change dirs', () => {
    expect(isArchivedChangeDir('2026-01-01-change-a')).toBe(true)
    expect(isArchivedChangeDir('2026-08-16-rework-backlog-around-issue-store')).toBe(true)
  })

  it('rejects non-change archive dirs', () => {
    expect(isArchivedChangeDir('backlog-legacy')).toBe(false)
    expect(isArchivedChangeDir('done')).toBe(false)
    expect(isArchivedChangeDir('change-a')).toBe(false)
  })

  it('rejects bare or partial date shapes', () => {
    expect(isArchivedChangeDir('')).toBe(false)
    expect(isArchivedChangeDir('2026-01-01')).toBe(false) // no trailing hyphen + name separator match
    expect(isArchivedChangeDir('2026-1-1-change')).toBe(false)
    expect(isArchivedChangeDir('26-01-01-change')).toBe(false)
  })
})

describe('archive-dir filtering in consumers', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-archive-dirs-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function seedArchive(root: string, dirName: string): Promise<void> {
    const dir = join(root, 'spec', 'archive', dirName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'summary.md'), 'Seeded archive entry.\n', 'utf-8')
  }

  it('progress skips non-date-prefixed archive dirs in completed output', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await seedArchive(tempDir, '2026-01-01-change-a')
    await seedArchive(tempDir, 'backlog-legacy')

    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.completed).toEqual(['2026-01-01-change-a'])
    expect(data.completed).not.toContain('backlog-legacy')
    expect(data.summary.shipped).toBe(1)
  })

  it('release status does not count non-date-prefixed archive dirs as unreleased changes', async () => {
    await writeFile(
      join(tempDir, 'package.json'),
      '{\n  "name": "fixture",\n  "version": "0.1.0"\n}\n',
      'utf-8',
    )
    await seedArchive(tempDir, '2026-01-01-change-a')
    await seedArchive(tempDir, 'backlog-legacy')

    const config = ProjectConfigSchema.parse({
      release: { scheme: 'semver', version_file: 'package.json' },
    })
    const pipeline = new ReleasePipeline(tempDir, config)
    const status = await pipeline.status()

    // Only the date-prefixed dir counts; backlog-legacy is never claimable.
    expect(status.unreleasedChanges).toBe(1)
  })
})
