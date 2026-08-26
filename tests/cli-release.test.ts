import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { runCli } from './helpers/cli.js'
import { ReleasesRecordSchema } from '../src/schemas/releases-record.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

interface FixtureOptions {
  /** Omit the `release:` block entirely. */
  noReleaseConfig?: boolean
  /** Value for release.github_release (defaults to omitted → schema default false). */
  githubRelease?: boolean
}

/**
 * Temp-repo fixture per the tests/cli-finalize.test.ts precedent: a real git
 * repository with a committed `.metta/config.yaml`, a package.json version
 * file, and one archived change, driven through the real CLI via runCli.
 */
async function setupProject(dir: string, opts: FixtureOptions = {}): Promise<void> {
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['config', 'commit.gpgsign', 'false'])
  await git(dir, ['config', 'tag.gpgsign', 'false'])

  await mkdir(join(dir, 'spec', 'changes'), { recursive: true })
  await mkdir(join(dir, 'spec', 'archive', '2026-01-01-change-a'), { recursive: true })
  await writeFile(
    join(dir, 'spec', 'archive', '2026-01-01-change-a', 'summary.md'),
    'Added change a.\n',
    'utf8',
  )
  await writeFile(
    join(dir, 'package.json'),
    '{\n  "name": "fixture",\n  "version": "0.1.0"\n}\n',
    'utf8',
  )

  await mkdir(join(dir, '.metta'), { recursive: true })
  const lines: string[] = []
  if (!opts.noReleaseConfig) {
    lines.push('release:', '  scheme: semver', '  version_file: package.json')
    if (opts.githubRelease !== undefined) {
      lines.push(`  github_release: ${opts.githubRelease}`)
    }
  }
  await writeFile(join(dir, '.metta', 'config.yaml'), lines.join('\n') + '\n', 'utf8')

  await git(dir, ['add', '-A'])
  await git(dir, ['commit', '-q', '-m', 'feat: initial'])
}

describe('CLI: release', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-release-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('status', () => {
    it('prints version, last tag, commit count, recommended bump, and unreleased count', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release', 'status'], tempDir)

      expect(code).toBe(0)
      expect(stdout).toContain('0.1.0')
      expect(stdout).toContain('none') // no tags yet
      expect(stdout).toContain('minor') // feat commit → minor
      expect(stdout).toMatch(/Unreleased changes:\s+1/)
    })

    it('is the default subcommand: bare `metta release` prints the same status view', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release'], tempDir)

      expect(code).toBe(0)
      expect(stdout).toContain('Version:')
      expect(stdout).toContain('0.1.0')
    })

    it('--json emits the machine-readable status result', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release', 'status', '--json'], tempDir)

      expect(code).toBe(0)
      const payload = JSON.parse(stdout) as Record<string, unknown>
      expect(payload.version).toBe('0.1.0')
      expect(payload.lastTag).toBeNull()
      expect(payload.commitCount).toBe(1)
      expect(payload.recommendedBump).toBe('minor')
      expect(payload.unreleasedChanges).toBe(1)
      expect(payload.warnings).toEqual([])
      // Schema-resolved config echo (defaults when the keys are omitted).
      expect(payload.onShip).toBe('auto')
      expect(payload.allowMajorPre1).toBe(false)
      expect(payload.githubRelease).toBe(false)
    })

    it('--json echoes explicit github_release from the config', async () => {
      await setupProject(tempDir, { githubRelease: true })

      const { stdout, code } = await runCli(['release', 'status', '--json'], tempDir)

      expect(code).toBe(0)
      const payload = JSON.parse(stdout) as Record<string, unknown>
      expect(payload.onShip).toBe('auto')
      expect(payload.allowMajorPre1).toBe(false)
      expect(payload.githubRelease).toBe(true)
    })

    it('missing release: config yields an actionable error naming release.scheme and release.version_file', async () => {
      await setupProject(tempDir, { noReleaseConfig: true })

      const { stderr, code } = await runCli(['release', 'status'], tempDir)

      expect(code).toBe(4)
      expect(stderr).toContain('release.scheme')
      expect(stderr).toContain('release.version_file')
    })

    it('modifies no files', async () => {
      await setupProject(tempDir)

      await runCli(['release', 'status'], tempDir)

      expect(await git(tempDir, ['status', '--porcelain'])).toBe('')
      expect(await fileExists(join(tempDir, 'spec', 'releases.yaml'))).toBe(false)
    })
  })

  describe('cut', () => {
    it('--yes --bump minor cuts end-to-end: version file, record, changelog, commit, tag, push hint', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release', 'cut', '--yes', '--bump', 'minor'], tempDir)

      expect(code).toBe(0)
      expect(stdout).toContain('Release 0.2.0 cut (tag v0.2.0).')
      // The exact manual push command — the CLI never pushes.
      expect(stdout).toContain('The tag was NOT pushed.')
      expect(stdout).toContain('git push --follow-tags origin main')
      expect(stdout).toContain('gh release create v0.2.0 --verify-tag')

      // Version file bumped.
      const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8')) as { version: string }
      expect(pkg.version).toBe('0.2.0')

      // Releases record written with override provenance.
      const record = ReleasesRecordSchema.parse(
        YAML.parse(await readFile(join(tempDir, 'spec', 'releases.yaml'), 'utf8')),
      )
      expect(record.releases).toHaveLength(1)
      expect(record.releases[0]).toMatchObject({
        version: '0.2.0',
        tag: 'v0.2.0',
        bump: 'minor',
        bump_source: 'override',
        backfilled: false,
        changes: ['2026-01-01-change-a'],
      })

      // Changelog regenerated, release commit created, annotated tag present.
      expect(await fileExists(join(tempDir, 'docs', 'changelog.md'))).toBe(true)
      expect(await git(tempDir, ['log', '-1', '--format=%s'])).toBe('chore(release): 0.2.0')
      expect(await git(tempDir, ['tag', '--list', 'v0.2.0'])).toBe('v0.2.0')
      expect(await git(tempDir, ['cat-file', '-t', 'refs/tags/v0.2.0'])).toBe('tag')
      // Nothing left dirty.
      expect(await git(tempDir, ['status', '--porcelain'])).toBe('')
    })

    it('--dry-run stops before any mutation', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release', 'cut', '--yes', '--dry-run'], tempDir)

      expect(code).toBe(0)
      expect(stdout).toContain('Dry run')
      expect(stdout).toContain('nothing was written')

      const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8')) as { version: string }
      expect(pkg.version).toBe('0.1.0')
      expect(await fileExists(join(tempDir, 'spec', 'releases.yaml'))).toBe(false)
      expect(await git(tempDir, ['tag', '--list'])).toBe('')
      expect(await git(tempDir, ['log', '-1', '--format=%s'])).toBe('feat: initial')
    })

    it('--github errors pre-mutation naming the removed flag and the fixed cut → push → publish sequence', async () => {
      await setupProject(tempDir, { githubRelease: true })

      const { stderr, code } = await runCli(['release', 'cut', '--yes', '--github'], tempDir)

      expect(code).not.toBe(0)
      expect(stderr).toContain('--github has been removed')
      expect(stderr).toContain('git push --follow-tags origin main')
      expect(stderr).toContain('--verify-tag')
      // Zero mutations: version file, changelog, commit, and tag untouched.
      const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8')) as { version: string }
      expect(pkg.version).toBe('0.1.0')
      expect(await fileExists(join(tempDir, 'spec', 'releases.yaml'))).toBe(false)
      expect(await fileExists(join(tempDir, 'docs', 'changelog.md'))).toBe(false)
      expect(await git(tempDir, ['log', '-1', '--format=%s'])).toBe('feat: initial')
      expect(await git(tempDir, ['tag', '--list'])).toBe('')
      expect(await git(tempDir, ['status', '--porcelain'])).toBe('')
    })

    it('--json success output includes the extracted changelog notes string', async () => {
      await setupProject(tempDir)

      const { stdout, code } = await runCli(['release', 'cut', '--yes', '--bump', 'minor', '--json'], tempDir)

      expect(code).toBe(0)
      const payload = JSON.parse(stdout) as Record<string, unknown>
      expect(payload.status).toBe('success')
      expect(payload.version).toBe('0.2.0')
      expect(payload.tag).toBe('v0.2.0')
      expect(typeof payload.notes).toBe('string')
      expect(payload.notes as string).toContain('Added change a.')
    })

    it('non-TTY without --yes aborts cleanly with nothing written', async () => {
      await setupProject(tempDir)

      const { stderr, code } = await runCli(['release', 'cut'], tempDir)

      expect(code).toBe(1)
      expect(stderr).toContain('Release aborted — nothing was written.')

      const pkg = JSON.parse(await readFile(join(tempDir, 'package.json'), 'utf8')) as { version: string }
      expect(pkg.version).toBe('0.1.0')
      expect(await fileExists(join(tempDir, 'spec', 'releases.yaml'))).toBe(false)
      expect(await git(tempDir, ['tag', '--list'])).toBe('')
      expect(await git(tempDir, ['status', '--porcelain'])).toBe('')
    })

    it('rejects an invalid --bump level naming the valid ones', async () => {
      await setupProject(tempDir)

      const { stderr, code } = await runCli(['release', 'cut', '--yes', '--bump', 'huge'], tempDir)

      expect(code).toBe(4)
      expect(stderr).toContain("Invalid --bump 'huge'")
      expect(stderr).toContain('major')
      expect(stderr).toContain('minor')
      expect(stderr).toContain('patch')
    })

    it('missing release: config fails before touching anything, naming the required keys', async () => {
      await setupProject(tempDir, { noReleaseConfig: true })

      const { stderr, code } = await runCli(['release', 'cut', '--yes'], tempDir)

      expect(code).toBe(4)
      expect(stderr).toContain('release.scheme')
      expect(stderr).toContain('release.version_file')
      expect(await git(tempDir, ['status', '--porcelain'])).toBe('')
    })
  })
})
