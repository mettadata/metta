import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'

describe("CLI: instructions banners / complete tier downscale & upscale", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('metta instructions advisory banner', () => {
    async function writeComplexityField(
      changeName: string,
      recommended: 'trivial' | 'quick' | 'standard' | 'full',
      score: number,
      fileCount: number,
    ): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.complexity_score = {
        score,
        signals: { file_count: fileCount },
        recommended_workflow: recommended,
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('agreement banner: scored workflow matches chosen workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'agreement banner'], tempDir)
      // standard propose → workflow=standard; score recommendation=standard
      await writeComplexityField('agreement-banner', 'standard', 2, 5)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'agreement-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('current workflow standard matches recommendation standard')
    })

    it('downscale banner: scored tier lower than chosen tier', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale banner'], tempDir)
      // propose → standard; recommended=trivial (lower)
      await writeComplexityField('downscale-banner', 'trivial', 0, 1)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'downscale-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
    })

    it('upscale banner: scored tier higher than chosen tier', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale banner'], tempDir)
      // quick workflow → quick; recommended=standard (higher)
      await writeComplexityField('upscale-banner', 'standard', 2, 5)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'upscale-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('upscale recommended')
    })

    it('suppressed: no complexity_score produces no Advisory prefix', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'suppressed banner'], tempDir)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'suppressed-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).not.toContain('Advisory:')
    })

    it('--json mode: stdout remains valid JSON when banner is printed', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'json banner'], tempDir)
      await writeComplexityField('json-banner', 'trivial', 0, 1)
      const { stdout, stderr, code } = await runCli(
        ['--json', 'instructions', 'intent', '--change', 'json-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      // Banner on stderr
      expect(stderr).toContain('Advisory:')
      // Stdout must parse as valid JSON (no banner contamination)
      expect(() => JSON.parse(stdout)).not.toThrow()
      const data = JSON.parse(stdout)
      expect(data).toHaveProperty('metta_agent')
    })
  })


  describe('metta instructions verification context', { timeout: 30000 }, () => {
    it('strategy present: emits configured values in context', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'ver ctx present'], tempDir)

      // Append a top-level `verification:` block — sibling of `project:`.
      const { readFile, writeFile } = await import('node:fs/promises')
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const existing = await readFile(configPath, 'utf8')
      const appended =
        (existing.endsWith('\n') ? existing : existing + '\n') +
        'verification:\n' +
        '  strategy: playwright\n' +
        '  instructions: "http://localhost:3000"\n'
      await writeFile(configPath, appended, 'utf8')

      const { stdout, code } = await runCli(
        ['--json', 'instructions', 'verification', '--change', 'ver-ctx-present'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.context.verification_strategy).toBe('playwright')
      expect(data.context.verification_instructions).toBe('http://localhost:3000')
    })

    it('strategy absent: emits null for both fields', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'ver ctx absent'], tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'instructions', 'verification', '--change', 'ver-ctx-absent'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.context.verification_strategy).toBeNull()
      expect(data.context.verification_instructions).toBeNull()
    })
  })


  describe('metta complete intent-time downscale prompt', () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const { readFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    async function setAutoAccept(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.auto_accept_recommendation = true
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    // Intent body long enough to pass the 200-byte content sanity floor,
    // with a `## Impact` section listing exactly one file (-> trivial).
    function oneFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A single-file touch-up to verify that adaptive-tier downscale fires when',
        'the Impact section lists exactly one file. The body is padded to clear',
        'the content-sanity floor of 200 bytes so the complete command does not',
        'reject the artifact before the scorer ever sees it.',
        '',
        '## Impact',
        '',
        '- `src/cli/commands/complete.ts`',
        '',
      ].join('\n')
    }

    function threeFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A three-file change listing three source files so the scorer recommends',
        'the quick tier. The body is padded to clear the content-sanity floor of',
        '200 bytes so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '',
      ].join('\n')
    }

    it('auto_accept: downscale fires and mutates workflow without prompting', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale auto', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-auto')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-auto'],
        tempDir,
      )
      expect(code).toBe(0)

      // Auto-accept banner printed to stderr (no prompt)
      expect(stderr).toContain('Auto-accepting recommendation')
      expect(stderr).toContain('downscale to /metta-trivial')

      const meta = await readChangeMetaYaml('downscale-auto')
      expect(meta.workflow).toBe('trivial')
      // complexity_score persisted
      expect(meta.complexity_score).toBeDefined()
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('trivial')
      expect(cs.signals.file_count).toBe(1)

      // Planning artifacts dropped from the artifact map.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
      expect(artifacts).not.toHaveProperty('research')
      expect(artifacts).not.toHaveProperty('design')
      expect(artifacts).not.toHaveProperty('tasks')
      // Trivial workflow contains intent/implementation/verification.
      expect(artifacts).toHaveProperty('intent')
      expect(artifacts).toHaveProperty('implementation')
      expect(artifacts).toHaveProperty('verification')
      // intent status was 'complete' before the rebuild and must be preserved.
      expect(artifacts.intent).toBe('complete')
    })

    it('non-TTY (no path): workflow unchanged, advisory banner emitted to stderr', async () => {
      // execFile gives a non-TTY stdin, so askYesNo returns its default (false).
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-no')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale No'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Advisory banner emitted on the no path.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      // No auto-accept banner (the flag was not set).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('downscale-no')
      // Workflow unchanged — still standard.
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('trivial')
      // Planning artifacts still present.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
    })

    it('json mode with downscale condition: no prompt, advisory banner on stderr, no workflow change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale json'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-json')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Json'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'downscale-json'],
        tempDir,
      )
      expect(code).toBe(0)
      // Stdout still parses as JSON (complete's existing payload).
      expect(() => JSON.parse(stdout)).not.toThrow()
      // Advisory banner emitted on stderr (no path in json mode).
      expect(stderr).toContain('Advisory:')

      const meta = await readChangeMetaYaml('downscale-json')
      expect(meta.workflow).toBe('standard')
    })

    it('three-file impact under standard: no downscale fires (same tier or higher)', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'three file impact'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'three-file-impact')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Three File Impact'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'three-file-impact'],
        tempDir,
      )
      expect(code).toBe(0)
      // 3 files -> quick, workflow was standard. quick < standard so downscale recommended.
      // But no auto-accept, non-TTY -> no path: advisory banner yes, no workflow change.
      expect(stderr).toContain('Advisory:')
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('three-file-impact')
      expect(meta.workflow).toBe('standard')
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('quick')
      expect(cs.signals.file_count).toBe(3)
      const artifacts = meta.artifacts as Record<string, string>
      // Planning artifacts preserved (no downscale).
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
    })

    it('recommendation matches current workflow: no prompt, no banner, no change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Quick workflow + 1 file -> trivial. That is lower than quick, so downscale would fire.
      // Use quick + 3 files -> quick. Same tier, no prompt, no banner.
      await runCli(['quick', 'same tier'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'same-tier')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Same Tier'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'same-tier'],
        tempDir,
      )
      expect(code).toBe(0)
      // No downscale-related output.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('downscale recommended')

      const meta = await readChangeMetaYaml('same-tier')
      expect(meta.workflow).toBe('quick')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })

    it('quick workflow + 1-file impact: no downscale fires (quick is the smallest interactive tier)', async () => {
      // Per spec.md AutoDownscalePromptAtIntent, the downscale prompt MUST
      // NOT fire for `/metta-quick` runs because quick is already the
      // smallest named interactive workflow. A quick run scoring trivial
      // is handled by the intra-quick fan-out gate in the skill template,
      // not by re-prompting at intent-complete time.
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'quick trivial noop'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'quick-trivial-noop')
      await writeFile(
        join(changeDir, 'intent.md'),
        oneFileIntent('Quick Trivial Noop'),
        'utf8',
      )

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'quick-trivial-noop'],
        tempDir,
      )
      expect(code).toBe(0)

      // No downscale prompt or banner should appear. The advisory banner
      // is emitted only on the no/non-TTY path of an active downscale
      // branch, which must be skipped entirely for quick runs.
      expect(stderr).not.toContain('downscale recommended')
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('collapse workflow')

      const meta = await readChangeMetaYaml('quick-trivial-noop')
      // Workflow field MUST remain `quick`.
      expect(meta.workflow).toBe('quick')
      // complexity_score still persisted as advisory.
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('trivial')
      expect(cs.signals.file_count).toBe(1)
    })

    it('auto_accept set via fixture after propose: downscale fires on intent-complete', async () => {
      // Regression: exercise the code path where auto_accept_recommendation was
      // enabled via a separate metadata write rather than the propose flag, to
      // verify the complete command reads the field fresh from disk.
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'fixture auto'], tempDir)
      await setAutoAccept('fixture-auto')
      const changeDir = join(tempDir, 'spec', 'changes', 'fixture-auto')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Fixture Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'fixture-auto'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('fixture-auto')
      expect(meta.workflow).toBe('trivial')
    })
  })


  describe('metta complete intent-time upscale prompt', () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const { readFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    // Intent body with `## Impact` listing exactly five files (-> standard).
    function fiveFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A five-file change listing five distinct source files so the scorer',
        'recommends the standard tier. Body padded to clear the 200-byte content',
        'sanity floor so the complete command does not reject the artifact.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '- `src/d.ts`',
        '- `src/e.ts`',
        '',
      ].join('\n')
    }

    // Intent body with `## Impact` listing fifteen files (-> full).
    function fifteenFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A fifteen-file change listing many distinct source files so the scorer',
        'recommends the full tier, which triggers the hard-cap advisory rather',
        'than a prompt. Body padded to clear the 200-byte content sanity floor.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '- `src/d.ts`',
        '- `src/e.ts`',
        '- `src/f.ts`',
        '- `src/g.ts`',
        '- `src/h.ts`',
        '- `src/i.ts`',
        '- `src/j.ts`',
        '- `src/k.ts`',
        '- `src/l.ts`',
        '- `src/m.ts`',
        '- `src/n.ts`',
        '- `src/o.ts`',
        '',
      ].join('\n')
    }

    function twoFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A two-file change listing exactly two source files so the scorer',
        'recommends the quick tier. Body padded to clear the 200-byte content',
        'sanity floor so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '',
      ].join('\n')
    }

    function threeFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A three-file change listing three source files so the scorer recommends',
        'the quick tier. The body is padded to clear the content-sanity floor of',
        '200 bytes so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '',
      ].join('\n')
    }

    it('auto_accept: upscale from quick to standard fires and inserts planning artifacts', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale auto', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-auto')
      await writeFile(join(changeDir, 'intent.md'), fiveFileIntent('Upscale Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-auto'],
        tempDir,
      )
      expect(code).toBe(0)

      // Auto-accept banner printed to stderr (no prompt).
      expect(stderr).toContain('Auto-accepting recommendation')
      expect(stderr).toContain('upscale to /metta-standard')

      const meta = await readChangeMetaYaml('upscale-auto')
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('standard')
      expect(cs.signals.file_count).toBe(5)

      // Planning artifacts inserted by the upscale (pending), though the
      // immediate "next artifact" (stories) is promoted to 'ready' by the
      // downstream getNext step that runs after the upscale mutation.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(['pending', 'ready']).toContain(artifacts.stories)
      expect(artifacts.spec).toBe('pending')
      expect(artifacts.research).toBe('pending')
      expect(artifacts.design).toBe('pending')
      expect(artifacts.tasks).toBe('pending')
      // intent status preserved (was complete before rebuild).
      expect(artifacts.intent).toBe('complete')
      // Existing artifacts preserved.
      expect(artifacts).toHaveProperty('implementation')
      expect(artifacts).toHaveProperty('verification')
    })

    it('non-TTY (no path): quick + 5-file impact leaves workflow unchanged and emits advisory', async () => {
      // execFile gives a non-TTY stdin, so askYesNo returns its default (false).
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-no')
      await writeFile(join(changeDir, 'intent.md'), fiveFileIntent('Upscale No'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Advisory banner emitted on the no path.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('upscale recommended')
      // No auto-accept banner (the flag was not set).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('upscale-no')
      // Workflow unchanged — still quick.
      expect(meta.workflow).toBe('quick')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('standard')
      // Planning artifacts not inserted (no path).
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('full-tier hard cap: quick + 15-file impact emits advisory, no prompt, no workflow change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Use --auto to prove that auto-accept does NOT bypass the full-tier cap.
      await runCli(['quick', 'upscale full', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-full')
      await writeFile(join(changeDir, 'intent.md'), fifteenFileIntent('Upscale Full'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-full'],
        tempDir,
      )
      expect(code).toBe(0)

      // Hard-cap advisory message present.
      expect(stderr).toContain('upscale to full is not yet supported')
      // No auto-accept banner (cap blocks the prompt/yes-path entirely).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('upscale-full')
      // Workflow unchanged — still quick.
      expect(meta.workflow).toBe('quick')
      // complexity_score persisted with full recommendation.
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('full')
      expect(cs.signals.file_count).toBe(15)
      // No planning artifacts inserted.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('same tier: quick + 2-file impact does not fire upscale', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale same', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-same')
      await writeFile(join(changeDir, 'intent.md'), twoFileIntent('Upscale Same'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-same'],
        tempDir,
      )
      expect(code).toBe(0)

      // No upscale banner or prompt — recommendation matches chosen tier.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('upscale recommended')
      expect(stderr).not.toContain('upscale to full is not yet supported')

      const meta = await readChangeMetaYaml('upscale-same')
      expect(meta.workflow).toBe('quick')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })

    it('standard workflow + 3-file impact: downscale fires, upscale does NOT fire', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale not upscale'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-not-upscale')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Downscale Not Upscale'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-not-upscale'],
        tempDir,
      )
      expect(code).toBe(0)

      // Downscale advisory (no TTY, no auto-accept -> no path).
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      // Upscale advisory must NOT appear.
      expect(stderr).not.toContain('upscale recommended')
      expect(stderr).not.toContain('upscale to full is not yet supported')

      const meta = await readChangeMetaYaml('downscale-not-upscale')
      // Workflow unchanged (no path).
      expect(meta.workflow).toBe('standard')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })
  })


  describe('metta complete post-implementation upscale prompt', () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const { readFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    async function writeArtifactStatus(
      changeName: string,
      artifactId: string,
      status: string,
    ): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      const artifacts = (doc.artifacts ?? {}) as Record<string, string>
      artifacts[artifactId] = status
      doc.artifacts = artifacts
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    function buildSummary(title: string, files: string[]): string {
      // A summary body padded above the 100-byte summary floor, with a
      // `## Files` section listing the caller-provided file entries.
      const intro = [
        `# ${title}`,
        '',
        '## Overview',
        '',
        'Post-implementation summary used by the complete-implementation scorer',
        'to rerun the adaptive workflow tier selection. Padding ensures the body',
        'clears the 100-byte sanity floor for summary.md.',
        '',
        '## Files',
        '',
      ].join('\n')
      const body = files.map((f) => `- \`${f}\``).join('\n')
      return `${intro}${body}\n`
    }

    function fiveFileSummary(title: string): string {
      return buildSummary(title, [
        'src/a.ts',
        'src/b.ts',
        'src/c.ts',
        'src/d.ts',
        'src/e.ts',
      ])
    }

    function twoFileSummary(title: string): string {
      return buildSummary(title, ['src/a.ts', 'src/b.ts'])
    }

    function fifteenFileSummary(title: string): string {
      return buildSummary(title, [
        'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
        'src/f.ts', 'src/g.ts', 'src/h.ts', 'src/i.ts', 'src/j.ts',
        'src/k.ts', 'src/l.ts', 'src/m.ts', 'src/n.ts', 'src/o.ts',
      ])
    }

    it('auto_accept + 5-file summary: upscale fires, stories+spec marked pending, directive on stdout', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'post impl auto', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-auto')
      await writeFile(join(changeDir, 'summary.md'), fiveFileSummary('Post Impl Auto'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-auto'],
        tempDir,
      )
      expect(code).toBe(0)

      // Auto-accept banner (no prompt) and directive string in stdout.
      expect(stderr).toContain('Auto-accepting recommendation: post-impl upscale to /metta-standard')
      expect(stdout).toContain('Post-impl upscale accepted.')
      expect(stdout).toContain('metta instructions stories --change post-impl-auto')
      expect(stdout).toContain('metta instructions spec --change post-impl-auto')

      const meta = await readChangeMetaYaml('post-impl-auto')
      expect(meta.workflow).toBe('standard')
      // actual_complexity_score persisted with standard recommendation.
      const acs = meta.actual_complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(acs).toBeDefined()
      expect(acs.recommended_workflow).toBe('standard')
      expect(acs.signals.file_count).toBe(5)

      // stories and spec marked pending by the upscale.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts.stories).toBe('pending')
      expect(artifacts.spec).toBe('pending')
      // implementation preserved as complete.
      expect(artifacts.implementation).toBe('complete')
    })

    it('non-TTY (no path): 5-file summary persists score, leaves workflow unchanged, emits warning', async () => {
      // execFile gives a non-TTY stdin -> askYesNo returns default (false).
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'post impl no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-no')
      await writeFile(join(changeDir, 'summary.md'), fiveFileSummary('Post Impl No'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Warning emitted on the no path.
      expect(stderr).toContain('Warning: this change touched 5 files')
      expect(stderr).toContain('standard workflow was recommended')
      expect(stderr).toContain('finalize will proceed on quick')
      // No auto-accept banner.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      // No directive on stdout (no path).
      expect(stdout).not.toContain('Post-impl upscale accepted')

      const meta = await readChangeMetaYaml('post-impl-no')
      // Workflow unchanged — still quick.
      expect(meta.workflow).toBe('quick')
      // actual_complexity_score persisted regardless of prompt answer.
      const acs = meta.actual_complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(acs).toBeDefined()
      expect(acs.recommended_workflow).toBe('standard')
      expect(acs.signals.file_count).toBe(5)
      // stories/spec not inserted on no path.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('same tier: quick + 2-file summary persists score, no prompt, no warning', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'post impl same'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-same')
      await writeFile(join(changeDir, 'summary.md'), twoFileSummary('Post Impl Same'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-same'],
        tempDir,
      )
      expect(code).toBe(0)

      // No upscale banner, no warning, no directive.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('Warning: this change touched')
      expect(stdout).not.toContain('Post-impl upscale accepted')

      const meta = await readChangeMetaYaml('post-impl-same')
      expect(meta.workflow).toBe('quick')
      const acs = meta.actual_complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(acs).toBeDefined()
      expect(acs.recommended_workflow).toBe('quick')
      expect(acs.signals.file_count).toBe(2)
    })

    it('full-tier hard cap: quick + 15-file summary persists score, emits advisory, no prompt, no workflow change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // --auto to confirm that auto-accept does NOT bypass the full-tier cap.
      await runCli(['quick', 'post impl full', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-full')
      await writeFile(join(changeDir, 'summary.md'), fifteenFileSummary('Post Impl Full'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-full'],
        tempDir,
      )
      expect(code).toBe(0)

      // Hard-cap advisory present; no auto-accept banner.
      expect(stderr).toContain('implementation scored full')
      expect(stderr).toContain('promotion to full is not yet supported')
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('post-impl-full')
      // Workflow unchanged.
      expect(meta.workflow).toBe('quick')
      // actual_complexity_score persisted with full recommendation.
      const acs = meta.actual_complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(acs).toBeDefined()
      expect(acs.recommended_workflow).toBe('full')
      expect(acs.signals.file_count).toBe(15)
      // No retro artifacts inserted.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('yes path + stories already complete: skip re-marking stories pending, directive still printed', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Start on quick + --auto so the yes path is taken without a prompt.
      await runCli(['quick', 'post impl stories', '--auto'], tempDir)
      // Pre-seed the artifact map so stories is already complete (simulating
      // the user having authored stories retroactively in a prior session).
      await writeArtifactStatus('post-impl-stories', 'stories', 'complete')

      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-stories')
      await writeFile(join(changeDir, 'summary.md'), fiveFileSummary('Post Impl Stories'), 'utf8')

      const { stdout, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-stories'],
        tempDir,
      )
      expect(code).toBe(0)

      // Directive still printed on yes path.
      expect(stdout).toContain('Post-impl upscale accepted.')

      const meta = await readChangeMetaYaml('post-impl-stories')
      expect(meta.workflow).toBe('standard')
      const artifacts = meta.artifacts as Record<string, string>
      // stories preserved as complete (NOT re-marked pending).
      expect(artifacts.stories).toBe('complete')
      // spec was marked pending by the upscale; the downstream getNext may
      // promote the immediate next artifact to 'ready', so accept either.
      expect(['pending', 'ready']).toContain(artifacts.spec)
    })

    it('missing summary.md: post-impl block is skipped, no error, exit 0', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'post impl none', '--auto'], tempDir)
      // No summary.md written.

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-none'],
        tempDir,
      )
      expect(code).toBe(0)

      // No scoring side-effects.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('Warning: this change touched')
      expect(stderr).not.toContain('implementation scored full')
      expect(stdout).not.toContain('Post-impl upscale accepted')

      const meta = await readChangeMetaYaml('post-impl-none')
      expect(meta.workflow).toBe('quick')
      // actual_complexity_score never written.
      expect(meta.actual_complexity_score).toBeUndefined()
    })
  })

})
