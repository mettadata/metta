import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'
import { ProjectConfigSchema } from '../src/schemas/project-config.js'

describe("CLI: install / init / stack detection", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta install', () => {
    it('returns git_missing JSON when no git repo detected', async () => {
      const { stdout, code } = await runCli(['--json', 'install'], tempDir)
      expect(code).toBe(3)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('git_missing')
    })

    it('creates git repo with --git-init flag', async () => {
      const { stdout, code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('initialized')

      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.git'))).toBe(true)
      expect(existsSync(join(tempDir, '.metta'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'project.md'))).toBe(true)
    })

    it('does not create CLAUDE.md', async () => {
      const { code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false)
    })

    it('outputs JSON with git_initialized when --git-init is used', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('initialized')
      expect(data.git_initialized).toBe(true)
      expect(data.constitution).toBe('spec/project.md')
      expect(data.discovery).toBeUndefined()
      expect(data.mode).toBeUndefined()
    })

    it('works normally when git repo already exists', async () => {
      await execAsync('git', ['init'], { cwd: tempDir })
      const { stdout, code } = await runCli(['install'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('initialized')
    })

    it('JSON payload has no discovery or mode fields', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data).not.toHaveProperty('discovery')
      expect(data).not.toHaveProperty('mode')
      expect(data).not.toHaveProperty('claude_md')
    })

    it('human-mode output directs user to metta init', async () => {
      const { stdout } = await runCli(['install', '--git-init'], tempDir)
      expect(stdout).toContain('metta init')
    })

    it('scaffolds a schema-valid config.yaml with models.profile balanced', async () => {
      const { code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const { readFile } = await import('node:fs/promises')
      const configRaw = await readFile(join(tempDir, '.metta', 'config.yaml'), 'utf8')
      const parsed = parse(configRaw)
      expect(parsed.models).toEqual({ profile: 'balanced' })
      // The scaffolded content must validate against the config schema.
      const result = ProjectConfigSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })

    it('re-install preserves a user-edited config.yaml (wx flag — no overwrite, no duplicate models block)', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile, writeFile } = await import('node:fs/promises')
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const edited = 'project:\n  name: "edited-by-user"\nmodels:\n  profile: quality\n'
      await writeFile(configPath, edited, 'utf8')
      const { code } = await runCli(['install'], tempDir)
      expect(code).toBe(0)
      const after = await readFile(configPath, 'utf8')
      expect(after).toContain('name: "edited-by-user"')
      expect(after).toContain('profile: quality')
      expect(after).not.toContain('profile: balanced')
      const modelsLines = after.split('\n').filter(l => /^models:/.test(l))
      expect(modelsLines).toHaveLength(1)
    })

    it('writes .metta/.gitignore entries that git actually honors (directory-relative patterns)', async () => {
      const { code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const { readFile, writeFile: write, mkdir: mkdirP } = await import('node:fs/promises')
      const content = await readFile(join(tempDir, '.metta', '.gitignore'), 'utf8')
      // Patterns with a non-trailing slash inside .metta/.gitignore anchor to
      // .metta/ itself, so `.metta/state.yaml` there matches nothing.
      expect(content).not.toContain('.metta/')
      await write(join(tempDir, '.metta', 'state.yaml'), 'x\n', 'utf8')
      await mkdirP(join(tempDir, '.metta', 'logs'), { recursive: true })
      await write(join(tempDir, '.metta', 'logs', 'run.log'), 'x\n', 'utf8')
      const { stdout } = await execAsync(
        'git',
        ['check-ignore', '.metta/state.yaml', '.metta/logs/run.log'],
        { cwd: tempDir }
      )
      expect(stdout).toContain('.metta/state.yaml')
      expect(stdout).toContain('.metta/logs/run.log')
    })

    it('fresh install stamps installed_version with the running package version and config stays schema-valid', async () => {
      const { code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const { readFile } = await import('node:fs/promises')
      const pkg = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
      const configRaw = await readFile(join(tempDir, '.metta', 'config.yaml'), 'utf8')
      const parsed = parse(configRaw)
      expect(parsed.installed_version).toBe(pkg.version)
      const result = ProjectConfigSchema.safeParse(parsed)
      expect(result.success).toBe(true)
    })

    it('re-running install overwrites a stale installed_version with the running version', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile, writeFile } = await import('node:fs/promises')
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const seeded = 'project:\n  name: "x"\nmodels:\n  profile: balanced\ninstalled_version: "0.0.0-stale"\n'
      await writeFile(configPath, seeded, 'utf8')
      const { code } = await runCli(['install'], tempDir)
      expect(code).toBe(0)
      const pkg = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
      const parsed = parse(await readFile(configPath, 'utf8'))
      expect(parsed.installed_version).toBe(pkg.version)
      expect(parsed.installed_version).not.toBe('0.0.0-stale')
    })

    it('is idempotent on an already-installed project', async () => {
      // Drop a stack marker so writeStacksToConfig is exercised on both installs.
      await writeFile(join(tempDir, 'package.json'), '{"name":"x"}\n')
      const first = await runCli(['--json', 'install', '--git-init'], tempDir)
      expect(first.code).toBe(0)
      const second = await runCli(['--json', 'install'], tempDir)
      expect(second.code).toBe(0)
      const data = JSON.parse(second.stdout)
      expect(data.status).toBe('initialized')
      expect(data.committed).toBe(false)

      const { readFile } = await import('node:fs/promises')
      const configRaw = await readFile(join(tempDir, '.metta', 'config.yaml'), 'utf8')
      const stacksLines = configRaw.split('\n').filter(l => /^\s*stacks:/.test(l))
      expect(stacksLines).toHaveLength(1)
    })
  })


  describe('metta init', () => {
    it('exits code 3 with metta_not_installed when .metta/ is absent', async () => {
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(3)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('metta_not_installed')
      expect(data.error.code).toBe(3)
      expect(data.error.message).toContain('metta install')
    })

    it('emits brownfield discovery for a Rust project', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname = "x"\n')
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'main.rs'), 'fn main() {}\n')
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.discovery.mode).toBe('brownfield')
      expect(data.discovery.detected.stack).toContain('Rust')
      expect(data.discovery.detected.directories).toContain('src')
    })

    it('emits greenfield discovery for an empty project', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.discovery.mode).toBe('greenfield')
      expect(data.discovery.detected.stack).toEqual([])
      expect(data.discovery.detected.directories).toEqual([])
    })

    it('does not mutate the repository', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const before = await execAsync('git', ['status', '--porcelain'], { cwd: tempDir })
      const beforeLog = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      const { code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const after = await execAsync('git', ['status', '--porcelain'], { cwd: tempDir })
      const afterLog = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      expect(after.stdout).toBe(before.stdout)
      expect(afterLog.stdout).toBe(beforeLog.stdout)
    })
  })


  describe('metta install guard hook', () => {
    it('writes metta-guard-edit.mjs and registers PreToolUse in settings.json', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const hookPath = join(tempDir, '.claude', 'hooks', 'metta-guard-edit.mjs')
      const settingsPath = join(tempDir, '.claude', 'settings.json')
      const hookContents = await readFile(hookPath, 'utf8')
      expect(hookContents).toContain('metta-guard')
      expect(hookContents).toContain('Edit')
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const hasGuard = preToolUse.some((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-edit.mjs')),
      )
      expect(hasGuard).toBe(true)
    })

    it('is idempotent — second install does not duplicate the PreToolUse entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['install'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const guardEntries = preToolUse.filter((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-edit.mjs')),
      )
      expect(guardEntries.length).toBe(1)
    })

    it('registers metta-guard-bash PreToolUse entry alongside the Edit guard entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settingsPath = join(tempDir, '.claude', 'settings.json')
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const hasEditGuard = preToolUse.some((e: { matcher?: string; hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-edit.mjs')),
      )
      const hasBashGuard = preToolUse.some((e: { matcher?: string; hooks?: Array<{ command?: string }> }) =>
        e.matcher === 'Bash' && (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-bash.mjs')),
      )
      expect(hasEditGuard).toBe(true)
      expect(hasBashGuard).toBe(true)
    })

    it('is idempotent for metta-guard-bash — second install does not duplicate the Bash PreToolUse entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['install'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const bashGuardEntries = preToolUse.filter((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-bash.mjs')),
      )
      expect(bashGuardEntries.length).toBe(1)
    })

    it('copies metta-guard-bash.mjs byte-identical to the template', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const installedPath = join(tempDir, '.claude', 'hooks', 'metta-guard-bash.mjs')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'hooks', 'metta-guard-bash.mjs')
      const installed = await readFile(installedPath)
      const template = await readFile(templatePath)
      expect(installed.equals(template)).toBe(true)
    })

    it('registers metta-tokens-record SubagentStop entry in settings.json', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const hookPath = join(tempDir, '.claude', 'hooks', 'metta-tokens-record.mjs')
      const settingsPath = join(tempDir, '.claude', 'settings.json')
      const hookContents = await readFile(hookPath, 'utf8')
      expect(hookContents.length).toBeGreaterThan(0)
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
      const subagentStop = settings.hooks?.SubagentStop ?? []
      const hasTokensRecord = subagentStop.some((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-tokens-record.mjs')),
      )
      expect(hasTokensRecord).toBe(true)
    })

    it('is idempotent for metta-tokens-record — second install does not duplicate the SubagentStop entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['install'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
      const subagentStop = settings.hooks?.SubagentStop ?? []
      const tokensRecordEntries = subagentStop.filter((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-tokens-record.mjs')),
      )
      expect(tokensRecordEntries.length).toBe(1)
    })

    it('preserves existing PreToolUse guard entries when registering the SubagentStop entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const subagentStop = settings.hooks?.SubagentStop ?? []
      expect(preToolUse.length).toBe(2)
      expect(subagentStop.length).toBe(1)
      const entry = subagentStop[0] as { matcher?: string; hooks?: Array<{ type?: string; command?: string }> }
      expect(entry.matcher).toBeUndefined()
      expect(entry.hooks?.[0]?.type).toBe('command')
      expect(entry.hooks?.[0]?.command).toBe('.claude/hooks/metta-tokens-record.mjs')
    })

    it('inventory completeness: installed .claude/hooks/ exactly matches src/templates/hooks/, byte-identical and executable', async () => {
      const { readFile, readdir, stat } = await import('node:fs/promises')
      await runCli(['install', '--git-init'], tempDir)

      const templatesDir = join(import.meta.dirname, '..', 'src', 'templates', 'hooks')
      const templateEntries = await readdir(templatesDir, { withFileTypes: true })
      const templateFiles = templateEntries.filter((e) => e.isFile()).map((e) => e.name).sort()

      const installedDir = join(tempDir, '.claude', 'hooks')
      const installedEntries = await readdir(installedDir, { withFileTypes: true })
      const installedFiles = installedEntries.filter((e) => e.isFile()).map((e) => e.name).sort()

      // Every template hook (including hooks with no settings.json registration,
      // like metta-session-mint.mjs and metta-guard-agent-dispatch.mjs) must be
      // present — and nothing else.
      expect(installedFiles).toEqual(templateFiles)
      expect(templateFiles).toContain('metta-session-mint.mjs')
      expect(templateFiles).toContain('metta-guard-agent-dispatch.mjs')

      for (const file of templateFiles) {
        const templateContent = await readFile(join(templatesDir, file))
        const installedContent = await readFile(join(installedDir, file))
        expect(installedContent.equals(templateContent)).toBe(true)

        const installedStat = await stat(join(installedDir, file))
        expect(installedStat.mode & 0o111).not.toBe(0)
      }
    })
  })


  describe('metta install stack detection', () => {
    async function writeMarker(name: string): Promise<void> {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(tempDir, name), '')
    }

    async function readConfig(): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(join(tempDir, '.metta', 'config.yaml'), 'utf8')
    }

    it('Rust project scaffolds cargo gate commands', async () => {
      await writeMarker('Cargo.toml')
      const { stdout, code } = await runCli(['--json', 'install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust'])
      expect(data.scaffolded_gates.sort()).toEqual(['build.yaml', 'lint.yaml', 'tests.yaml', 'typecheck.yaml'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: cargo test')
    })

    it('Python project via pyproject.toml scaffolds pytest + pass-through build', async () => {
      await writeMarker('pyproject.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['python'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: pytest')
      const build = await readFile(join(tempDir, '.metta', 'gates', 'build.yaml'), 'utf8')
      expect(build).toContain("command: 'true'")
    })

    it('Python project via requirements.txt is detected', async () => {
      await writeMarker('requirements.txt')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['python'])
    })

    it('Go project scaffolds go commands with pass-through typecheck', async () => {
      await writeMarker('go.mod')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['go'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: go test ./...')
      const tc = await readFile(join(tempDir, '.metta', 'gates', 'typecheck.yaml'), 'utf8')
      expect(tc).toContain("command: 'true'")
    })

    it('JS project creates no .metta/gates/', async () => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(tempDir, 'package.json'), '{"name": "x", "version": "0.0.0"}')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['js'])
      expect(data.scaffolded_gates).toEqual([])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.metta', 'gates'))).toBe(false)
    })

    it('Multi-stack: Cargo.toml + pyproject.toml → rust primary with comment', async () => {
      await writeMarker('Cargo.toml')
      await writeMarker('pyproject.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust', 'python'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('cargo test')
      expect(tests).toContain('# Multi-stack project detected')
      expect(tests).toContain('python')
    })

    it('--stack rust overrides auto-detection in empty dir', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init', '--stack', 'rust'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust'])
      expect(data.scaffolded_gates.length).toBe(4)
    })

    it('--stack skip suppresses scaffolding even when markers exist', async () => {
      await writeMarker('Cargo.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init', '--stack', 'skip'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual([])
      expect(data.scaffolded_gates).toEqual([])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.metta', 'gates'))).toBe(false)
    })

    it('--stack with unsupported value exits non-zero', async () => {
      const { code } = await runCli(['install', '--git-init', '--stack', 'ruby'], tempDir)
      expect(code).not.toBe(0)
    })

    it('No markers → empty stacks and no gate files', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual([])
      expect(data.scaffolded_gates).toEqual([])
    })

    it('Re-running install does not overwrite existing gate files', async () => {
      await writeMarker('Cargo.toml')
      await runCli(['install', '--git-init'], tempDir)
      const { readFile, writeFile } = await import('node:fs/promises')
      const gatePath = join(tempDir, '.metta', 'gates', 'tests.yaml')
      await writeFile(gatePath, '# user-edited\nname: tests\ncommand: custom-cargo\n', 'utf8')
      await runCli(['install'], tempDir)
      const after = await readFile(gatePath, 'utf8')
      expect(after).toContain('command: custom-cargo')
      expect(after).toContain('# user-edited')
    })
  })

})
