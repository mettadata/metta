import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InstructionGenerator } from '../src/context/instruction-generator.js'
import { ContextEngine } from '../src/context/context-engine.js'
import { TemplateEngine } from '../src/templates/template-engine.js'
import type { WorkflowArtifact } from '../src/schemas/workflow-definition.js'
import type { AgentDefinition } from '../src/schemas/agent-definition.js'

describe('InstructionGenerator', () => {
  let tempDir: string
  let specDir: string
  let changePath: string
  let generator: InstructionGenerator

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-'))
    specDir = join(tempDir, 'spec')
    changePath = join(specDir, 'changes', 'test-change')
    await mkdir(changePath, { recursive: true })

    const templateDir = join(tempDir, 'templates')
    await mkdir(templateDir, { recursive: true })
    await writeFile(join(templateDir, 'intent.md'), '# {change_name}\n\n## Problem\nDescribe the problem.')

    const contextEngine = new ContextEngine()
    const templateEngine = new TemplateEngine([templateDir])
    generator = new InstructionGenerator(contextEngine, templateEngine)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('generates instruction output with all required fields', async () => {
    const artifact: WorkflowArtifact = {
      id: 'intent',
      type: 'intent',
      template: 'intent.md',
      generates: 'intent.md',
      requires: [],
      agents: ['proposer'],
      gates: [],
    }

    const agent: AgentDefinition = {
      name: 'proposer',
      persona: 'You are a product-minded engineer.',
      capabilities: ['propose', 'intent'],
      tools: ['Read', 'Grep', 'Glob'],
      context_budget: 20000,
      rules: ['Focus on the why, not the how'],
    }

    const output = await generator.generate({
      artifact,
      changeName: 'test-change',
      changePath,
      workflow: 'standard',
      status: 'ready',
      specDir,
      agent,
      nextSteps: ['Create the intent artifact', 'Run metta status'],
    })

    expect(output.artifact).toBe('intent')
    expect(output.change).toBe('test-change')
    expect(output.workflow).toBe('standard')
    expect(output.status).toBe('ready')
    expect(output.agent.name).toBe('proposer')
    expect(output.agent.persona).toContain('product-minded')
    expect(output.agent.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(output.agent.rules).toContain('Focus on the why, not the how')
    expect(output.template).toContain('# test-change')
    expect(output.output_path).toBe('spec/changes/test-change/intent.md')
    expect(output.next_steps).toHaveLength(2)
    expect(output.gates).toEqual([])
    expect(output.budget.budget_tokens).toBe(20000)
  })

  it('includes questions when provided', async () => {
    const artifact: WorkflowArtifact = {
      id: 'spec',
      type: 'spec',
      template: 'intent.md',
      generates: 'spec.md',
      requires: ['intent'],
      agents: ['specifier'],
      gates: [],
    }

    const agent: AgentDefinition = {
      name: 'specifier',
      persona: 'You are a spec writer.',
      capabilities: ['spec'],
      tools: ['Read'],
      context_budget: 40000,
    }

    const output = await generator.generate({
      artifact,
      changeName: 'test',
      changePath,
      workflow: 'standard',
      status: 'needs_input',
      specDir,
      agent,
      nextSteps: [],
      questions: [
        {
          question: 'Should refunds support partial amounts?',
          header: 'Refunds',
          options: [
            { label: 'Full and partial', description: 'Users can request any amount' },
            { label: 'Full only', description: 'Simpler' },
          ],
          multiSelect: false,
        },
      ],
    })

    expect(output.questions).toHaveLength(1)
    expect(output.questions![0].question).toContain('refunds')
  })
})
