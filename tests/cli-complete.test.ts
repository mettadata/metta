import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Command } from 'commander'
import { runCli, execAsync, CLI_PATH, disableWorktrees, installFixture } from './helpers/cli.js'
import { registerCompleteCommand } from '../src/cli/commands/complete.js'

// Scripted TTY prompt state for the in-process interactive downscale tests.
// When `answers` is non-empty, the node:readline mock below intercepts
// createInterface and replays the queued answer; otherwise it delegates to
// the real implementation so every other test is unaffected.
const ttyPrompt = vi.hoisted(() => ({
  answers: [] as string[],
  questions: [] as string[],
}))

vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline')>()
  return {
    ...actual,
    createInterface: (options: Parameters<typeof actual.createInterface>[0]) => {
      if (ttyPrompt.answers.length === 0) {
        return actual.createInterface(options)
      }
      return {
        question(query: string, cb: (answer: string) => void): void {
          ttyPrompt.questions.push(query)
          cb(ttyPrompt.answers.shift() ?? '')
        },
        close(): void {},
      } as unknown as ReturnType<typeof actual.createInterface>
    },
  }
})

describe("CLI: instructions banners / complete tier downscale & upscale", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'suppressed banner'], tempDir)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'suppressed-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).not.toContain('Advisory:')
    })

    it('--json mode: stdout remains valid JSON when banner is printed', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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

      // Every accept path folds a validated downscale_decision record into
      // the SAME atomic write as the workflow rewrite (Risk R1 — the
      // advisory try/catch swallows schema failures silently, so a bare
      // "nothing crashed" proves nothing; re-read together with `workflow`).
      const decision = meta.downscale_decision as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(decision).toBeDefined()
      expect(decision.from_tier).toBe('standard')
      expect(decision.to_tier).toBe('trivial')
      expect(decision.justification).toContain('auto_accept_recommendation')
      expect(Number.isNaN(Date.parse(decision.timestamp))).toBe(false)
      expect(meta.escalation).toBeUndefined()
    })

    it('non-TTY, workflow unlocked: downscale fails closed, workflow kept, escalation recorded', async () => {
      // execFile gives a non-TTY stdin. Non-interactive callers must never
      // resolve a workflow-collapsing decision via a silent default-Yes —
      // the fail-closed branch routes through the existing No path, so the
      // outcome is recorded and advisory-bannered, not silent.
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-no')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale No'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Advisory banner is emitted on the fail-closed No path; no prompt
      // text appears since no prompt was ever rendered non-interactively.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      expect(stderr).not.toContain('collapse workflow')
      // No auto-accept banner (the flag was not set).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('downscale-no')
      // Workflow stays at the chosen tier — fail-closed, not silent Yes.
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('trivial')
      // Planning artifacts kept — no collapse occurred.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
      // Escalation recorded with the non-interactive fail-closed cause.
      const esc = meta.escalation as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(esc).toBeDefined()
      expect(esc.from_tier).toBe('trivial')
      expect(esc.to_tier).toBe('standard')
      expect(esc.justification).toContain('non-interactive fail-closed')
      expect(esc.timestamp).toBeDefined()
      // No decision record on the No path.
      expect(meta.downscale_decision).toBeUndefined()
    })

    it('json mode with downscale condition: fails closed, workflow kept, stdout stays valid JSON', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale json'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-json')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Json'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'downscale-json'],
        tempDir,
      )
      expect(code).toBe(0)
      // Stdout still parses as JSON (complete's existing payload); the
      // advisory goes to stderr — the existing separation is preserved.
      expect(() => JSON.parse(stdout)).not.toThrow()
      // --json counts as non-interactive -- fails closed, advisory printed.
      expect(stderr).toContain('Advisory:')

      const meta = await readChangeMetaYaml('downscale-json')
      expect(meta.workflow).toBe('standard')
      const esc = meta.escalation as { justification: string }
      expect(esc).toBeDefined()
      expect(esc.justification).toContain('non-interactive fail-closed')
      expect(meta.downscale_decision).toBeUndefined()
    })

    it('three-file impact under standard: fails closed, workflow kept at standard', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'three file impact'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'three-file-impact')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Three File Impact'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'three-file-impact'],
        tempDir,
      )
      expect(code).toBe(0)
      // 3 files -> quick, workflow was standard. quick < standard, but
      // non-TTY fails closed -- the tier is kept, not silently collapsed.
      expect(stderr).toContain('Advisory:')
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('three-file-impact')
      expect(meta.workflow).toBe('standard')
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('quick')
      expect(cs.signals.file_count).toBe(3)
      const artifacts = meta.artifacts as Record<string, string>
      // Planning artifacts kept -- no collapse.
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
      const esc = meta.escalation as { from_tier: string; to_tier: string; justification: string }
      expect(esc).toBeDefined()
      expect(esc.from_tier).toBe('quick')
      expect(esc.to_tier).toBe('standard')
      expect(meta.downscale_decision).toBeUndefined()
    })

    it('workflow_locked, non-TTY: workflow kept, escalation recorded with workflow_locked justification', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      // Explicit --workflow sets workflow_locked: true, which flips the
      // downscale default back to No.
      await runCli(['propose', 'downscale locked', '--workflow', 'standard'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-locked')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Locked'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-locked'],
        tempDir,
      )
      expect(code).toBe(0)

      // No-path advisory banner still emitted.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')

      const meta = await readChangeMetaYaml('downscale-locked')
      // Workflow unchanged — the lock kept the No default.
      expect(meta.workflow).toBe('standard')
      // Planning artifacts preserved (no collapse).
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
      // Escalation recorded: staying above the recommendation is auditable.
      const esc = meta.escalation as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(esc).toBeDefined()
      expect(esc.from_tier).toBe('trivial')
      expect(esc.to_tier).toBe('standard')
      expect(esc.justification).toContain('workflow_locked')
      expect(esc.timestamp).toBeDefined()
      // workflow_locked keeps precedence over the non-interactive cause,
      // and no decision record is written on the No path.
      expect(meta.downscale_decision).toBeUndefined()
    })

    // Run `metta complete intent` in-process with a simulated interactive
    // TTY: stdin.isTTY is forced true and the node:readline mock at the top
    // of this file replays `answer` to the first prompt. The subprocess
    // harness (runCli/execFile) cannot allocate a pty, so the interactive
    // matrix rows are covered in-process against the real command action.
    // `answer === null` queues no readline response at all -- used by T-C2
    // to exercise the `--json` fail-closed path, which never prompts even
    // on a forced TTY. `extraArgs` are inserted before the `complete`
    // subcommand (e.g. `['--json']`, already registered on this in-process
    // program) so the json half of the `nonInteractive` predicate can be
    // isolated in-process (a subprocess's stdin is always a pipe, so
    // runCli/execFile tests can never exercise TTY + --json together).
    async function runCompleteInteractive(
      changeName: string,
      answer: string | null,
      cwd: string,
      extraArgs: string[] = [],
    ): Promise<void> {
      const prevCwd = process.cwd()
      const prevIsTTY = process.stdin.isTTY
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 0}) called`)
      }) as never)
      ttyPrompt.questions.length = 0
      if (answer !== null) {
        ttyPrompt.answers.push(answer)
      }
      Object.defineProperty(process.stdin, 'isTTY', {
        value: true,
        configurable: true,
        writable: true,
      })
      try {
        process.chdir(cwd)
        const program = new Command()
        program.option('--json')
        registerCompleteCommand(program)
        await program.parseAsync(
          [...extraArgs, 'complete', 'intent', '--change', changeName],
          { from: 'user' },
        )
      } finally {
        process.chdir(prevCwd)
        Object.defineProperty(process.stdin, 'isTTY', {
          value: prevIsTTY,
          configurable: true,
          writable: true,
        })
        exitSpy.mockRestore()
        ttyPrompt.answers.length = 0
      }
    }

    it('interactive decline (answer n): [Y/n] prompt, workflow kept, declined-downscale escalation', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale decline'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-decline')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Decline'), 'utf8')

      await runCompleteInteractive('downscale-decline', 'n', tempDir)

      // Prompt rendered with the Yes-default suffix.
      expect(ttyPrompt.questions.length).toBeGreaterThan(0)
      expect(ttyPrompt.questions[0]).toContain('collapse workflow to /metta-trivial?')
      expect(ttyPrompt.questions[0]).toContain('[Y/n]')

      const meta = await readChangeMetaYaml('downscale-decline')
      // Workflow unchanged — the user declined.
      expect(meta.workflow).toBe('standard')
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
      // Escalation recorded with the declined-downscale justification.
      const esc = meta.escalation as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(esc).toBeDefined()
      expect(esc.from_tier).toBe('trivial')
      expect(esc.to_tier).toBe('standard')
      expect(esc.justification).toContain('declined downscale')
      expect(esc.timestamp).toBeDefined()
      // No decision record on the No path.
      expect(meta.downscale_decision).toBeUndefined()
    })

    it('interactive empty answer: Yes default collapses workflow, decision record written', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale accept enter'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-accept-enter')
      await writeFile(
        join(changeDir, 'intent.md'),
        oneFileIntent('Downscale Accept Enter'),
        'utf8',
      )

      await runCompleteInteractive('downscale-accept-enter', '', tempDir)

      // Prompt rendered with the Yes-default suffix.
      expect(ttyPrompt.questions.length).toBeGreaterThan(0)
      expect(ttyPrompt.questions[0]).toContain('[Y/n]')

      const meta = await readChangeMetaYaml('downscale-accept-enter')
      // Empty answer takes the Yes default: workflow collapses.
      expect(meta.workflow).toBe('trivial')
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
      // No escalation on the accept path.
      expect(meta.escalation).toBeUndefined()
      // Decision record written with the TTY default-Yes cause.
      const decision = meta.downscale_decision as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(decision).toBeDefined()
      expect(decision.from_tier).toBe('standard')
      expect(decision.to_tier).toBe('trivial')
      expect(decision.justification).toContain('interactive default-Yes')
      expect(Number.isNaN(Date.parse(decision.timestamp))).toBe(false)
    })

    it('interactive explicit yes (answer y): workflow collapses, decision record has explicit-yes cause', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale accept explicit'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-accept-explicit')
      await writeFile(
        join(changeDir, 'intent.md'),
        oneFileIntent('Downscale Accept Explicit'),
        'utf8',
      )

      await runCompleteInteractive('downscale-accept-explicit', 'y', tempDir)

      expect(ttyPrompt.questions.length).toBeGreaterThan(0)
      expect(ttyPrompt.questions[0]).toContain('[Y/n]')

      const meta = await readChangeMetaYaml('downscale-accept-explicit')
      expect(meta.workflow).toBe('trivial')
      expect(meta.escalation).toBeUndefined()
      const decision = meta.downscale_decision as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(decision).toBeDefined()
      expect(decision.from_tier).toBe('standard')
      expect(decision.to_tier).toBe('trivial')
      expect(decision.justification).toContain('interactive explicit yes')
      expect(Number.isNaN(Date.parse(decision.timestamp))).toBe(false)
    })

    it('in-process TTY + --json: downscale fails closed even with a forced TTY', async () => {
      // Isolates the `json` half of the `nonInteractive` predicate: stdin.isTTY
      // is forced true here (unlike subprocess tests, whose stdin is always a
      // pipe), yet --json alone must still resolve fail-closed with no prompt.
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale tty json'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-tty-json')
      await writeFile(
        join(changeDir, 'intent.md'),
        oneFileIntent('Downscale Tty Json'),
        'utf8',
      )

      await runCompleteInteractive('downscale-tty-json', null, tempDir, ['--json'])

      // No prompt was ever rendered -- the fail-closed branch short-circuits
      // before reaching askYesNoDetailed.
      expect(ttyPrompt.questions.length).toBe(0)

      const meta = await readChangeMetaYaml('downscale-tty-json')
      expect(meta.workflow).toBe('standard')
      const esc = meta.escalation as { justification: string }
      expect(esc).toBeDefined()
      expect(esc.justification).toContain('non-interactive fail-closed')
      expect(meta.downscale_decision).toBeUndefined()
    })

    it('recommendation matches current workflow: no prompt, no banner, no change', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      const decision = meta.downscale_decision as {
        from_tier: string
        to_tier: string
        justification: string
        timestamp: string
      }
      expect(decision).toBeDefined()
      expect(decision.from_tier).toBe('standard')
      expect(decision.to_tier).toBe('trivial')
      expect(decision.justification).toContain('auto_accept_recommendation')
      expect(Number.isNaN(Date.parse(decision.timestamp))).toBe(false)
    })

    it('greenfield intent with no file tokens in ## Impact: no score, no prompt, no advisory', async () => {
      // Per zero_file_intent_is_no_signal: a present-but-fileless ## Impact
      // section carries no information at intent time -- no complexity_score
      // is persisted, no downscale prompt fires, and no Advisory banner is
      // printed. The first real recommendation arrives at summary time.
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'greenfield no files'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'greenfield-no-files')
      const noFileImpactIntent = [
        '# Greenfield No Files',
        '',
        '## Problem',
        '',
        'A greenfield intent describing work that has not yet touched any',
        'files. The body is padded well past the 200-byte content sanity',
        'floor so the complete command does not reject the artifact before',
        'the scorer ever sees it, exercising the zero-file no-signal path.',
        '',
        '## Impact',
        '',
        'No files are touched yet. This greenfield change will introduce new',
        'modules once implementation begins, but the impact section lists no',
        'concrete paths at intent time.',
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'intent.md'), noFileImpactIntent, 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'greenfield-no-files'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).not.toContain('Advisory:')
      expect(stderr).not.toContain('collapse workflow')
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('greenfield-no-files')
      expect(meta.complexity_score).toBeUndefined()
      expect(meta.workflow).toBe('standard')
      expect(meta.escalation).toBeUndefined()
      expect(meta.downscale_decision).toBeUndefined()
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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

    it('standard workflow + 3-file impact: downscale advisory fires by default, upscale does NOT fire', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'downscale not upscale'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-not-upscale')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Downscale Not Upscale'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-not-upscale'],
        tempDir,
      )
      expect(code).toBe(0)

      // Non-TTY -> the downscale branch fails closed and prints the
      // advisory banner; it must not be confused with an upscale advisory.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      // Upscale advisory must NOT appear.
      expect(stderr).not.toContain('upscale recommended')
      expect(stderr).not.toContain('upscale to full is not yet supported')

      const meta = await readChangeMetaYaml('downscale-not-upscale')
      // Workflow kept -- fail-closed, not silently collapsed.
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
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


  describe('metta complete spec capability-target gate', { timeout: 60000 }, () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    // Mark every artifact complete so the finalizer's completeness gate passes.
    async function markAllArtifactsComplete(changeName: string): Promise<void> {
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      const artifacts = doc.artifacts as Record<string, string>
      for (const id of Object.keys(artifacts)) {
        artifacts[id] = 'complete'
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    // Replace every gate the standard workflow references with a passing stub
    // so `metta finalize` can run end-to-end inside the temp fixture (which
    // has no package.json for the real npm-based gate commands).
    async function stubAllGatesPassing(): Promise<void> {
      await mkdir(join(tempDir, '.metta', 'gates'), { recursive: true })
      const gateNames = ['tests', 'lint', 'typecheck', 'build', 'stories-valid']
      for (const name of gateNames) {
        const yaml = [
          `name: ${name}`,
          `description: passing stub for ${name}`,
          'command: "true"',
          'timeout: 10000',
          'required: true',
          'on_failure: stop',
          '',
        ].join('\n')
        await writeFile(join(tempDir, '.metta', 'gates', `${name}.yaml`), yaml, 'utf8')
      }
    }

    // ADDED-only delta spec, padded above the 200-byte content sanity floor.
    // `marker: true` places `<!-- new-capability -->` directly under the H1.
    function addedDelta(h1: string, opts: { marker?: boolean } = {}): string {
      return [
        `# ${h1}`,
        ...(opts.marker ? ['', '<!-- new-capability -->'] : []),
        '',
        '## ADDED: Requirement: Session Management',
        '',
        'The system MUST manage user sessions with secure token rotation and',
        'expiry so that stale credentials can never be replayed by an attacker',
        'after they have been superseded by a fresh token issuance.',
        '',
        '### Scenario: Token rotation',
        '- GIVEN an authenticated session',
        '- WHEN the token approaches expiry',
        '- THEN a fresh token is issued and the old one is revoked',
        '',
      ].join('\n')
    }

    function modifiedDelta(h1: string, opts: { marker?: boolean } = {}): string {
      return [
        `# ${h1}`,
        ...(opts.marker ? ['', '<!-- new-capability -->'] : []),
        '',
        '## MODIFIED: Requirement: Session Management',
        '',
        'The system MUST manage user sessions with secure token rotation and',
        'expiry so that stale credentials can never be replayed by an attacker',
        'after they have been superseded by a fresh token issuance.',
        '',
        '### Scenario: Token rotation',
        '- GIVEN an authenticated session',
        '- WHEN the token approaches expiry',
        '- THEN a fresh token is issued and the old one is revoked',
        '',
      ].join('\n')
    }

    it('self-slug ADDED delta without marker: refuses completion, no capability folder created', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'landfill no marker'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'landfill-no-marker')
      // H1 left as the unedited change-slug default.
      await writeFile(join(changeDir, 'spec.md'), addedDelta('landfill-no-marker'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'spec', '--change', 'landfill-no-marker'],
        tempDir,
      )

      expect(code).not.toBe(0)
      // Stderr names the unconfirmed capability and the remedy.
      expect(stderr).toContain("'landfill-no-marker'")
      expect(stderr).toContain("matches this change's own slug")
      expect(stderr).toContain('<!-- new-capability -->')
      // No folder created under spec/specs/.
      expect(existsSync(join(tempDir, 'spec', 'specs', 'landfill-no-marker'))).toBe(false)
      // Artifact not marked complete — the throw precedes markArtifact.
      const meta = await readChangeMetaYaml('landfill-no-marker')
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts.spec).not.toBe('complete')
    })

    it('self-slug ADDED delta with marker: completes, and finalize merges the new capability', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      // Note: 'with' is a createChange stop word, so the fixture name avoids it.
      await runCli(['propose', 'landfill marker case'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'landfill-marker-case')
      await writeFile(
        join(changeDir, 'spec.md'),
        addedDelta('landfill-marker-case', { marker: true }),
        'utf8',
      )

      const complete = await runCli(
        ['complete', 'spec', '--change', 'landfill-marker-case'],
        tempDir,
      )
      expect(complete.stderr).not.toContain("matches this change's own slug")
      expect(complete.code).toBe(0)

      // Drive the change to finalize: completeness gate + passing gate stubs.
      await markAllArtifactsComplete('landfill-marker-case')
      await stubAllGatesPassing()
      const finalize = await runCli(['finalize', 'landfill-marker-case'], tempDir)
      expect(finalize.code).toBe(0)

      // The confirmed net-new capability was merged.
      const capSpecPath = join(tempDir, 'spec', 'specs', 'landfill-marker-case', 'spec.md')
      expect(existsSync(capSpecPath)).toBe(true)
      const capSpec = await readFile(capSpecPath, 'utf8')
      expect(capSpec).toContain('## Requirement: Session Management')
    })

    it('delta whose H1 names a pre-existing capability: completes and merges as before', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      // Pre-existing capability spec, unrelated to the change's slug.
      const capDir = join(tempDir, 'spec', 'specs', 'authcap')
      await mkdir(capDir, { recursive: true })
      await writeFile(
        join(capDir, 'spec.md'),
        '# authcap\n\n## Requirement: Login\n\nThe system MUST let users log in.\n',
        'utf8',
      )

      await runCli(['propose', 'existing cap target'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'existing-cap-target')
      await writeFile(join(changeDir, 'spec.md'), addedDelta('authcap'), 'utf8')

      const complete = await runCli(
        ['complete', 'spec', '--change', 'existing-cap-target'],
        tempDir,
      )
      expect(complete.stderr).not.toContain("matches this change's own slug")
      expect(complete.code).toBe(0)

      await markAllArtifactsComplete('existing-cap-target')
      await stubAllGatesPassing()
      const finalize = await runCli(['finalize', 'existing-cap-target'], tempDir)
      expect(finalize.code).toBe(0)

      // Merged into the existing capability — both requirements present, and
      // no change-slug-named capability folder appeared.
      const capSpec = await readFile(join(capDir, 'spec.md'), 'utf8')
      expect(capSpec).toContain('## Requirement: Login')
      expect(capSpec).toContain('## Requirement: Session Management')
      expect(existsSync(join(tempDir, 'spec', 'specs', 'existing-cap-target'))).toBe(false)
    })

    it('MODIFIED delta against a nonexistent capability hard-fails with or without the marker', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'modified ghost target'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'modified-ghost-target')

      // With the marker: the marker MUST NOT bypass the non-ADDED hard-fail.
      await writeFile(
        join(changeDir, 'spec.md'),
        modifiedDelta('modified-ghost-target', { marker: true }),
        'utf8',
      )
      const withMarker = await runCli(
        ['complete', 'spec', '--change', 'modified-ghost-target'],
        tempDir,
      )
      expect(withMarker.code).not.toBe(0)
      expect(withMarker.stderr).toContain('targets unknown capability')

      // Without the marker, H1 naming an unrelated nonexistent capability:
      // the pre-existing hard-fail path still fires.
      await writeFile(join(changeDir, 'spec.md'), modifiedDelta('ghostcap'), 'utf8')
      const withoutMarker = await runCli(
        ['complete', 'spec', '--change', 'modified-ghost-target'],
        tempDir,
      )
      expect(withoutMarker.code).not.toBe(0)
      expect(withoutMarker.stderr).toContain('targets unknown capability')

      // No writes on either run: artifact not complete, no capability folders.
      const meta = await readChangeMetaYaml('modified-ghost-target')
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts.spec).not.toBe('complete')
      expect(existsSync(join(tempDir, 'spec', 'specs', 'modified-ghost-target'))).toBe(false)
      expect(existsSync(join(tempDir, 'spec', 'specs', 'ghostcap'))).toBe(false)
    })
  })


  describe('metta complete --change slug validation', { timeout: 60000 }, () => {
    // Padded above the 200-byte content sanity floor so complete's artifact
    // checks never mask the slug-validation behavior under test.
    function validIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A single-file touch-up used to prove that a legitimate slug passes the',
        'assertSafeSlug guard on --change unchanged. The body is padded to clear',
        'the content-sanity floor of 200 bytes so the complete command does not',
        'reject the artifact before the slug check is exercised end to end.',
        '',
        '## Impact',
        '',
        '- `src/cli/commands/complete.ts`',
        '',
      ].join('\n')
    }

    it('rejects a traversal-shaped change name with a slug error (exit 4), no path join attempted', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', '../..'],
        tempDir,
      )
      expect(code).toBe(4)
      expect(stderr).toContain('Invalid change name')
      // The traversing path must never be reported as a missing artifact —
      // the slug guard fires before any join('spec','changes',<name>).
      expect(stderr).not.toContain('not found in spec/changes')
    })

    it('rejects an embedded-separator change name (foo/../bar) with a slug error', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'foo/../bar'],
        tempDir,
      )
      expect(code).toBe(4)
      expect(stderr).toContain('Invalid change name')
    })

    it('--json mode: traversal-shaped change name yields a structured error payload with code 4', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', '../../etc'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('Invalid change name')
    })

    it('accepts a legitimate slug: complete intent succeeds with exit 0', async () => {
      await installFixture(tempDir)
      await disableWorktrees(tempDir)
      await runCli(['propose', 'slug pass ok'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'slug-pass-ok')
      await writeFile(join(changeDir, 'intent.md'), validIntent('Slug Pass Ok'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'slug-pass-ok'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).not.toContain('Invalid change name')
    })
  })

})
