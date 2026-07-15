import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ContextEngine, type LoadedContext } from './context-engine.js'
import { TemplateEngine, type TemplateContext } from '../templates/template-engine.js'
import type { WorkflowArtifact } from '../schemas/workflow-definition.js'
import type { AgentDefinition } from '../schemas/agent-definition.js'

export interface InstructionOutput {
  artifact: string
  change: string
  workflow: string
  status: string
  agent: {
    name: string
    persona: string
    tools: string[]
    rules: string[]
  }
  template: string
  context: {
    project?: string
    existing_specs?: string[]
    active_gaps?: string[]
  }
  output_path: string
  next_steps: string[]
  gates: string[]
  budget: {
    context_tokens: number
    budget_tokens: number
    warning?: 'smart-zone' | 'over-budget'
    dropped_optionals?: string[]
  }
  questions?: InstructionQuestion[]
}

export interface InstructionQuestion {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multiSelect: boolean
}

export class InstructionGenerator {
  constructor(
    private contextEngine: ContextEngine,
    private templateEngine: TemplateEngine,
  ) {}

  async generate(params: {
    artifact: WorkflowArtifact
    changeName: string
    changePath: string
    workflow: string
    status: string
    specDir: string
    agent: AgentDefinition
    nextSteps: string[]
    questions?: InstructionQuestion[]
  }): Promise<InstructionOutput> {
    // Load context for this artifact
    const context = await this.contextEngine.resolve(
      params.artifact.type,
      params.changePath,
      params.specDir,
      params.agent.context_budget,
    )

    // Render template
    const templateContext: TemplateContext = {
      change_name: params.changeName,
      capability_name: params.changeName,
    }
    const template = await this.templateEngine.render(
      params.artifact.template,
      templateContext,
    )

    // Extract tool names as strings
    const tools = params.agent.tools.map(t => {
      if (typeof t === 'string') return t
      return Object.keys(t)[0]
    })

    const budget: InstructionOutput['budget'] = {
      context_tokens: context.totalTokens,
      budget_tokens: context.budget,
    }
    if (context.warning) {
      budget.warning = context.warning
      budget.dropped_optionals = context.droppedOptionals
    }

    // Surface existing capability slugs to spec authors only, so the delta's
    // H1 can target a real capability instead of defaulting to the change's
    // own slug. Every other artifact type leaves existing_specs undefined.
    const instructionContext: InstructionOutput['context'] = {
      project: this.extractProjectContext(context),
    }
    if (params.artifact.type === 'spec') {
      instructionContext.existing_specs = await this.listExistingCapabilities(params.specDir)
    }

    return {
      artifact: params.artifact.id,
      change: params.changeName,
      workflow: params.workflow,
      status: params.status,
      agent: {
        name: params.agent.name,
        persona: params.agent.persona,
        tools,
        rules: params.agent.rules ?? [],
      },
      template,
      context: instructionContext,
      output_path: `spec/changes/${params.changeName}/${params.artifact.generates}`,
      next_steps: params.nextSteps,
      gates: params.artifact.gates,
      budget,
      questions: params.questions,
    }
  }

  private extractProjectContext(context: LoadedContext): string | undefined {
    const projectFile = context.files.find(f => f.path.endsWith('project.md'))
    return projectFile?.content
  }

  /**
   * List existing capability slugs — the directory names under
   * `<specDir>/specs/`. Returns a sorted array; returns `[]` when the specs
   * directory doesn't exist (ENOENT) or on any other read error.
   */
  private async listExistingCapabilities(specDir: string): Promise<string[]> {
    try {
      const entries = await readdir(join(specDir, 'specs'), { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
    } catch {
      return []
    }
  }
}
