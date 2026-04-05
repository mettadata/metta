import { join } from 'node:path'
import { ConfigLoader } from '../config/config-loader.js'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { WorkflowEngine } from '../workflow/workflow-engine.js'
import { ContextEngine } from '../context/context-engine.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { IdeasStore } from '../ideas/ideas-store.js'
import { IssuesStore } from '../issues/issues-store.js'
import { BacklogStore } from '../backlog/backlog-store.js'
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
