import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, installFixture } from './helpers/cli.js'

describe('CLI: gaps', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-gaps-'))
    await installFixture(tempDir)
  }, 60000)

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function seedGap(slug: string, content: string): Promise<void> {
    await mkdir(join(tempDir, 'spec', 'gaps'), { recursive: true })
    await writeFile(join(tempDir, 'spec', 'gaps', `${slug}.md`), content, 'utf8')
  }

  describe('gaps show render-edge sanitization', () => {
    const HOSTILE_GAP =
      '# Gap: \x1b[31mEVIL\x1b[0m gap\n' +
      '\n' +
      '## Status\n' +
      'partial\n' +
      '\n' +
      '## Action\n' +
      'first \x1b[2Jaction line\n' +
      'second \x9baction line\n'

    it('strips escapes from the multi-line Action in text mode, preserving newlines', async () => {
      await seedGap('hostile-gap', HOSTILE_GAP)

      const { stdout, code } = await runCli(['gaps', 'show', 'hostile-gap'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('# Gap: EVIL gap')
      // Multi-line action: escapes stripped, LF line structure preserved.
      expect(stdout).toContain('first action line\nsecond action line')
      expect(stdout).not.toContain('\x1b')
      expect(stdout).not.toContain('\x9b')
    })

    it('--json carries title and action byte-faithfully', async () => {
      await seedGap('hostile-gap', HOSTILE_GAP)

      const { stdout, code } = await runCli(['--json', 'gaps', 'show', 'hostile-gap'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout) as { title: string; action: string }
      expect(data.title).toBe('\x1b[31mEVIL\x1b[0m gap')
      expect(data.action).toBe('first \x1b[2Jaction line\nsecond \x9baction line')
    })

    it('prints the untainted promote fallback when the gap has no Action', async () => {
      await seedGap(
        'no-action-gap',
        '# Gap: plain gap\n\n## Status\npartial\n',
      )

      const { stdout, code } = await runCli(['gaps', 'show', 'no-action-gap'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Promote to spec: metta propose --from-gap no-action-gap')
    })
  })
})
