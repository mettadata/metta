import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import {
  ReleasePipeline,
  ReleaseError,
  ReleaseConfigMissingError,
  type ReleaseCutOptions,
  type ReleaseStep,
} from '../src/release/release-pipeline.js'
import type { GhExec } from '../src/release/gh-release.js'
import { ProjectConfigSchema, type ProjectConfig } from '../src/schemas/project-config.js'
import { ReleasesRecordSchema, type ReleasesRecord } from '../src/schemas/releases-record.js'
import { DocGenerator } from '../src/docs/doc-generator.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-q', '-b', 'main'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
  await git(cwd, ['config', 'commit.gpgsign', 'false'])
  await git(cwd, ['config', 'tag.gpgsign', 'false'])
}

async function writePackageJson(root: string, version: string): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    `{\n  "name": "fixture",\n  "version": "${version}"\n}\n`,
    'utf-8',
  )
}

async function addArchiveEntry(root: string, dirName: string, summary: string): Promise<void> {
  const dir = join(root, 'spec', 'archive', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'summary.md'), `${summary}\n`, 'utf-8')
}

async function commitAll(cwd: string, subject: string, body?: string): Promise<void> {
  await git(cwd, ['add', '-A'])
  const args = ['commit', '-q', '-m', subject]
  if (body !== undefined) args.push('-m', body)
  await git(cwd, args)
}

function makeConfig(overrides: Record<string, unknown> = {}): ProjectConfig {
  return ProjectConfigSchema.parse({
    release: { scheme: 'semver', version_file: 'package.json' },
    ...overrides,
  })
}

function cutOptions(overrides: Partial<ReleaseCutOptions> = {}): ReleaseCutOptions {
  return {
    confirmVersion: async () => true,
    github: false,
    dryRun: false,
    ...overrides,
  }
}

function stepByName(steps: ReleaseStep[], name: string): ReleaseStep | undefined {
  return steps.find(s => s.step === name)
}

async function readRecord(root: string): Promise<ReleasesRecord> {
  const raw = await readFile(join(root, 'spec', 'releases.yaml'), 'utf-8')
  return ReleasesRecordSchema.parse(YAML.parse(raw))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readPackageVersion(root: string): Promise<string> {
  const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))
  return parsed.version
}

describe('ReleasePipeline', { timeout: 60000 }, () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'metta-release-pipeline-'))
    await initRepo(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('cut — full successful cut (first release, no prior tags)', () => {
    it('produces consistent version file, record, changelog, commit, and annotated tag', async () => {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions())

      expect(result.status).toBe('success')
      expect(result.version).toBe('0.2.0') // feat → minor from 0.1.0
      expect(result.tag).toBe('v0.2.0')
      expect(result.gh).toBeUndefined()

      // No prior tag is not an error; backfill skipped.
      expect(stepByName(result.steps, 'last-tag')).toMatchObject({ status: 'pass', detail: 'none' })
      expect(stepByName(result.steps, 'backfill-record')?.status).toBe('skip')
      expect(stepByName(result.steps, 'gh')?.status).toBe('skip')

      // Version file rewritten, formatting preserved.
      expect(await readPackageVersion(root)).toBe('0.2.0')

      // Releases record: new entry with bump/bump_source, changes snapshotted.
      const record = await readRecord(root)
      expect(record.releases).toHaveLength(1)
      expect(record.releases[0]).toMatchObject({
        version: '0.2.0',
        tag: 'v0.2.0',
        bump: 'minor',
        bump_source: 'derived',
        backfilled: false,
        changes: ['2026-01-01-change-a'],
      })

      // Changelog carries the version section with the change under it.
      const changelog = await readFile(join(root, 'docs', 'changelog.md'), 'utf-8')
      expect(changelog).toContain('## 0.2.0 — ')
      expect(changelog).toContain('### 2026-01-01 — change-a')
      expect(changelog).toContain('Added change a.')

      // Release commit contains exactly the release files, conventional message.
      expect(await git(root, ['log', '-1', '--format=%s'])).toBe('chore(release): 0.2.0')
      const committed = await git(root, ['show', '--name-only', '--format='])
      expect(committed).toContain('package.json')
      expect(committed).toContain('spec/releases.yaml')
      expect(committed).toContain('docs/changelog.md')

      // Annotated (not lightweight) tag pointing at the release commit.
      expect(await git(root, ['cat-file', '-t', 'v0.2.0'])).toBe('tag')
      const annotation = await git(root, [
        'for-each-ref', '--format=%(contents:subject)', 'refs/tags/v0.2.0',
      ])
      expect(annotation).toContain('0.2.0')
      expect(await git(root, ['rev-parse', 'v0.2.0^{commit}'])).toBe(
        await git(root, ['rev-parse', 'HEAD']),
      )

      // Working tree clean afterwards — everything landed in the commit.
      expect(await git(root, ['status', '--porcelain'])).toBe('')
    })

    it('records bump_source override and passes recommendation to confirmVersion', async () => {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')

      const confirmCalls: Array<{ target: string; recommended: string; source: string }> = []
      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({
        bumpOverride: 'major',
        confirmVersion: async (target, recommended, source) => {
          confirmCalls.push({ target, recommended, source })
          return true
        },
      }))

      expect(result.status).toBe('success')
      expect(result.version).toBe('1.0.0')
      expect(confirmCalls).toEqual([{ target: '1.0.0', recommended: 'minor', source: 'override' }])

      const record = await readRecord(root)
      expect(record.releases[0]).toMatchObject({
        version: '1.0.0',
        bump: 'major',
        bump_source: 'override',
      })
    })
  })

  describe('cut — first cut with pre-existing manual tags (backfill)', () => {
    it('backfills historical tags in memory and attributes remaining dirs to the new release', async () => {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-alpha', 'Alpha summary.')
      await commitAll(root, 'chore: archive alpha')
      await git(root, ['tag', 'v0.1.0']) // manual pre-capability tag

      await addArchiveEntry(root, '2026-02-01-beta', 'Beta summary.')
      await commitAll(root, 'feat: add beta')

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions())

      expect(result.status).toBe('success')
      expect(result.version).toBe('0.2.0')
      expect(stepByName(result.steps, 'backfill-record')?.status).toBe('pass')

      const record = await readRecord(root)
      expect(record.releases).toHaveLength(2)
      // New entry prepended (newest first).
      expect(record.releases[0]).toMatchObject({
        version: '0.2.0',
        tag: 'v0.2.0',
        backfilled: false,
        changes: ['2026-02-01-beta'],
      })
      // Backfilled entry: earliest containing tag, no bump metadata.
      expect(record.releases[1]).toMatchObject({
        version: '0.1.0',
        tag: 'v0.1.0',
        backfilled: true,
        changes: ['2026-01-01-alpha'],
      })
      expect(record.releases[1].bump).toBeUndefined()
      expect(record.releases[1].changes).not.toContain('2026-02-01-beta')

      const changelog = await readFile(join(root, 'docs', 'changelog.md'), 'utf-8')
      expect(changelog.indexOf('## 0.2.0')).toBeGreaterThan(-1)
      expect(changelog.indexOf('## 0.1.0')).toBeGreaterThan(changelog.indexOf('## 0.2.0'))
      expect(changelog).toContain('Alpha summary.')
      expect(changelog).toContain('Beta summary.')
    })

    it('leaves dirs unattributed by any release under Unreleased on regeneration', async () => {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-alpha', 'Alpha summary.')
      await commitAll(root, 'chore: archive alpha')
      await git(root, ['tag', 'v0.1.0'])

      const pipeline = new ReleasePipeline(root, makeConfig())
      const config = makeConfig()
      const result = await pipeline.cut(cutOptions())
      expect(result.status).toBe('success')

      // A change archived after the cut is claimed by no release → Unreleased.
      await addArchiveEntry(root, '2026-03-01-gamma', 'Gamma summary.')
      const generator = new DocGenerator(join(root, 'spec'), root, config.docs)
      await generator.generate(['changelog'])

      const changelog = await readFile(join(root, 'docs', 'changelog.md'), 'utf-8')
      expect(changelog).toContain('## Unreleased')
      expect(changelog.indexOf('Gamma summary.')).toBeGreaterThan(changelog.indexOf('## Unreleased'))
      expect(changelog.indexOf('Gamma summary.')).toBeLessThan(changelog.indexOf(`## ${result.version}`))
    })
  })

  describe('cut — abort paths (nothing written)', () => {
    async function seed(): Promise<void> {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')
    }

    async function expectNothingWritten(headBefore: string): Promise<void> {
      expect(await readPackageVersion(root)).toBe('0.1.0')
      expect(await fileExists(join(root, 'spec', 'releases.yaml'))).toBe(false)
      expect(await fileExists(join(root, 'docs', 'changelog.md'))).toBe(false)
      expect(await git(root, ['rev-parse', 'HEAD'])).toBe(headBefore)
    }

    it('fails naming the tag when the target tag already exists — no force, no delete', async () => {
      await seed()
      // Someone hand-tagged the target version ahead of the version file:
      // the file still reads 0.1.0, so a minor cut targets the taken v0.2.0.
      await git(root, ['tag', '-a', 'v0.2.0', '-m', 'pre-existing'])
      const preexistingSha = await git(root, ['rev-parse', 'v0.2.0'])
      const head = await git(root, ['rev-parse', 'HEAD'])

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({ bumpOverride: 'minor' }))

      expect(result.status).toBe('failure')
      const step = stepByName(result.steps, 'target-tag-absent')
      expect(step?.status).toBe('fail')
      expect(step?.detail).toContain('v0.2.0')
      // No mutation step ran.
      expect(stepByName(result.steps, 'write-version-file')).toBeUndefined()
      await expectNothingWritten(head)
      // The pre-existing tag is untouched.
      expect(await git(root, ['rev-parse', 'v0.2.0'])).toBe(preexistingSha)
    })

    it('fails at clean-tree when tracked files have uncommitted changes', async () => {
      await seed()
      const head = await git(root, ['rev-parse', 'HEAD'])
      await writeFile(join(root, 'package.json'), '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "dirty": true\n}\n', 'utf-8')

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions())

      expect(result.status).toBe('failure')
      expect(stepByName(result.steps, 'clean-tree')?.status).toBe('fail')
      expect(await fileExists(join(root, 'spec', 'releases.yaml'))).toBe(false)
      expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head)
    })

    it('returns aborted with nothing written when the user declines', async () => {
      await seed()
      const head = await git(root, ['rev-parse', 'HEAD'])

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({ confirmVersion: async () => false }))

      expect(result.status).toBe('aborted')
      expect(stepByName(result.steps, 'confirm')?.status).toBe('fail')
      await expectNothingWritten(head)
      expect(await git(root, ['tag', '--list', 'v0.2.0'])).toBe('')
    })

    it('dry-run stops after target-tag-absent with all mutation steps skipped', async () => {
      await seed()
      const head = await git(root, ['rev-parse', 'HEAD'])

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({ dryRun: true }))

      expect(result.status).toBe('success')
      expect(result.version).toBe('0.2.0')
      expect(result.tag).toBe('v0.2.0')
      expect(stepByName(result.steps, 'target-tag-absent')?.status).toBe('pass')
      for (const name of [
        'backfill-record', 'write-version-file', 'write-releases-record',
        'regen-changelog', 'commit', 'annotated-tag', 'gh',
      ]) {
        expect(stepByName(result.steps, name)).toMatchObject({ status: 'skip', detail: 'dry-run' })
      }
      await expectNothingWritten(head)
      expect(await git(root, ['tag', '--list', 'v0.2.0'])).toBe('')
    })
  })

  describe('cut — mid-cut failure restore (fault injection)', () => {
    const throwingGenerator = {
      generate: async (): Promise<never> => {
        throw new Error('injected changelog failure')
      },
    }

    it('first release: restores pre-cut state and names the failing step when regen-changelog throws', async () => {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')
      const head = await git(root, ['rev-parse', 'HEAD'])

      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({ docGenerator: throwingGenerator }))

      // Failure is reported with the failing step named.
      expect(result.status).toBe('failure')
      expect(stepByName(result.steps, 'regen-changelog')).toMatchObject({
        status: 'fail',
        detail: 'injected changelog failure',
      })

      // The mutation steps before the failure ran; nothing after it did.
      expect(stepByName(result.steps, 'write-version-file')?.status).toBe('pass')
      expect(stepByName(result.steps, 'write-releases-record')?.status).toBe('pass')
      expect(stepByName(result.steps, 'commit')).toBeUndefined()
      expect(stepByName(result.steps, 'annotated-tag')).toBeUndefined()

      // All three mutation targets are restored to pre-cut state: the version
      // file matches, and the record/changelog (absent before) are removed.
      expect(await readPackageVersion(root)).toBe('0.1.0')
      expect(await fileExists(join(root, 'spec', 'releases.yaml'))).toBe(false)
      expect(await fileExists(join(root, 'docs', 'changelog.md'))).toBe(false)

      // No commit, no tag, clean working tree.
      expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head)
      expect(await git(root, ['tag', '--list'])).toBe('')
      expect(await git(root, ['status', '--porcelain'])).toBe('')
    })

    it('subsequent release: restores pre-existing record and changelog byte-for-byte', async () => {
      // First, a successful cut establishes real pre-cut contents for all
      // three files (version file, releases record, changelog).
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')
      const pipeline = new ReleasePipeline(root, makeConfig())
      expect((await pipeline.cut(cutOptions())).status).toBe('success')

      await addArchiveEntry(root, '2026-02-01-change-b', 'Added change b.')
      await commitAll(root, 'feat: add change b')
      const head = await git(root, ['rev-parse', 'HEAD'])
      const recordBefore = await readFile(join(root, 'spec', 'releases.yaml'), 'utf-8')
      const changelogBefore = await readFile(join(root, 'docs', 'changelog.md'), 'utf-8')

      const result = await pipeline.cut(cutOptions({ docGenerator: throwingGenerator }))

      expect(result.status).toBe('failure')
      expect(stepByName(result.steps, 'regen-changelog')?.status).toBe('fail')

      // Pre-existing files restored byte-for-byte, version file rolled back.
      expect(await readPackageVersion(root)).toBe('0.2.0')
      expect(await readFile(join(root, 'spec', 'releases.yaml'), 'utf-8')).toBe(recordBefore)
      expect(await readFile(join(root, 'docs', 'changelog.md'), 'utf-8')).toBe(changelogBefore)

      // No new commit or tag beyond the first successful release.
      expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head)
      expect(await git(root, ['tag', '--list'])).toBe('v0.2.0')
      expect(await git(root, ['status', '--porcelain'])).toBe('')
    })
  })

  describe('cut — gh isolation', () => {
    async function seed(): Promise<void> {
      await writePackageJson(root, '0.1.0')
      await addArchiveEntry(root, '2026-01-01-change-a', 'Added change a.')
      await commitAll(root, 'feat: add change a')
    }

    it('gh failure never changes local success', async () => {
      await seed()
      const failingExec: GhExec = async () => {
        throw new Error('gh: command not found')
      }
      const config = makeConfig({
        release: { scheme: 'semver', version_file: 'package.json', github_release: true },
      })
      const pipeline = new ReleasePipeline(root, config)
      const result = await pipeline.cut(cutOptions({ github: true, ghExec: failingExec }))

      expect(result.status).toBe('success')
      expect(result.gh?.status).toBe('missing-binary')
      expect(stepByName(result.steps, 'gh')?.status).toBe('fail')

      // The local release is fully intact.
      expect(await readPackageVersion(root)).toBe('0.2.0')
      expect(await git(root, ['cat-file', '-t', 'v0.2.0'])).toBe('tag')
      expect(await git(root, ['log', '-1', '--format=%s'])).toBe('chore(release): 0.2.0')
    })

    it('creates the GitHub release with notes from the version section when gh succeeds', async () => {
      await seed()
      const calls: string[][] = []
      const okExec: GhExec = async (_file, args) => {
        calls.push([...args])
        return { stdout: '', stderr: '' }
      }
      const config = makeConfig({
        release: { scheme: 'semver', version_file: 'package.json', github_release: true },
      })
      const pipeline = new ReleasePipeline(root, config)
      const result = await pipeline.cut(cutOptions({ github: true, ghExec: okExec }))

      expect(result.status).toBe('success')
      expect(result.gh).toEqual({ status: 'created', tag: 'v0.2.0' })
      const createCall = calls.find(args => args[0] === 'release' && args[1] === 'create')
      expect(createCall).toBeDefined()
      expect(createCall).toContain('v0.2.0')
      const notes = createCall![createCall!.indexOf('--notes') + 1]
      expect(notes).toContain('Added change a.')
    })

    it('does not invoke gh when publication is not requested for this cut', async () => {
      await seed()
      let invoked = false
      const spyExec: GhExec = async () => {
        invoked = true
        return { stdout: '', stderr: '' }
      }
      const config = makeConfig({
        release: { scheme: 'semver', version_file: 'package.json', github_release: true },
      })
      const pipeline = new ReleasePipeline(root, config)
      const result = await pipeline.cut(cutOptions({ github: false, ghExec: spyExec }))

      expect(result.status).toBe('success')
      expect(result.gh).toBeUndefined()
      expect(invoked).toBe(false)
      expect(stepByName(result.steps, 'gh')?.status).toBe('skip')
    })

    it('does not invoke gh when config disables github_release even if requested', async () => {
      await seed()
      let invoked = false
      const spyExec: GhExec = async () => {
        invoked = true
        return { stdout: '', stderr: '' }
      }
      const pipeline = new ReleasePipeline(root, makeConfig())
      const result = await pipeline.cut(cutOptions({ github: true, ghExec: spyExec }))

      expect(result.status).toBe('success')
      expect(result.gh).toBeUndefined()
      expect(invoked).toBe(false)
      expect(stepByName(result.steps, 'gh')).toMatchObject({
        status: 'skip',
        detail: 'release.github_release is disabled in config',
      })
    })
  })

  describe('missing release config', () => {
    it('cut rejects with ReleaseConfigMissingError naming the required keys, before any write', async () => {
      await writePackageJson(root, '0.1.0')
      await commitAll(root, 'chore: seed')
      const config = ProjectConfigSchema.parse({})
      const pipeline = new ReleasePipeline(root, config)

      const error = await pipeline.cut(cutOptions()).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ReleaseConfigMissingError)
      expect(error).toBeInstanceOf(ReleaseError)
      expect((error as Error).message).toContain('release.scheme')
      expect((error as Error).message).toContain('release.version_file')

      expect(await readPackageVersion(root)).toBe('0.1.0')
      expect(await fileExists(join(root, 'spec', 'releases.yaml'))).toBe(false)
    })

    it('status rejects with ReleaseConfigMissingError too', async () => {
      const pipeline = new ReleasePipeline(root, ProjectConfigSchema.parse({}))
      await expect(pipeline.status()).rejects.toBeInstanceOf(ReleaseConfigMissingError)
    })
  })

  describe('status', () => {
    it('reports version, last tag, commit count, recommended bump, and unreleased count', async () => {
      await writePackageJson(root, '0.4.0')
      await addArchiveEntry(root, '2026-01-01-alpha', 'Alpha summary.')
      await commitAll(root, 'chore: archive alpha')
      await git(root, ['tag', 'v0.4.0'])
      await addArchiveEntry(root, '2026-02-01-beta', 'Beta summary.')
      await commitAll(root, 'feat: add beta')

      const pipeline = new ReleasePipeline(root, makeConfig())
      const status = await pipeline.status()

      expect(status.version).toBe('0.4.0')
      expect(status.lastTag).toBe('v0.4.0')
      expect(status.commitCount).toBe(1)
      expect(status.recommendedBump).toBe('minor')
      // No record yet → every archive dir counts as unreleased.
      expect(status.unreleasedChanges).toBe(2)
      expect(status.warnings).toEqual([])
    })

    it('reports null tag when no matching tags exist (not an error)', async () => {
      await writePackageJson(root, '0.1.0')
      await commitAll(root, 'chore: seed')

      const status = await new ReleasePipeline(root, makeConfig()).status()
      expect(status.lastTag).toBeNull()
      expect(status.recommendedBump).toBe('patch')
    })

    it('degrades to version-only with a warning when git is disabled', async () => {
      await writePackageJson(root, '0.1.0')
      await commitAll(root, 'chore: seed')

      const config = makeConfig({ git: { enabled: false } })
      const status = await new ReleasePipeline(root, config).status()

      expect(status.version).toBe('0.1.0')
      expect(status.lastTag).toBeNull()
      expect(status.commitCount).toBeNull()
      expect(status.recommendedBump).toBeNull()
      expect(status.warnings.length).toBeGreaterThan(0)
    })
  })
})
