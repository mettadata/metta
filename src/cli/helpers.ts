import { join } from 'node:path'
import { ConfigLoader } from '../config/config-loader.js'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { WorkflowEngine } from '../workflow/workflow-engine.js'
import { ContextEngine } from '../context/context-engine.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { IdeasStore } from '../ideas/ideas-store.js'
import { IssuesStore } from '../issues/issues-store.js'
import { BacklogStore } from '../backlog/backlog-store.js'
import { GapsStore } from '../gaps/gaps-store.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { TemplateEngine } from '../templates/template-engine.js'
import { InstructionGenerator } from '../context/instruction-generator.js'
import { StateStore } from '../state/state-store.js'
import type { Command } from 'commander'

export interface CliContext {
  projectRoot: string
  configLoader: ConfigLoader
  artifactStore: ArtifactStore
  workflowEngine: WorkflowEngine
  contextEngine: ContextEngine
  gateRegistry: GateRegistry
  ideasStore: IdeasStore
  issuesStore: IssuesStore
  backlogStore: BacklogStore
  gapsStore: GapsStore
  specLockManager: SpecLockManager
  templateEngine: TemplateEngine
  instructionGenerator: InstructionGenerator
  stateStore: StateStore
}

export function createCliContext(projectRoot?: string): CliContext {
  const root = projectRoot ?? process.cwd()
  const configLoader = new ConfigLoader(root)
  const specDir = join(root, 'spec')
  const mettaDir = join(root, '.metta')

  const artifactStore = new ArtifactStore(specDir)
  const workflowEngine = new WorkflowEngine()
  const contextEngine = new ContextEngine()
  const gateRegistry = new GateRegistry()
  const ideasStore = new IdeasStore(specDir)
  const issuesStore = new IssuesStore(specDir)
  const backlogStore = new BacklogStore(specDir)
  const gapsStore = new GapsStore(specDir)
  const specLockManager = new SpecLockManager(specDir)
  const stateStore = new StateStore(mettaDir)

  const builtinTemplates = new URL('../templates/artifacts', import.meta.url).pathname
  const projectTemplates = join(mettaDir, 'templates')
  const templateEngine = new TemplateEngine([projectTemplates, builtinTemplates])

  const instructionGenerator = new InstructionGenerator(contextEngine, templateEngine)

  return {
    projectRoot: root,
    configLoader,
    artifactStore,
    workflowEngine,
    contextEngine,
    gateRegistry,
    ideasStore,
    issuesStore,
    backlogStore,
    gapsStore,
    specLockManager,
    templateEngine,
    instructionGenerator,
    stateStore,
  }
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

export function handleError(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err)
  if (json) {
    outputJson({ error: { code: 4, type: 'validation_error', message } })
  } else {
    console.error(`Error: ${message}`)
  }
  process.exit(4)
}

export function getJsonFlag(cmd: Command): boolean {
  const parent = cmd.parent
  return parent?.opts()?.json ?? false
}

// --- ANSI color helpers ---

export function color(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[0m`
}

const phaseColorMap: Record<string, number> = {
  propose: 31,
  intent: 31,
  spec: 31,
  research: 33,
  design: 33,
  tasks: 33,
  implementation: 34,
  execute: 34,
  verification: 32,
  verify: 32,
  finalize: 32,
  ship: 92,
  error: 31,
  success: 32,
  info: 36,
  dim: 90,
}

export function phaseColor(phase: string): number {
  return phaseColorMap[phase] ?? 36
}

export function banner(phase: string, message: string): string {
  const code = phaseColor(phase)
  return color(`[${phase.toUpperCase()}]`, code) + ' ' + message
}

// Agent-specific colored banners
const agentColorMap: Record<string, { code: number; icon: string }> = {
  proposer:   { code: 31, icon: '📝' },
  specifier:  { code: 31, icon: '📋' },
  researcher: { code: 33, icon: '🔬' },
  architect:  { code: 33, icon: '🏗️' },
  planner:    { code: 33, icon: '📐' },
  executor:   { code: 34, icon: '⚡' },
  reviewer:   { code: 35, icon: '🔎' },
  verifier:   { code: 32, icon: '✅' },
  discovery:  { code: 36, icon: '🔍' },
}

export function agentBanner(agentName: string, message: string): string {
  const agent = agentColorMap[agentName] ?? { code: 36, icon: '🤖' }
  const label = `metta-${agentName}`
  return `${agent.icon} ${color(`[${label.toUpperCase()}]`, agent.code)} ${message}`
}
