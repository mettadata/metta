import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildSecondaryLine } from '../src/cli/commands/progress.js'

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '')
}

describe('buildSecondaryLine (metta progress human output)', () => {
  it('returns empty string when no data at all', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'nope',
      undefined,
      undefined,
      undefined,
      undefined,
    )
    expect(line).toBe('')
  })

  it('renders all three segments when everything populated', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent', // no git fallback path will resolve; metadata timings drive
      'demo',
      {
        intent: {
          started: '2026-04-21T10:00:00.000Z',
          completed: '2026-04-21T10:02:14.000Z',
        },
      },
      {
        intent: { context: 4086, budget: 40000 },
      },
      2,
      1,
    )
    const plain = stripAnsi(line)
    expect(plain).toContain('⏱ intent 2m 14s')
    expect(plain).toContain('📊 4k / 40k tokens')
    expect(plain).toContain('↻ review ×2, verify ×1')
  })

  it('suppresses the token segment when artifact_tokens is absent', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'demo',
      {
        intent: {
          started: '2026-04-21T10:00:00.000Z',
          completed: '2026-04-21T10:01:00.000Z',
        },
      },
      undefined,
      0,
      0,
    )
    const plain = stripAnsi(line)
    expect(plain).toContain('⏱ intent 1m 0s')
    expect(plain).not.toContain('📊')
    expect(plain).not.toContain('↻')
  })

  it('suppresses the iteration segment when both counters are zero', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'demo',
      undefined,
      { intent: { context: 100, budget: 1000 } },
      0,
      0,
    )
    const plain = stripAnsi(line)
    expect(plain).toContain('📊 0k / 1k tokens')
    expect(plain).not.toContain('↻')
  })

  it('renders only review half when verify is zero', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'demo',
      undefined,
      undefined,
      3,
      0,
    )
    const plain = stripAnsi(line)
    expect(plain).toBe('↻ review ×3')
  })

  it('renders only verify half when review is absent', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'demo',
      undefined,
      undefined,
      undefined,
      2,
    )
    const plain = stripAnsi(line)
    expect(plain).toBe('↻ verify ×2')
  })

  it('skips an artifact with partial timing (started only, no completed)', async () => {
    const line = await buildSecondaryLine(
      '/nonexistent',
      'demo',
      {
        intent: { started: '2026-04-21T10:00:00.000Z' },
        spec: {
          started: '2026-04-21T10:05:00.000Z',
          completed: '2026-04-21T10:08:01.000Z',
        },
      },
      undefined,
      undefined,
      undefined,
    )
    const plain = stripAnsi(line)
    // Only spec should appear — intent is mid-flight (no `completed`).
    expect(plain).toContain('spec 3m 1s')
    expect(plain).not.toContain('intent')
  })

  it('falls back to git-log timings when metadata is absent', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'metta-prog-sec-git-'))
    try {
      const env = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      }
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp, stdio: 'pipe', env })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp, stdio: 'pipe', env })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmp, stdio: 'pipe', env })
      mkdirSync(join(tmp, 'spec', 'changes', 'legacy-change'), { recursive: true })
      const intentPath = join(tmp, 'spec', 'changes', 'legacy-change', 'intent.md')
      writeFileSync(intentPath, 'first\n')
      execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'pipe', env })
      execFileSync(
        'git',
        ['commit', '-q', '-m', 'first'],
        { cwd: tmp, stdio: 'pipe', env: { ...env, GIT_AUTHOR_DATE: '2026-04-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-04-20T10:00:00Z' } },
      )
      writeFileSync(intentPath, 'first\nsecond\n')
      execFileSync('git', ['add', '.'], { cwd: tmp, stdio: 'pipe', env })
      execFileSync(
        'git',
        ['commit', '-q', '-m', 'second'],
        { cwd: tmp, stdio: 'pipe', env: { ...env, GIT_AUTHOR_DATE: '2026-04-20T11:30:00Z', GIT_COMMITTER_DATE: '2026-04-20T11:30:00Z' } },
      )

      const line = await buildSecondaryLine(
        tmp,
        'legacy-change',
        undefined, // no metadata timings → git fallback
        undefined,
        undefined,
        undefined,
      )
      const plain = stripAnsi(line)
      expect(plain).toContain('intent 1h 30m')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
