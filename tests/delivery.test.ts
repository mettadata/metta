import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeCodeAdapter } from '../src/delivery/claude-code-adapter.js'
import { installCommands } from '../src/delivery/command-installer.js'
import type { SkillContent, ProjectContext } from '../src/delivery/tool-adapter.js'

describe('Claude Code Adapter', () => {
  it('has correct id and name', () => {
    expect(claudeCodeAdapter.id).toBe('claude-code')
    expect(claudeCodeAdapter.name).toBe('Claude Code')
  })

  it('returns correct directories', () => {
    expect(claudeCodeAdapter.skillsDir('/project')).toBe('/project/.claude/skills')
    expect(claudeCodeAdapter.commandsDir('/project')).toBe('/project/.claude/commands')
    expect(claudeCodeAdapter.contextFile('/project')).toBe('/project/CLAUDE.md')
  })

  it('formats a skill with YAML frontmatter', () => {
    const skill: SkillContent = {
      name: 'metta:propose',
      description: 'Start a new change',
      argumentHint: '<description>',
      allowedTools: ['Read', 'Write', 'Bash'],
      body: 'You are starting a new change.',
    }
    const formatted = claudeCodeAdapter.formatSkill(skill)
    expect(formatted).toContain('---')
    expect(formatted).toContain('name: metta:propose')
    expect(formatted).toContain('description: Start a new change')
    expect(formatted).toContain('argument-hint: "<description>"')
    expect(formatted).toContain('allowed-tools: [Read, Write, Bash]')
    expect(formatted).toContain('You are starting a new change.')
  })

  it('formats context with section markers', () => {
    const context: ProjectContext = {
      name: 'My Shop',
      stack: 'Next.js, Prisma',
      conventions: ['Server components by default', 'Prisma for all DB access'],
      specs: [
        { capability: 'auth', requirements: 4, status: 'approved' },
      ],
    }
    const formatted = claudeCodeAdapter.formatContext(context)
    expect(formatted).toContain('<!-- metta:project-start')
    expect(formatted).toContain('<!-- metta:project-end -->')
    expect(formatted).toContain('**My Shop**')
    expect(formatted).toContain('Next.js, Prisma')
    expect(formatted).toContain('<!-- metta:conventions-start')
    expect(formatted).toContain('Server components by default')
    expect(formatted).toContain('<!-- metta:specs-start')
    expect(formatted).toContain('auth')
    expect(formatted).toContain('<!-- metta:workflow-start')
    expect(formatted).toContain('/metta-propose')
    expect(formatted).toContain('AI orchestrators MUST invoke the matching metta skill')
  })

  it('reports question capability', () => {
    const cap = claudeCodeAdapter.questionCapability()
    expect(cap.tool).toBe('AskUserQuestion')
    expect(cap.supportsOptions).toBe(true)
    expect(cap.supportsMultiSelect).toBe(true)
  })
})

describe('installCommands', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-install-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('copies skill template files to project', async () => {
    const installed = await installCommands(claudeCodeAdapter, tempDir)
    expect(installed.length).toBeGreaterThanOrEqual(8)
    expect(installed).toContain('metta:quick')
    expect(installed).toContain('metta:propose')

    // Verify files exist on disk
    const skillsDir = join(tempDir, '.claude', 'skills')
    const dirs = await readdir(skillsDir)
    expect(dirs).toContain('metta-quick')
    expect(dirs).toContain('metta-propose')

    // Verify content is real (not empty)
    const quickSkill = await readFile(join(skillsDir, 'metta-quick', 'SKILL.md'), 'utf-8')
    expect(quickSkill).toContain('name: metta:quick')
    expect(quickSkill).toContain('orchestrator')
  })
})
