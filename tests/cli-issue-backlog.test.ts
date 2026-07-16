import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'

describe("CLI: issue / fix-issue / backlog / branch-safety / check-constitution", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('metta issue', () => {
    it('logs an issue with severity', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'issue', 'login flash', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('login-flash')
      expect(data.severity).toBe('major')
    })
  })


  describe('metta fix-issue', () => {
    it('no args emits skill-usage hint', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['fix-issue'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Usage: metta fix-issue')
      expect(stdout).toContain('/metta-fix-issues')
    })

    it('errors with exit 4 on unknown slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, stderr, code } = await runCli(['--json', 'fix-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const combined = stdout + stderr
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
      expect(combined).toContain('does-not-exist')
    })

    it('single-slug prints pipeline instructions', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const seed = await runCli(['--json', 'issue', 'foo problem', '--severity', 'minor'], tempDir)
      const seedData = JSON.parse(seed.stdout)
      const slug = seedData.slug
      const { stdout, code } = await runCli(['--json', 'fix-issue', slug], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issue.slug).toBe(slug)
      expect(data.issue.severity).toBe('minor')
      expect(data.issue.title).toBeTruthy()
    })

    it('single-slug prose output includes delegate hint', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'spec merger strips inline backticks', '--severity', 'major'], tempDir)
      const { stdout, code } = await runCli(['fix-issue', 'spec-merger-strips-inline-backticks'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Severity: major')
      expect(stdout).toContain('Status: logged')
      expect(stdout).toContain('metta execute --skill fix-issues --target spec-merger-strips-inline-backticks')
    })

    it('--all sorts by severity critical then major then minor', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Seed out of order: minor, critical, major
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(3)
      expect(data.issues[0].severity).toBe('critical')
      expect(data.issues[1].severity).toBe('major')
      expect(data.issues[2].severity).toBe('minor')
      expect(data.severity_filter).toBeNull()
    })

    it('--all --severity major filters to major only', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(1)
      expect(data.issues[0].severity).toBe('major')
      expect(data.severity_filter).toBe('major')
    })

    it('--remove-issue archives to spec/issues/resolved/ and deletes original', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { existsSync } = await import('node:fs')
      // Precondition
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(true)

      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)

      expect(existsSync(join(tempDir, 'spec', 'issues', 'resolved', 'stale-issue.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(false)
    })

    it('--remove-issue errors with exit 4 on unknown slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'fix-issue', '--remove-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
    })

    it('--remove-issue commits the archive move', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('fix(issues): remove resolved issue stale-issue')
    })
  })


  describe('branch-safety guard', () => {
    async function initAndCheckoutFeature(): Promise<void> {
      await runCli(['install', '--git-init'], tempDir)
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
    }

    it('metta issue blocks on feature branch with code 4', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['issue', 'test issue'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
      expect(stderr).toContain('metta/fix-foo')
      expect(stderr).toContain('main')
    })

    it('metta issue allows with --on-branch override', async () => {
      await initAndCheckoutFeature()
      const { code } = await runCli(
        ['issue', 'override ok', '--on-branch', 'metta/fix-foo'],
        tempDir,
      )
      expect(code).toBe(0)
    })

    it('metta backlog add blocks on feature branch', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['backlog', 'add', 'test item'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })

    it('metta backlog done blocks on feature branch', async () => {
      // Create a backlog item on main first
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'shippable'], tempDir)
      // Switch to feature branch
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
      // Try done — should be blocked
      const { code, stderr } = await runCli(['backlog', 'done', 'shippable'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })
  })


  describe('metta backlog add --description', () => {
    it('populates the body with the provided description instead of the title', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(
        ['backlog', 'add', 'Dark mode', '--description', 'Toggle in settings panel'],
        tempDir,
      )
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const body = await readFile(join(tempDir, 'spec', 'backlog', 'dark-mode.md'), 'utf8')
      expect(body).toContain('# Dark mode')
      expect(body).toContain('Toggle in settings panel')
    })

    it('defaults description to title when flag is omitted', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['backlog', 'add', 'Dark mode'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const body = await readFile(join(tempDir, 'spec', 'backlog', 'dark-mode.md'), 'utf8')
      expect(body).toContain('# Dark mode')
    })
  })


  describe('metta backlog done', () => {
    it('happy path — archives item, --json reports archived slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'foo', '--priority', 'medium'], tempDir)

      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'foo'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.archived).toBe('foo')

      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'done', 'foo.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'foo.md'))).toBe(false)
    })

    it('--change stamps Shipped-in metadata into archived file', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'bar'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'bar', '--change', 'my-change'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const archived = await readFile(join(tempDir, 'spec', 'backlog', 'done', 'bar.md'), 'utf8')
      expect(archived).toContain('**Shipped-in**: my-change')
    })

    it('unknown slug exits 4 with not_found error', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
    })

    it('hostile --change value exits 4 with invalid_change error', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'baz'], tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'done', 'baz', '--change', '../../etc/passwd'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('invalid_change')
    })

    it('commits archive with conventional message', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'qux'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'qux'], tempDir)
      expect(code).toBe(0)

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: archive shipped backlog item qux')

      // Commit must move the file from spec/backlog/ to spec/backlog/done/.
      // Git detects this as a rename, so use --name-status (R = rename)
      // with --no-renames disabled (default). The status line has both paths.
      const { stdout: status } = await execAsync(
        'git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: tempDir },
      )
      // Either the rename form "R<score>\tspec/backlog/qux.md\tspec/backlog/done/qux.md"
      // or separate D + A lines — both acceptable proofs that both sides were staged.
      expect(status).toMatch(/spec\/backlog\/qux\.md/)
      expect(status).toMatch(/spec\/backlog\/done\/qux\.md/)
    })
  })


  describe('metta check-constitution', () => {
    async function runCliWithEnv(
      args: string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execAsync(
          'npx',
          ['tsx', CLI_PATH, ...args],
          { cwd, timeout: 30000, env },
        )
        return { stdout, stderr, code: 0 }
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number }
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
      }
    }

    const PROJECT_MD = [
      '# Project',
      '',
      '## Conventions',
      '',
      '- Validate all state and config with Zod schemas',
      '',
      '## Off-Limits',
      '',
      '- No singletons',
      '- No `--force` pushes',
      '',
    ].join('\n')

    async function createChangeFixture(slug: string): Promise<void> {
      await mkdir(join(tempDir, 'spec', 'changes', slug), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), PROJECT_MD, 'utf8')
      await writeFile(
        join(tempDir, 'spec', 'changes', slug, 'spec.md'),
        '# Spec\n\n## Overview\nFixture change for check-constitution.\n',
        'utf8',
      )
    }

    function envWithoutApiKey(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (k !== 'ANTHROPIC_API_KEY' && v !== undefined) env[k] = v
      }
      return env
    }

    it('errors with exit 4 on missing change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('check_constitution_error')
      expect(data.error.message.length).toBeGreaterThan(0)
    })

    it('emits the check contract with no ANTHROPIC_API_KEY set (emission mode)', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await createChangeFixture('probe-change')
      const { stdout, code } = await runCliWithEnv(
        ['--json', 'check-constitution', '--change', 'probe-change'],
        tempDir,
        envWithoutApiKey(),
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.articles.conventions).toEqual([
        'Validate all state and config with Zod schemas',
      ])
      expect(data.articles.offLimits).toEqual(['No singletons', 'No `--force` pushes'])
      expect(data.spec_path).toContain(join('spec', 'changes', 'probe-change', 'spec.md'))
      expect(data.spec_content).toContain('Fixture change for check-constitution.')
      expect(data.verdict_schema).toContain('violations')
      expect(data.instructions.length).toBeGreaterThan(0)
      expect(data.output_path).toBe(join('.metta', 'scratch', 'probe-change', 'verdict.json'))
    })

    it('records a clean verdict and exits 0', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await createChangeFixture('probe-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(verdictFile, '{"violations":[]}', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'probe-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.violations_path).toBeTruthy()
      const md = await readFile(join(tempDir, data.violations_path), 'utf8')
      expect(md).toContain('No violations found.')
    })

    it('records a blocking verdict and exits 4', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await createChangeFixture('probe-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(
        verdictFile,
        JSON.stringify({
          violations: [
            {
              article: 'No singletons',
              severity: 'critical',
              evidence: 'shared singleton across modules',
              suggestion: 'inject the dependency',
            },
          ],
        }),
        'utf8',
      )
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'probe-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.blocking).toBe(true)
      const md = await readFile(join(tempDir, data.violations_path), 'utf8')
      expect(md).toContain('BLOCKING')
    })

    it('rejects malformed verdict JSON with exit 4 and does not write violations.md', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await createChangeFixture('malformed-change')
      const verdictFile = join(tempDir, 'verdict.json')
      await writeFile(verdictFile, 'this is not JSON at all', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'check-constitution', '--change', 'malformed-change', '--record', verdictFile],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('verdict_validation_error')
      expect(existsSync(join(tempDir, 'spec/changes/malformed-change/violations.md'))).toBe(false)
    })

    it('--help shows the command description', async () => {
      const { stdout, code } = await runCli(['check-constitution', '--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
      expect(stdout.toLowerCase()).toContain('constitution')
      expect(stdout).toContain('--change')
      expect(stdout).toContain('--record')
    })

    it('is registered in the main help listing', async () => {
      const { stdout, code } = await runCli(['--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
    })
  })

})
