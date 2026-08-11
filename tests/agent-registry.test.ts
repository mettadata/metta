import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadAgentDefinition, AgentResolutionError } from '../src/agents/agent-registry.js'

const REAL_TEMPLATE_DIR = join(import.meta.dirname, '..', 'src', 'templates', 'agents')

const REAL_SHORT_NAMES = [
  'proposer',
  'specifier',
  'product',
  'researcher',
  'architect',
  'planner',
  'executor',
  'verifier',
  'reviewer',
] as const

describe('loadAgentDefinition', () => {
  describe('real agent templates', () => {
    it.each(REAL_SHORT_NAMES)(
      "resolves '%s' to a definition with name metta-<shortName> and non-empty persona",
      async (shortName) => {
        const agent = await loadAgentDefinition(shortName, 'some-artifact', REAL_TEMPLATE_DIR)
        expect(agent.name).toBe(`metta-${shortName}`)
        expect(agent.persona.trim().length).toBeGreaterThan(0)
        expect(Array.isArray(agent.tools)).toBe(true)
        expect(agent.tools.length).toBeGreaterThan(0)
      },
    )

    it('sources tools from frontmatter, not the old BUILTIN_AGENTS literal (proposer has Write and Bash)', async () => {
      const agent = await loadAgentDefinition('proposer', 'intent', REAL_TEMPLATE_DIR)
      expect(agent.tools).toContain('Write')
      expect(agent.tools).toContain('Bash')
    })

    it('sources tools from frontmatter (specifier has Write)', async () => {
      const agent = await loadAgentDefinition('specifier', 'spec', REAL_TEMPLATE_DIR)
      expect(agent.tools).toContain('Write')
    })
  })

  describe('resolution failure', () => {
    it('throws AgentResolutionError for an unknown short name, carrying agentName and artifactId', async () => {
      let thrown: unknown
      try {
        await loadAgentDefinition('nonexistent', 'implementation', REAL_TEMPLATE_DIR)
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(AgentResolutionError)
      const e = thrown as AgentResolutionError
      expect(e.agentName).toBe('nonexistent')
      expect(e.artifactId).toBe('implementation')
      expect(e.message).toContain('nonexistent')
      expect(e.message).toContain('implementation')
    })
  })

  describe('fixture agent files', () => {
    let fixtureDir: string

    beforeEach(async () => {
      fixtureDir = await mkdtemp(join(tmpdir(), 'metta-agent-registry-'))
    })

    afterEach(async () => {
      await rm(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    it('throws AgentResolutionError when the body opens directly with a heading (empty persona)', async () => {
      await writeFile(
        join(fixtureDir, 'metta-headless.md'),
        [
          '---',
          'name: metta-headless',
          'description: "fixture with no persona paragraph"',
          'tools: [Read]',
          '---',
          '',
          '## Your Role',
          '',
          'This body opens directly with a heading, so no persona exists.',
          '',
        ].join('\n'),
      )
      await expect(
        loadAgentDefinition('headless', 'spec', fixtureDir),
      ).rejects.toThrow(AgentResolutionError)
    })

    it('parses a tools: frontmatter array into the expected string[]', async () => {
      await writeFile(
        join(fixtureDir, 'metta-toolful.md'),
        [
          '---',
          'name: metta-toolful',
          'description: "fixture with a tools array"',
          'tools: [Read, Write, Edit, Bash, Grep, Glob]',
          'color: blue',
          '---',
          '',
          'You are a **fixture agent** used to prove tools parsing.',
          '',
          '## Your Role',
          '',
          'Not relevant.',
          '',
        ].join('\n'),
      )
      const agent = await loadAgentDefinition('toolful', 'implementation', fixtureDir)
      expect(agent.tools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'])
      expect(agent.name).toBe('metta-toolful')
      expect(agent.persona).toBe('You are a fixture agent used to prove tools parsing.')
    })
  })
})
