import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { InstructionGenerator } from '../src/context/instruction-generator.js'
import { ContextEngine } from '../src/context/context-engine.js'
import { TemplateEngine } from '../src/templates/template-engine.js'
import type { WorkflowArtifact } from '../src/schemas/workflow-definition.js'
import type { AgentDefinition } from '../src/schemas/agent-definition.js'

const REPO_ROOT = join(import.meta.dirname, '..')
const ARTIFACTS_TEMPLATE_DIR = join(REPO_ROOT, 'src/templates/artifacts')
const WORKFLOWS_DIR = join(REPO_ROOT, 'src/templates/workflows')

interface WorkflowYaml {
  artifacts: Array<{ id: string; generates: string; template: string }>
}

describe('verification artifact contract agreement', () => {
  it('verify.md instructs saving the artifact as summary.md', async () => {
    const template = await readFile(join(ARTIFACTS_TEMPLATE_DIR, 'verify.md'), 'utf8')
    expect(template).toContain('Save this file as `summary.md` in the change directory.')
  })

  it.each(['trivial.yaml', 'quick.yaml', 'standard.yaml'])(
    "%s declares generates: summary.md for its verification artifact, matching the template's instruction",
    async (workflowFile) => {
      const raw = await readFile(join(WORKFLOWS_DIR, workflowFile), 'utf8')
      const workflow = parse(raw) as WorkflowYaml
      const verification = workflow.artifacts.find(a => a.id === 'verification')
      expect(verification).toBeDefined()
      expect(verification!.generates).toBe('summary.md')
      expect(verification!.template).toBe('verify.md')
    },
  )

  describe('rendered instructions agree with the declared contract end to end', () => {
    let tempDir: string
    let specDir: string
    let changePath: string
    let generator: InstructionGenerator

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'metta-verify-contract-'))
      specDir = join(tempDir, 'spec')
      changePath = join(specDir, 'changes', 'test-change')
      await mkdir(changePath, { recursive: true })

      const contextEngine = new ContextEngine()
      const templateEngine = new TemplateEngine([ARTIFACTS_TEMPLATE_DIR])
      generator = new InstructionGenerator(contextEngine, templateEngine)
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('output_path ends in summary.md and the rendered template names summary.md', async () => {
      const artifact: WorkflowArtifact = {
        id: 'verification',
        type: 'verification',
        template: 'verify.md',
        generates: 'summary.md',
        requires: ['implementation'],
        agents: ['verifier'],
        gates: [],
      }
      const agent: AgentDefinition = {
        name: 'verifier',
        persona: 'You are a verification engineer.',
        capabilities: ['verify'],
        tools: ['Read'],
        context_budget: 20000,
      }

      const output = await generator.generate({
        artifact,
        changeName: 'test-change',
        changePath,
        workflow: 'trivial',
        status: 'ready',
        specDir,
        agent,
        nextSteps: [],
      })

      expect(output.output_path.endsWith('summary.md')).toBe(true)
      expect(output.template).toContain('Save this file as `summary.md` in the change directory.')
    })
  })
})
