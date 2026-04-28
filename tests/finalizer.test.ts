import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
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
