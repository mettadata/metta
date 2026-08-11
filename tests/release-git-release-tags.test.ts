import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  listReleaseTags,
  tagExists,
  collectCommitsSince,
  attributeArchiveDirsToTags,
} from '../src/release/git-release-tags.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-q', '-b', 'main'])
  await git(cwd, ['config', 'user.email', 'test@example.com'])
  await git(cwd, ['config', 'user.name', 'Test'])
  await git(cwd, ['config', 'commit.gpgsign', 'false'])
  await git(cwd, ['config', 'tag.gpgsign', 'false'])
}

let counter = 0

async function commit(cwd: string, subject: string, body?: string): Promise<void> {
  counter += 1
  await writeFile(join(cwd, `file-${counter}.txt`), `content ${counter}\n`, 'utf8')
  await git(cwd, ['add', '-A'])
  const args = ['commit', '-q', '-m', subject]
  if (body !== undefined) args.push('-m', body)
  await git(cwd, args)
}

describe('git-release-tags', { timeout: 30000 }, () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'metta-release-tags-'))
    await initRepo(repo)
  })

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('listReleaseTags', () => {
    it('returns prefix-matching tags newest first by version order', async () => {
      await commit(repo, 'chore: seed')
      for (const tag of ['v0.1.0', 'v0.2.0', 'v0.10.0']) {
        await git(repo, ['tag', tag])
      }
      // Non-matching tags must be excluded by the `{prefix}[0-9]*` glob.
      await git(repo, ['tag', 'release-candidate'])
      await git(repo, ['tag', 'v-not-a-version'])

      const tags = await listReleaseTags(repo, 'v')
      expect(tags).toEqual(['v0.10.0', 'v0.2.0', 'v0.1.0'])
    })

    it('returns an empty array when no tags match', async () => {
      await commit(repo, 'chore: seed')
      const tags = await listReleaseTags(repo, 'v')
      expect(tags).toEqual([])
    })

    it('respects a custom tag prefix', async () => {
      await commit(repo, 'chore: seed')
      await git(repo, ['tag', 'rel-1.0.0'])
      await git(repo, ['tag', 'v1.0.0'])

      const tags = await listReleaseTags(repo, 'rel-')
      expect(tags).toEqual(['rel-1.0.0'])
    })
  })

  describe('tagExists', () => {
    it('returns true for an existing tag and false for a missing one', async () => {
      await commit(repo, 'chore: seed')
      await git(repo, ['tag', 'v1.0.0'])

      await expect(tagExists(repo, 'v1.0.0')).resolves.toBe(true)
      await expect(tagExists(repo, 'v9.9.9')).resolves.toBe(false)
    })
  })

  describe('collectCommitsSince', () => {
    it('collects the full history newest first when tag is undefined', async () => {
      await commit(repo, 'feat: first')
      await commit(repo, 'fix: second')
      await commit(repo, 'chore: third')

      const commits = await collectCommitsSince(repo, undefined)
      expect(commits.map(c => c.subject)).toEqual([
        'chore: third',
        'fix: second',
        'feat: first',
      ])
      expect(commits.every(c => c.body === '')).toBe(true)
    })

    it('collects only commits after the given tag', async () => {
      await commit(repo, 'feat: before tag')
      await git(repo, ['tag', 'v0.1.0'])
      await commit(repo, 'fix: after tag one')
      await commit(repo, 'feat: after tag two')

      const commits = await collectCommitsSince(repo, 'v0.1.0')
      expect(commits.map(c => c.subject)).toEqual([
        'feat: after tag two',
        'fix: after tag one',
      ])
    })

    it('preserves multi-line bodies including BREAKING CHANGE footers', async () => {
      await commit(
        repo,
        'feat(api): reshape response',
        'Some detail line one.\nDetail line two.\n\nBREAKING CHANGE: response envelope removed',
      )
      await commit(repo, 'fix: small thing', 'single body line')

      const commits = await collectCommitsSince(repo, undefined)
      expect(commits).toHaveLength(2)
      expect(commits[0]).toEqual({ subject: 'fix: small thing', body: 'single body line' })
      expect(commits[1].subject).toBe('feat(api): reshape response')
      expect(commits[1].body).toContain('Detail line two.')
      expect(commits[1].body).toContain('BREAKING CHANGE: response envelope removed')
    })

    it('includes branch commits under merge commits (not --first-parent)', async () => {
      await commit(repo, 'chore: base')
      await git(repo, ['checkout', '-q', '-b', 'feature'])
      await commit(repo, 'feat!: branch-side breaking change')
      await git(repo, ['checkout', '-q', 'main'])
      await commit(repo, 'chore: mainline drift')
      await git(repo, ['merge', '-q', '--no-ff', '-m', 'chore: merge metta/feature', 'feature'])

      const commits = await collectCommitsSince(repo, undefined)
      const subjects = commits.map(c => c.subject)
      expect(subjects).toContain('feat!: branch-side breaking change')
      expect(subjects).toContain('chore: merge metta/feature')
    })
  })

  describe('attributeArchiveDirsToTags', () => {
    it('attributes each dir to the earliest tag containing it and omits untagged dirs', async () => {
      // v0.1.0 contains dir-a; v0.2.0 contains dir-a and dir-b; dir-c only in HEAD.
      await mkdir(join(repo, 'spec', 'archive', 'dir-a'), { recursive: true })
      await writeFile(join(repo, 'spec', 'archive', 'dir-a', 'summary.md'), 'a\n', 'utf8')
      await commit(repo, 'chore: archive dir-a')
      await git(repo, ['tag', 'v0.1.0'])

      await mkdir(join(repo, 'spec', 'archive', 'dir-b'), { recursive: true })
      await writeFile(join(repo, 'spec', 'archive', 'dir-b', 'summary.md'), 'b\n', 'utf8')
      await commit(repo, 'chore: archive dir-b')
      await git(repo, ['tag', 'v0.2.0'])

      await mkdir(join(repo, 'spec', 'archive', 'dir-c'), { recursive: true })
      await writeFile(join(repo, 'spec', 'archive', 'dir-c', 'summary.md'), 'c\n', 'utf8')
      await commit(repo, 'chore: archive dir-c')

      const map = await attributeArchiveDirsToTags(
        repo,
        ['v0.1.0', 'v0.2.0'],
        ['dir-a', 'dir-b', 'dir-c'],
      )

      expect(map.get('v0.1.0')).toEqual(['dir-a'])
      expect(map.get('v0.2.0')).toEqual(['dir-b'])
      expect([...map.keys()]).toEqual(['v0.1.0', 'v0.2.0'])
      // dir-c is in no tag → omitted entirely (stays Unreleased).
      for (const dirs of map.values()) {
        expect(dirs).not.toContain('dir-c')
      }
    })

    it('omits tags that contain no attributed dirs and returns empty map for no matches', async () => {
      await commit(repo, 'chore: seed without archive')
      await git(repo, ['tag', 'v0.1.0'])

      const map = await attributeArchiveDirsToTags(repo, ['v0.1.0'], ['ghost-dir'])
      expect(map.size).toBe(0)
    })

    it('groups multiple dirs first appearing in the same tag', async () => {
      await mkdir(join(repo, 'spec', 'archive', 'dir-a'), { recursive: true })
      await mkdir(join(repo, 'spec', 'archive', 'dir-b'), { recursive: true })
      await writeFile(join(repo, 'spec', 'archive', 'dir-a', 'summary.md'), 'a\n', 'utf8')
      await writeFile(join(repo, 'spec', 'archive', 'dir-b', 'summary.md'), 'b\n', 'utf8')
      await commit(repo, 'chore: archive both')
      await git(repo, ['tag', 'v1.0.0'])

      const map = await attributeArchiveDirsToTags(repo, ['v1.0.0'], ['dir-a', 'dir-b'])
      expect(map.get('v1.0.0')).toEqual(['dir-a', 'dir-b'])
    })
  })
})
