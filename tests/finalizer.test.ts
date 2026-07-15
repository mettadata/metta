import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Finalizer } from '../src/finalize/finalizer.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { SpecLockManager } from '../src/specs/spec-lock-manager.js'
import { GateRegistry } from '../src/gates/gate-registry.js'
import { WorkflowEngine } from '../src/workflow/workflow-engine.js'
import { DocGenerator } from '../src/docs/doc-generator.js'

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

  // The finalizer's completeness gate requires every workflow-required
  // artifact to be 'complete' before anything else runs.
  async function markAllComplete(
    store: ArtifactStore,
    changeName: string,
    ids: string[],
  ): Promise<void> {
    for (const id of ids) {
      await store.markArtifact(changeName, id, 'complete')
    }
  }

  it('finalizes a change and archives it', async () => {
    await artifactStore.createChange('test feature', 'quick', ['intent', 'implementation', 'verification'])
    await markAllComplete(artifactStore, 'test-feature', ['intent', 'implementation', 'verification'])

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
    await markAllComplete(artifactStore, 'dry-run-test', ['intent'])

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
    await markAllComplete(artifactStore, 'scoped-gates-test', ['intent', 'implementation', 'verification'])

    const result = await scopedFinalizer.finalize('scoped-gates-test')

    expect(result.gates.map(g => g.gate)).toEqual(['tests'])
    expect(result.gates.map(g => g.gate)).not.toContain('lint')
    expect(result.gates.map(g => g.gate)).not.toContain('build')
    expect(result.gatesPassed).toBe(true)
  })

  it('aborts with incompleteArtifacts when a required artifact is not complete', async () => {
    await artifactStore.createChange('incomplete change', 'quick', ['intent', 'implementation', 'verification'])
    await artifactStore.markArtifact('incomplete-change', 'intent', 'complete')
    await artifactStore.markArtifact('incomplete-change', 'implementation', 'complete')
    // 'verification' deliberately left incomplete.

    // A delta targeting a capability — proves the merge never ran on abort.
    const deltaContent = `# blockedcap (Delta)

## ADDED: Requirement: Blocked Feature

The system MUST NOT merge this while verification is incomplete.

### Scenario: Blocked
- GIVEN an incomplete artifact
- WHEN finalize runs
- THEN nothing is merged
`
    await writeFile(join(specDir, 'changes', 'incomplete-change', 'spec.md'), deltaContent)

    const specsBefore = await readdir(join(specDir, 'specs'))

    const result = await finalizer.finalize('incomplete-change')

    expect(result.incompleteArtifacts).toBeDefined()
    expect(result.incompleteArtifacts!.map(a => a.id)).toEqual(['verification'])
    expect(result.archiveName).toBe('')

    // Change remains active.
    const changes = await artifactStore.listChanges()
    expect(changes).toContain('incomplete-change')

    // Nothing under specs/ changed.
    const specsAfter = await readdir(join(specDir, 'specs'))
    expect(specsAfter).toEqual(specsBefore)
  })

  it('gate failure leaves the target capability spec untouched', async () => {
    const gateRegistry = new GateRegistry()
    gateRegistry.register({
      name: 'tests',
      description: 'always-failing gate',
      command: 'false',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })
    const gatedFinalizer = new Finalizer(specDir, artifactStore, lockManager, gateRegistry, specDir)

    // Pre-existing capability spec the delta targets.
    await mkdir(join(specDir, 'specs', 'gatecap'), { recursive: true })
    const existingSpec = `# gatecap

## Requirement: Existing Behavior

The system MUST keep behaving.

### Scenario: Existing
- GIVEN the system
- WHEN it runs
- THEN it behaves
`
    await writeFile(join(specDir, 'specs', 'gatecap', 'spec.md'), existingSpec)

    await artifactStore.createChange('gate fail change', 'quick', ['intent', 'implementation', 'verification'])
    await markAllComplete(artifactStore, 'gate-fail-change', ['intent', 'implementation', 'verification'])
    const deltaContent = `# gatecap (Delta)

## ADDED: Requirement: New Behavior

The system MUST gain new behavior only after gates pass.

### Scenario: Gated
- GIVEN a failing gate
- WHEN finalize runs
- THEN the spec is untouched
`
    await writeFile(join(specDir, 'changes', 'gate-fail-change', 'spec.md'), deltaContent)

    const beforeBytes = await readFile(join(specDir, 'specs', 'gatecap', 'spec.md'))

    const result = await gatedFinalizer.finalize('gate-fail-change')

    expect(result.gatesPassed).toBe(false)
    expect(result.archiveName).toBe('')

    // Byte-identical: the gate failure aborted before any spec write.
    const afterBytes = await readFile(join(specDir, 'specs', 'gatecap', 'spec.md'))
    expect(afterBytes.equals(beforeBytes)).toBe(true)
  })

  it('retry after a fixed gate applies the merge exactly once', async () => {
    const failingRegistry = new GateRegistry()
    failingRegistry.register({
      name: 'tests',
      description: 'always-failing gate',
      command: 'false',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })

    await mkdir(join(specDir, 'specs', 'retrycap'), { recursive: true })
    const existingSpec = `# retrycap

## Requirement: Existing Behavior

The system MUST keep behaving.

### Scenario: Existing
- GIVEN the system
- WHEN it runs
- THEN it behaves
`
    await writeFile(join(specDir, 'specs', 'retrycap', 'spec.md'), existingSpec)

    await artifactStore.createChange('gate retry change', 'quick', ['intent', 'implementation', 'verification'])
    await markAllComplete(artifactStore, 'gate-retry-change', ['intent', 'implementation', 'verification'])
    const deltaContent = `# retrycap (Delta)

## ADDED: Requirement: Retry Behavior

The system MUST apply this requirement exactly once across retries.

### Scenario: Retried
- GIVEN a fixed gate
- WHEN finalize is retried
- THEN the delta merges once
`
    await writeFile(join(specDir, 'changes', 'gate-retry-change', 'spec.md'), deltaContent)

    // First run: gate fails, nothing merged.
    const failResult = await new Finalizer(specDir, artifactStore, lockManager, failingRegistry, specDir)
      .finalize('gate-retry-change')
    expect(failResult.gatesPassed).toBe(false)

    // Swap in a passing gate and retry.
    const passingRegistry = new GateRegistry()
    passingRegistry.register({
      name: 'tests',
      description: 'passing gate',
      command: 'true',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })
    const retryResult = await new Finalizer(specDir, artifactStore, lockManager, passingRegistry, specDir)
      .finalize('gate-retry-change')

    expect(retryResult.gatesPassed).toBe(true)
    expect(retryResult.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-gate-retry-change$/)

    const content = await readFile(join(specDir, 'specs', 'retrycap', 'spec.md'), 'utf-8')
    const headers = content.match(/^## Requirement: Retry Behavior$/gm) ?? []
    expect(headers.length).toBe(1)
  })

  describe('doc generation gating', () => {
    let projectRoot: string
    let scopedSpecDir: string
    let scopedArtifactStore: ArtifactStore
    let scopedLockManager: SpecLockManager

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), 'metta-final-docs-'))
      scopedSpecDir = join(projectRoot, 'spec')
      await mkdir(join(scopedSpecDir, 'specs'), { recursive: true })
      await mkdir(join(scopedSpecDir, 'archive'), { recursive: true })
      await mkdir(join(projectRoot, '.metta'), { recursive: true })
      scopedArtifactStore = new ArtifactStore(scopedSpecDir)
      scopedLockManager = new SpecLockManager(scopedSpecDir)
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await rm(projectRoot, { recursive: true, force: true })
    })

    it('invokes DocGenerator when .metta/config.yaml omits docs block', async () => {
      // No `docs:` key — schema default supplies generate_on: 'finalize'.
      await writeFile(join(projectRoot, '.metta', 'config.yaml'), 'project:\n  name: x\n')

      const generateSpy = vi.spyOn(DocGenerator.prototype, 'generate')
        .mockResolvedValue({ generated: ['changelog', 'architecture', 'api', 'getting-started'], skipped: [], warnings: [] })

      const finalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
      await scopedArtifactStore.createChange('docs default test', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, 'docs-default-test', ['intent', 'implementation', 'verification'])

      const result = await finalizer.finalize('docs-default-test')

      expect(generateSpy).toHaveBeenCalledTimes(1)
      expect(result.docsGenerated).toEqual(['changelog', 'architecture', 'api', 'getting-started'])
      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-docs-default-test$/)
    })

    it('skips DocGenerator when docs.generate_on is manual', async () => {
      await writeFile(
        join(projectRoot, '.metta', 'config.yaml'),
        'project:\n  name: x\ndocs:\n  generate_on: manual\n',
      )

      const generateSpy = vi.spyOn(DocGenerator.prototype, 'generate')
        .mockResolvedValue({ generated: ['UNEXPECTED'], skipped: [], warnings: [] })

      const finalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
      await scopedArtifactStore.createChange('docs manual test', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, 'docs-manual-test', ['intent', 'implementation', 'verification'])

      const result = await finalizer.finalize('docs-manual-test')

      expect(generateSpy).not.toHaveBeenCalled()
      expect(result.docsGenerated).toEqual([])
      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-docs-manual-test$/)
    })

    it('swallows DocGenerator errors and still archives', async () => {
      await writeFile(join(projectRoot, '.metta', 'config.yaml'), 'project:\n  name: x\n')

      vi.spyOn(DocGenerator.prototype, 'generate')
        .mockRejectedValue(new Error('synthetic doc generator failure'))

      const finalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
      await scopedArtifactStore.createChange('docs error test', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, 'docs-error-test', ['intent', 'implementation', 'verification'])

      const result = await finalizer.finalize('docs-error-test')

      expect(result.docsGenerated).toEqual([])
      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-docs-error-test$/)
    })

    it('produces a changelog when DocGenerator runs end-to-end without mocking', async () => {
      // Real DocGenerator path. Seed an archive entry with summary so changelog has content.
      await writeFile(join(projectRoot, '.metta', 'config.yaml'), 'project:\n  name: x\n')
      const priorArchive = join(scopedSpecDir, 'archive', '2026-01-01-prior')
      await mkdir(priorArchive, { recursive: true })
      await writeFile(join(priorArchive, 'summary.md'), 'Prior change summary text.\n')
      await writeFile(join(scopedSpecDir, 'project.md'), '# Project\n\n## Project\n\nTest project.\n')

      const finalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
      await scopedArtifactStore.createChange('endlessly verifies docs', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, 'endlessly-verifies-docs', ['intent', 'implementation', 'verification'])

      const result = await finalizer.finalize('endlessly-verifies-docs')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-endlessly-verifies-docs$/)
      // The exact list of generated entries depends on DocGenerator; assert at least changelog ran.
      const changelogPath = join(projectRoot, 'docs', 'changelog.md')
      const content = await readFile(changelogPath, 'utf-8')
      expect(content).toContain('Changelog')
      expect(content).toContain('2026-01-01')
      expect(content).toContain('prior')
    })
  })
})
