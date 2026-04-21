import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getGitLogTimings } from '../src/util/git-log-timings.js'

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  })
}

describe('getGitLogTimings', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'metta-git-log-timings-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns first/last timestamps for a file with two commits', async () => {
    git(tmp, ['init', '-q', '-b', 'main'])
    git(tmp, ['config', 'user.email', 'test@example.com'])
    git(tmp, ['config', 'user.name', 'Test'])
    writeFileSync(join(tmp, 'a.md'), 'first\n')
    git(tmp, ['add', 'a.md'])
    git(tmp, ['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: '2026-04-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-04-20T10:00:00Z' })
    writeFileSync(join(tmp, 'a.md'), 'second\n')
    git(tmp, ['add', 'a.md'])
    git(tmp, ['commit', '-q', '-m', 'second'], { GIT_AUTHOR_DATE: '2026-04-20T11:00:00Z', GIT_COMMITTER_DATE: '2026-04-20T11:00:00Z' })

    const result = await getGitLogTimings(tmp, 'a.md')
    expect(result).not.toBeNull()
    expect(result?.first.toISOString()).toBe('2026-04-20T10:00:00.000Z')
    expect(result?.last.toISOString()).toBe('2026-04-20T11:00:00.000Z')
  })

  it('returns null for an untracked file', async () => {
    git(tmp, ['init', '-q', '-b', 'main'])
    git(tmp, ['config', 'user.email', 'test@example.com'])
    git(tmp, ['config', 'user.name', 'Test'])
    writeFileSync(join(tmp, 'untracked.md'), 'nope\n')

    const result = await getGitLogTimings(tmp, 'untracked.md')
    expect(result).toBeNull()
  })

  it('returns null when the directory is not a git repo', async () => {
    mkdirSync(join(tmp, 'notgit'))
    const result = await getGitLogTimings(join(tmp, 'notgit'), 'anything.md')
    expect(result).toBeNull()
  })

  it('returns null when the file does not exist', async () => {
    git(tmp, ['init', '-q', '-b', 'main'])
    const result = await getGitLogTimings(tmp, 'missing.md')
    expect(result).toBeNull()
  })

  it('handles a single-commit file (first === last)', async () => {
    git(tmp, ['init', '-q', '-b', 'main'])
    git(tmp, ['config', 'user.email', 'test@example.com'])
    git(tmp, ['config', 'user.name', 'Test'])
    writeFileSync(join(tmp, 'solo.md'), 'only\n')
    git(tmp, ['add', 'solo.md'])
    git(tmp, ['commit', '-q', '-m', 'only'], { GIT_AUTHOR_DATE: '2026-04-20T09:00:00Z', GIT_COMMITTER_DATE: '2026-04-20T09:00:00Z' })

    const result = await getGitLogTimings(tmp, 'solo.md')
    expect(result).not.toBeNull()
    expect(result?.first.getTime()).toBe(result?.last.getTime())
    expect(result?.first.toISOString()).toBe('2026-04-20T09:00:00.000Z')
  })
})
