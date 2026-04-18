import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Finalizer } from '../src/finalize/finalizer.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { SpecLockManager } from '../src/specs/spec-lock-manager.js'
import { GateRegistry } from '../src/gates/gate-registry.js'
import { WorkflowEngine } from '../src/workflow/workflow-engine.js'

describe('Finalizer', () => {
  let specDir: string
  let artifactStore: ArtifactStore
  let lockManager: SpecLockManager
  let finalizer: Finalizer

  beforeEach(async () => {
    specDir = await mkdtemp(join(tmpdir(), 'metta-final-'))
    await mkdir(join(specDir, 'specs'), { recursive: true })
    await mkdir(join(specDir, 'archive'), { recursive: true })
    artifactStore = new ArtifactStore(specDir)
    lockManager = new SpecLockManager(specDir)
    finalizer = new Finalizer(specDir, artifactStore, lockManager)
  })

  afterEach(async () => {
    await rm(specDir, { recursive: true, force: true })
  })

  it('finalizes a change and archives it', async () => {
    await artifactStore.createChange('test feature', 'quick', ['intent', 'implementation', 'verification'])

    const result = await finalizer.finalize('test-feature')

    expect(result.changeName).toBe('test-feature')
    expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-test-feature$/)
    expect(result.specMerge.status).toBe('clean')

    // Change should be gone from active
    const changes = await artifactStore.listChanges()
    expect(changes).not.toContain('test-feature')
  })

  it('supports dry-run', async () => {
    await artifactStore.createChange('dry run test', 'quick', ['intent'])

    const result = await finalizer.finalize('dry-run-test', true)

    expect(result.archiveName).toBe('(dry-run)')

    // Change should still be active
    const changes = await artifactStore.listChanges()
    expect(changes).toContain('dry-run-test')
  })

  it('runs only gates declared in the workflow artifacts', async () => {
    // Register three gates; only `tests` is declared in the stub workflow.
    const gateRegistry = new GateRegistry()
    for (const name of ['tests', 'lint', 'build']) {
      gateRegistry.register({
        name,
        description: `${name} gate`,
        command: 'true',
        timeout: 5000,
        required: true,
        on_failure: 'stop',
      })
    }

    // Pre-populate the workflow engine's cache so loadWorkflow('quick', ...) hits
    // the cache instead of reading from disk. This is the stub.
    const workflowEngine = new WorkflowEngine()
    workflowEngine.loadWorkflowFromDefinition({
      name: 'quick',
      version: 1,
      artifacts: [
        {
          id: 'implementation',
          type: 'execution',
          template: 'execute.md',
          generates: '**/*',
          requires: [],
          agents: ['executor'],
          gates: ['tests'],
        },
      ],
    })

    const scopedFinalizer = new Finalizer(
      specDir,
      artifactStore,
      lockManager,
      gateRegistry,
      specDir,
      workflowEngine,
      ['/unused/path'],
    )

    await artifactStore.createChange('scoped gates test', 'quick', [
      'intent',
      'implementation',
      'verification',
    ])

    const result = await scopedFinalizer.finalize('scoped-gates-test')

    expect(result.gates.map(g => g.gate)).toEqual(['tests'])
    expect(result.gates.map(g => g.gate)).not.toContain('lint')
    expect(result.gates.map(g => g.gate)).not.toContain('build')
    expect(result.gatesPassed).toBe(true)
  })
})
