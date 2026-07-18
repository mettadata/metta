import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'

describe("CLI: skill & agent template byte-identity", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('metta --version', () => {
    it('prints the version from package.json', async () => {
      const { readFile } = await import('node:fs/promises')
      const pkg = JSON.parse(
        await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
      ) as { version: string }
      const { stdout } = await runCli(['--version'], tempDir)
      expect(stdout.trim()).toBe(pkg.version)
    })
  })


  describe('metta-init skill template', () => {
    it('references metta init --json and not metta install --json', async () => {
      const { readFile } = await import('node:fs/promises')
      const skillPath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-init', 'SKILL.md')
      const contents = await readFile(skillPath, 'utf8')
      expect(contents).toContain('metta init --json')
      expect(contents).not.toContain('metta install --json')
    })
  })


  describe('metta-init skill refresh step', () => {
    it('template and deployed copy both contain `metta refresh` and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-init', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-init', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toContain('metta refresh')
      expect(deployed).toContain('metta refresh')
      expect(template).toBe(deployed)
    })
  })

  describe('metta-fix-gap skill propose step', () => {
    it('template and deployed copy route propose through the Skill tool, not a bare `metta propose` CLI call, and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-gap', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-fix-gap', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      for (const content of [template, deployed]) {
        expect(content).toContain('/metta-propose')
        expect(content).toContain('Skill tool')
        // The bare CLI invocation `metta propose "..."` must not reappear — fix-gap is a
        // Tier-2 session-credentialed skill and can never authorize the Tier-1
        // fork-enforced `propose` subcommand via inline command text.
        expect(content).not.toMatch(/`metta propose /)
      }
      expect(template).toBe(deployed)
    })
  })


  describe('init flow — CLAUDE.md generation', () => {
    it('runRefresh creates CLAUDE.md populated from spec/project.md', async () => {
      const { runRefresh } = await import('../src/cli/commands/refresh.js')
      const { existsSync } = await import('node:fs')
      const { readFile, writeFile, mkdir } = await import('node:fs/promises')

      await mkdir(join(tempDir, 'spec'), { recursive: true })
      const projectMd = [
        '# Project Constitution',
        '',
        '## Project',
        '',
        'A test project for the refresh unit test.',
        '',
        '## Stack',
        '',
        '- TypeScript',
        '- Node.js',
        '',
        '## Conventions',
        '',
        '- Use ESM only',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'spec', 'project.md'), projectMd, 'utf8')

      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(true)

      const claudeMdPath = join(tempDir, 'CLAUDE.md')
      expect(existsSync(claudeMdPath)).toBe(true)
      const contents = await readFile(claudeMdPath, 'utf8')
      expect(contents.length).toBeGreaterThan(0)
      // buildProjectSection emits "## Project" and prefixes the description with "**metta** --"
      expect(contents).toContain('## Project')
      expect(contents).toContain('A test project for the refresh unit test.')
      expect(contents).toContain('TypeScript')
    })
  })


  describe('metta-next skill template', () => {
    it('template and deployed copy handle ship action and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-next', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-next', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/metta next.*says "ship"/i)
    })
  })


  describe('metta-issue skill template', () => {
    it('template and deployed copy reference the issue CLI and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-issue', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-issue', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toContain('name: metta:issue')
      expect(template).toContain('metta issue')
      expect(template).toContain('--severity')
    })
  })


  describe('metta-backlog skill template', () => {
    it('template and deployed copy cover all subcommands and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-backlog', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toContain('name: metta:backlog')
      for (const sub of ['list', 'show', 'add', 'promote']) {
        expect(template).toContain(sub)
      }
    })
  })


  describe('metta-backlog skill template — done option', () => {
    it('template and deployed copy are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-backlog', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
    })

    it('body mentions `metta backlog done` and `--change`', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toContain('metta backlog done')
      expect(contents).toContain('--change')
    })
  })


  describe('byte-identity: metta-constitution-checker agent', () => {
    it('template and deployed copy are byte-identical with required frontmatter', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(
        import.meta.dirname, '..', 'src', 'templates', 'agents', 'metta-constitution-checker.md',
      )
      const deployedPath = join(
        import.meta.dirname, '..', '.claude', 'agents', 'metta-constitution-checker.md',
      )
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/^---\n[\s\S]*?name:\s*metta-constitution-checker[\s\S]*?\n---/)
      // tools: must restrict to [Read] only
      expect(template).toMatch(/tools:\s*\[\s*Read\s*\]/)
    })
  })


  describe('byte-identity: metta-check-constitution skill', () => {
    it('template and deployed copy are byte-identical with required frontmatter', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(
        import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-check-constitution', 'SKILL.md',
      )
      const deployedPath = join(
        import.meta.dirname, '..', '.claude', 'skills', 'metta-check-constitution', 'SKILL.md',
      )
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/^---\n[\s\S]*?name:\s*metta:check-constitution[\s\S]*?\n---/)
    })
  })


  describe('metta-fix-issues skill template', () => {
    it('template exists with frontmatter name metta:fix-issues', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toMatch(/^---\n[\s\S]*?name:\s*metta:fix-issues[\s\S]*?\n---/)
    })

    it('deployed copy is byte-identical to template', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-fix-issues', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
    })

    it('body references all four CLI invocation modes', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toContain('fix-issue')
      expect(contents).toContain('fix-issue --all')
      expect(contents).toContain('fix-issue --remove-issue')
      // No-argument interactive-selection mode marker
      expect(contents).toMatch(/No-Argument Mode|interactive selection/i)
    })
  })

})
