import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
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
      changeRoot: tempDir,
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
    // output_path is absolute and rooted at changeRoot — never cwd-relative.
    expect(output.output_path).toBe(join(tempDir, 'spec', 'changes', 'test-change', 'intent.md'))
    expect(isAbsolute(output.output_path)).toBe(true)
    expect(output.change_root).toBe(tempDir)
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
      changeRoot: tempDir,
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

  it('normalizes object-form tool entries to string tool names', async () => {
    const artifact: WorkflowArtifact = {
      id: 'intent',
      type: 'intent',
      template: 'intent.md',
      generates: 'intent.md',
      requires: [],
      agents: ['implementer'],
      gates: [],
    }

    const agent: AgentDefinition = {
      name: 'implementer',
      persona: 'You are an implementation engineer.',
      capabilities: ['implement'],
      tools: [
        'Read',
        'Grep',
        { Bash: { deny_patterns: ['rm -rf'], allow_cwd: 'worktree_only' } },
      ],
      context_budget: 30000,
    }

    const output = await generator.generate({
      artifact,
      changeName: 'test-change',
      changePath,
      changeRoot: tempDir,
      workflow: 'standard',
      status: 'ready',
      specDir,
      agent,
      nextSteps: [],
    })

    expect(output.agent.tools).toEqual(['Read', 'Grep', 'Bash'])
  })

  it('omits budget.warning when utilization is under 80%', async () => {
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
      persona: 'p',
      capabilities: ['propose'],
      tools: ['Read'],
      context_budget: 50000,
    }
    const output = await generator.generate({
      artifact,
      changeName: 'test-change',
      changePath,
      changeRoot: tempDir,
      workflow: 'standard',
      status: 'ready',
      specDir,
      agent,
      nextSteps: [],
    })
    expect(output.budget.warning).toBeUndefined()
    expect(output.budget.dropped_optionals).toBeUndefined()
  })

  describe('existing_specs capability surfacing', () => {
    const specArtifact: WorkflowArtifact = {
      id: 'spec',
      type: 'spec',
      template: 'intent.md',
      generates: 'spec.md',
      requires: ['intent'],
      agents: ['specifier'],
      gates: [],
    }

    const specAgent: AgentDefinition = {
      name: 'specifier',
      persona: 'You are a spec writer.',
      capabilities: ['spec'],
      tools: ['Read'],
      context_budget: 40000,
    }

    it('populates existing_specs with sorted capability directory names for spec artifacts', async () => {
      // Created out of order to prove the sort.
      await mkdir(join(specDir, 'specs', 'billing'), { recursive: true })
      await mkdir(join(specDir, 'specs', 'auth'), { recursive: true })

      const output = await generator.generate({
        artifact: specArtifact,
        changeName: 'test-change',
        changePath,
        changeRoot: tempDir,
        workflow: 'standard',
        status: 'ready',
        specDir,
        agent: specAgent,
        nextSteps: [],
      })

      expect(output.context.existing_specs).toEqual(['auth', 'billing'])
    })

    it('leaves existing_specs undefined for non-spec artifacts even when capabilities exist', async () => {
      await mkdir(join(specDir, 'specs', 'auth'), { recursive: true })
      await mkdir(join(specDir, 'specs', 'billing'), { recursive: true })

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
        capabilities: ['propose'],
        tools: ['Read'],
        context_budget: 20000,
      }

      const output = await generator.generate({
        artifact,
        changeName: 'test-change',
        changePath,
        changeRoot: tempDir,
        workflow: 'standard',
        status: 'ready',
        specDir,
        agent,
        nextSteps: [],
      })

      expect(output.context.existing_specs).toBeUndefined()
    })

    it('returns [] for spec artifacts when the specs directory does not exist', async () => {
      const output = await generator.generate({
        artifact: specArtifact,
        changeName: 'test-change',
        changePath,
        changeRoot: tempDir,
        workflow: 'standard',
        status: 'ready',
        specDir,
        agent: specAgent,
        nextSteps: [],
      })

      expect(output.context.existing_specs).toEqual([])
    })
  })

  it('roots output_path and change_root at a worktree-style changeRoot', async () => {
    // Simulate a worktree-hosted change: the change lives under
    // <main>/.metta/worktrees/<name>, and the generator receives that
    // checkout as changeRoot. output_path must land inside the worktree.
    const worktreeRoot = join(tempDir, '.metta', 'worktrees', 'test-change')
    const wtChangePath = join(worktreeRoot, 'spec', 'changes', 'test-change')
    await mkdir(wtChangePath, { recursive: true })

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
      persona: 'p',
      capabilities: ['propose'],
      tools: ['Read'],
      context_budget: 20000,
    }

    const output = await generator.generate({
      artifact,
      changeName: 'test-change',
      changePath: wtChangePath,
      changeRoot: worktreeRoot,
      workflow: 'standard',
      status: 'ready',
      specDir: join(worktreeRoot, 'spec'),
      agent,
      nextSteps: [],
    })

    expect(output.change_root).toBe(worktreeRoot)
    expect(output.output_path).toBe(join(worktreeRoot, 'spec', 'changes', 'test-change', 'intent.md'))
    expect(isAbsolute(output.output_path)).toBe(true)
  })

  it('surfaces over-budget warning and dropped_optionals when context overflows', async () => {
    // Required intent consumes most of the agent budget; optional project.md (no headings)
    // cannot fit fully and its skeleton produces zero tokens → dropped.
    await writeFile(join(changePath, 'intent.md'), 'a'.repeat(4 * 4500)) // 4500 tokens
    await mkdir(specDir, { recursive: true })
    await writeFile(join(specDir, 'project.md'), 'y'.repeat(4 * 10_000))

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
      persona: 'p',
      capabilities: ['spec'],
      tools: ['Read'],
      context_budget: 10_000,
    }
    const output = await generator.generate({
      artifact,
      changeName: 'test-change',
      changePath,
      changeRoot: tempDir,
      workflow: 'standard',
      status: 'ready',
      specDir,
      agent,
      nextSteps: [],
    })
    expect(output.budget.warning).toBe('over-budget')
    expect(output.budget.dropped_optionals).toContain('project_context')
  })
})
