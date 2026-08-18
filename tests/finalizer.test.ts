import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Finalizer } from '../src/finalize/finalizer.js'
import { SpecMerger } from '../src/finalize/spec-merger.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { SpecLockManager } from '../src/specs/spec-lock-manager.js'
import { GateRegistry } from '../src/gates/gate-registry.js'
import { WorkflowEngine } from '../src/workflow/workflow-engine.js'
import { DocGenerator } from '../src/docs/doc-generator.js'
import { TemplateEngine } from '../src/templates/template-engine.js'

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
    await rm(specDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

  it('returns uatPath null and writes no UAT.md when constructed without a projectRoot', async () => {
    await artifactStore.createChange('no root uat', 'quick', ['intent'])
    await markAllComplete(artifactStore, 'no-root-uat', ['intent'])

    const result = await finalizer.finalize('no-root-uat')

    expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-no-root-uat$/)
    expect(result.uatPath).toBeNull()
    expect(result.uatError).toBeUndefined()

    const archived = await readdir(join(specDir, 'archive', result.archiveName))
    expect(archived).not.toContain('UAT.md')
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

  it('MODIFIED against an absent requirement aborts at the step-3 conflict gate before the applying merge', async () => {
    // Pins spec.md's "Preflight dry-run catches an apply-time-only conflict
    // class" scenario at the finalizer layer: a MODIFIED delta against a
    // requirement absent from an *existing* capability spec was, before this
    // fix, invisible to Step 3's dry-run gate and only surfaced as a conflict
    // during the applying merge. It must now be caught structurally by the
    // dry-run call itself.
    await mkdir(join(specDir, 'specs', 'modcap'), { recursive: true })
    const existingSpec = `# modcap

## Requirement: Existing Behavior

The system MUST keep behaving.

### Scenario: Existing
- GIVEN the system
- WHEN it runs
- THEN it behaves
`
    await writeFile(join(specDir, 'specs', 'modcap', 'spec.md'), existingSpec)

    await artifactStore.createChange('modified conflict change', 'quick', ['intent', 'implementation', 'verification'])
    await markAllComplete(artifactStore, 'modified-conflict-change', ['intent', 'implementation', 'verification'])

    const deltaContent = `# modcap (Delta)

## MODIFIED: Requirement: Ghost Requirement

The system MUST do ghostly things.

### Scenario: Ghostly
- GIVEN a ghost
- WHEN invoked
- THEN it haunts
`
    await writeFile(join(specDir, 'changes', 'modified-conflict-change', 'spec.md'), deltaContent)

    const beforeBytes = await readFile(join(specDir, 'specs', 'modcap', 'spec.md'))
    const beforeLockExists = await readFile(join(specDir, 'specs', 'modcap', 'spec.lock')).catch(() => null)

    const mergeSpy = vi.spyOn(SpecMerger.prototype, 'merge')

    const result = await finalizer.finalize('modified-conflict-change')

    expect(result.specMerge.status).toBe('conflict')
    expect(result.specMerge.conflicts.some(c => c.reason === 'requirement not found')).toBe(true)
    expect(result.archiveName).toBe('')

    // Only the Step 3 dry-run call happened — the applying merge
    // (dryRun: false) was never reached.
    expect(mergeSpy).toHaveBeenCalledTimes(1)
    expect(mergeSpy).toHaveBeenCalledWith('modified-conflict-change', expect.any(Object), true)
    mergeSpy.mockRestore()

    // Spec store — both the capability spec file and its lock — untouched.
    const afterBytes = await readFile(join(specDir, 'specs', 'modcap', 'spec.md'))
    const afterLockExists = await readFile(join(specDir, 'specs', 'modcap', 'spec.lock')).catch(() => null)
    expect(afterBytes.equals(beforeBytes)).toBe(true)
    expect(afterLockExists).toBe(beforeLockExists)
  })

  describe('gate results staging (Step 5d)', () => {
    function passingRegistry(): GateRegistry {
      const registry = new GateRegistry()
      registry.register({
        name: 'tests',
        description: 'passing gate',
        command: 'true',
        timeout: 5000,
        required: true,
        on_failure: 'stop',
      })
      return registry
    }

    it('stages gates.yaml in the change dir pre-archive so the move sweeps it in', async () => {
      const gatedFinalizer = new Finalizer(specDir, artifactStore, lockManager, passingRegistry(), specDir)

      await artifactStore.createChange('gates sweep test', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(artifactStore, 'gates-sweep-test', ['intent', 'implementation', 'verification'])

      const result = await gatedFinalizer.finalize('gates-sweep-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-gates-sweep-test$/)
      const raw = await readFile(join(specDir, 'archive', result.archiveName, 'gates.yaml'), 'utf-8')
      const YAML = (await import('yaml')).default
      const parsed = YAML.parse(raw) as { all_passed: boolean; results: Array<{ gate: string; status: string }> }
      expect(parsed.all_passed).toBe(true)
      expect(parsed.results.map(r => r.gate)).toEqual(['tests'])

      // The move took the whole change dir — nothing left behind.
      const remaining = await readdir(join(specDir, 'changes')).catch(() => [] as string[])
      expect(remaining).not.toContain('gates-sweep-test')
    })

    it('a gates.yaml staging failure aborts BEFORE the archive move — change stays fully active', async () => {
      const gatedFinalizer = new Finalizer(specDir, artifactStore, lockManager, passingRegistry(), specDir)

      await artifactStore.createChange('gates strand test', 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(artifactStore, 'gates-strand-test', ['intent', 'implementation', 'verification'])

      // A directory squatting on the gates.yaml path makes the staging write
      // fail deterministically (EISDIR) — the same injection the UAT
      // degradation tests use for write-adjacent failures.
      await mkdir(join(specDir, 'changes', 'gates-strand-test', 'gates.yaml'))

      await expect(gatedFinalizer.finalize('gates-strand-test')).rejects.toThrow()

      // Not half-archived: the change is still active with its metadata, and
      // no orphan archive dir was created. Under the old post-archive write
      // ordering this failure left the change dir gone and unrecoverable.
      const changes = await artifactStore.listChanges()
      expect(changes).toContain('gates-strand-test')
      const archived = await readdir(join(specDir, 'archive'))
      expect(archived.filter(name => name.includes('gates-strand-test'))).toEqual([])
    })

    it('worktree-hosted change: all finalize writes land in the hosting worktree, main checkout untouched', async () => {
      // Simulated worktree-per-change layout (filesystem-based, no real git):
      // the store is rooted at the MAIN spec dir; the change lives in
      // `.metta/worktrees/<name>/spec/changes/<name>`.
      const rootDir = await mkdtemp(join(tmpdir(), 'metta-final-wt-'))
      try {
        const mainSpecDir = join(rootDir, 'spec')
        await mkdir(join(mainSpecDir, 'specs'), { recursive: true })
        await mkdir(join(mainSpecDir, 'archive'), { recursive: true })
        const worktreesDir = join(rootDir, '.metta', 'worktrees')
        const store = new ArtifactStore(mainSpecDir, { worktreesDir })

        const host = join(worktreesDir, 'wt-hosted-final')
        await mkdir(join(host, 'spec'), { recursive: true })
        // docs.generate_on: manual keeps DocGenerator out; uat/tokens omitted
        // → enabled by schema default, so uatPath/tokensPath are exercised.
        await writeFile(
          join(rootDir, '.metta', 'config.yaml'),
          'project:\n  name: x\ndocs:\n  generate_on: manual\n',
        )
        const hostStore = new ArtifactStore(join(host, 'spec'))
        await hostStore.createChange('wt hosted final', 'quick', ['intent', 'implementation', 'verification'])
        await markAllComplete(store, 'wt-hosted-final', ['intent', 'implementation', 'verification'])

        // The finalizer's specDir comes from the store's per-change resolution
        // (what the CLI now does) — the worktree's spec dir, not the main one.
        const wtSpecDir = await store.specDirFor('wt-hosted-final')
        expect(wtSpecDir).toBe(join(host, 'spec'))
        const finalizer = new Finalizer(
          wtSpecDir,
          store,
          new SpecLockManager(wtSpecDir),
          passingRegistry(),
          rootDir,
        )

        const result = await finalizer.finalize('wt-hosted-final')

        // (a) finalize succeeds
        expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-wt-hosted-final$/)
        // (b) gates.yaml lands in the WORKTREE's archive dir
        const archiveDir = join(host, 'spec', 'archive', result.archiveName)
        const archivedFiles = await readdir(archiveDir)
        expect(archivedFiles).toContain('gates.yaml')
        expect(archivedFiles).toContain('.metta.yaml')
        // (c) the main checkout's spec/archive is untouched
        expect(await readdir(join(mainSpecDir, 'archive'))).toEqual([])
        const mainChanges = await readdir(join(mainSpecDir, 'changes')).catch(() => [] as string[])
        expect(mainChanges).not.toContain('wt-hosted-final')
        // (d) reported paths point into the worktree's archive dir
        expect(result.uatError).toBeUndefined()
        expect(result.tokensError).toBeUndefined()
        expect(result.uatPath).toBe(join(archiveDir, 'UAT.md'))
        expect(result.tokensPath).toBe(join(archiveDir, 'TOKENS.md'))
        expect(archivedFiles).toContain('UAT.md')
        expect(archivedFiles).toContain('TOKENS.md')
        // The change is gone from the worktree's active changes.
        const wtChanges = await readdir(join(host, 'spec', 'changes')).catch(() => [] as string[])
        expect(wtChanges).not.toContain('wt-hosted-final')
      } finally {
        await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    })
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
      await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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

  describe('UAT generation (Step 5b)', () => {
    let projectRoot: string
    let scopedSpecDir: string
    let scopedArtifactStore: ArtifactStore
    let scopedLockManager: SpecLockManager
    let scopedFinalizer: Finalizer

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), 'metta-final-uat-'))
      scopedSpecDir = join(projectRoot, 'spec')
      await mkdir(join(scopedSpecDir, 'specs'), { recursive: true })
      await mkdir(join(scopedSpecDir, 'archive'), { recursive: true })
      await mkdir(join(projectRoot, '.metta'), { recursive: true })
      scopedArtifactStore = new ArtifactStore(scopedSpecDir)
      scopedLockManager = new SpecLockManager(scopedSpecDir)
      scopedFinalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    // docs.generate_on: manual keeps DocGenerator out of these tests so Step 7
    // never interferes with the Step 5b assertions.
    async function writeConfig(extra: string = ''): Promise<void> {
      await writeFile(
        join(projectRoot, '.metta', 'config.yaml'),
        `project:\n  name: x\ndocs:\n  generate_on: manual\n${extra}`,
      )
    }

    async function createCompleteChange(description: string, name: string): Promise<void> {
      await scopedArtifactStore.createChange(description, 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, name, ['intent', 'implementation', 'verification'])
    }

    it('writes UAT.md pre-archive so the archive sweep carries it in', async () => {
      await writeConfig() // uat omitted → enabled by schema default

      await createCompleteChange('uat success test', 'uat-success-test')
      const result = await scopedFinalizer.finalize('uat-success-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-uat-success-test$/)
      expect(result.uatPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'UAT.md'))
      expect(result.uatError).toBeUndefined()

      const uatContent = await readFile(result.uatPath!, 'utf-8')
      expect(uatContent).toContain('# UAT: uat-success-test')
      expect(uatContent).toContain('## Reporting failures')

      // Nothing left behind under spec/changes/ (the move took the whole dir).
      const remaining = await readdir(join(scopedSpecDir, 'changes')).catch(() => [] as string[])
      expect(remaining).not.toContain('uat-success-test')
    })

    it('skips generation when uat.enabled is false', async () => {
      await writeConfig('uat:\n  enabled: false\n')

      await createCompleteChange('uat disabled test', 'uat-disabled-test')
      const result = await scopedFinalizer.finalize('uat-disabled-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-uat-disabled-test$/)
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toBeUndefined()

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).not.toContain('UAT.md')
    })

    it('dry-run returns uatPath null and writes no UAT.md', async () => {
      await writeConfig()

      await createCompleteChange('uat dry run test', 'uat-dry-run-test')
      const result = await scopedFinalizer.finalize('uat-dry-run-test', true)

      expect(result.archiveName).toBe('(dry-run)')
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'uat-dry-run-test'))
      expect(changeFiles).not.toContain('UAT.md')
    })

    it('incomplete-artifacts abort returns uatPath null and leaves no stray UAT.md', async () => {
      await writeConfig()

      await scopedArtifactStore.createChange('uat incomplete test', 'quick', ['intent', 'implementation'])
      await scopedArtifactStore.markArtifact('uat-incomplete-test', 'intent', 'complete')
      // 'implementation' deliberately left incomplete.

      const result = await scopedFinalizer.finalize('uat-incomplete-test')

      expect(result.incompleteArtifacts).toBeDefined()
      expect(result.archiveName).toBe('')
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'uat-incomplete-test'))
      expect(changeFiles).not.toContain('UAT.md')
    })

    it('merge-conflict abort returns uatPath null and leaves no stray UAT.md', async () => {
      await writeConfig()

      await createCompleteChange('uat conflict test', 'uat-conflict-test')
      // MODIFIED targeting a capability that does not exist → dry-run merge conflict.
      const deltaContent = `# missingcap (Delta)

## MODIFIED: Requirement: Nonexistent Behavior

The system MUST conflict on this delta.

### Scenario: Conflicted
- GIVEN a missing capability
- WHEN finalize runs
- THEN the merge conflicts
`
      await writeFile(join(scopedSpecDir, 'changes', 'uat-conflict-test', 'spec.md'), deltaContent)

      const result = await scopedFinalizer.finalize('uat-conflict-test')

      expect(result.specMerge.status).toBe('conflict')
      expect(result.archiveName).toBe('')
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'uat-conflict-test'))
      expect(changeFiles).not.toContain('UAT.md')
    })

    it('gate-failure abort returns uatPath null and leaves no stray UAT.md', async () => {
      await writeConfig()

      const failingRegistry = new GateRegistry()
      failingRegistry.register({
        name: 'tests',
        description: 'always-failing gate',
        command: 'false',
        timeout: 5000,
        required: true,
        on_failure: 'stop',
      })
      const gatedFinalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        failingRegistry,
        projectRoot,
      )

      await createCompleteChange('uat gate fail test', 'uat-gate-fail-test')
      const result = await gatedFinalizer.finalize('uat-gate-fail-test')

      expect(result.gatesPassed).toBe(false)
      expect(result.archiveName).toBe('')
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'uat-gate-fail-test'))
      expect(changeFiles).not.toContain('UAT.md')
    })

    it('degrades when template rendering fails: finalize succeeds, uatError set, no UAT.md archived', async () => {
      await writeConfig()

      vi.spyOn(TemplateEngine.prototype, 'render')
        .mockRejectedValue(new Error('synthetic template failure'))

      await createCompleteChange('uat degraded test', 'uat-degraded-test')
      const result = await scopedFinalizer.finalize('uat-degraded-test')

      // Degradation never converts success to failure.
      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-uat-degraded-test$/)
      expect(result.uatPath).toBeNull()
      expect(result.uatError).toContain('synthetic template failure')

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).not.toContain('UAT.md')
    })
  })

  describe('tokens report generation (Step 5c)', () => {
    let projectRoot: string
    let scopedSpecDir: string
    let scopedArtifactStore: ArtifactStore
    let scopedLockManager: SpecLockManager
    let scopedFinalizer: Finalizer

    beforeEach(async () => {
      projectRoot = await mkdtemp(join(tmpdir(), 'metta-final-tokens-'))
      scopedSpecDir = join(projectRoot, 'spec')
      await mkdir(join(scopedSpecDir, 'specs'), { recursive: true })
      await mkdir(join(scopedSpecDir, 'archive'), { recursive: true })
      await mkdir(join(projectRoot, '.metta'), { recursive: true })
      scopedArtifactStore = new ArtifactStore(scopedSpecDir)
      scopedLockManager = new SpecLockManager(scopedSpecDir)
      scopedFinalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        undefined,
        projectRoot,
      )
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    // docs.generate_on: manual keeps DocGenerator out of these tests so Step 7
    // never interferes with the Step 5c assertions.
    async function writeConfig(extra: string = ''): Promise<void> {
      await writeFile(
        join(projectRoot, '.metta', 'config.yaml'),
        `project:\n  name: x\ndocs:\n  generate_on: manual\n${extra}`,
      )
    }

    async function createCompleteChange(description: string, name: string): Promise<void> {
      await scopedArtifactStore.createChange(description, 'quick', ['intent', 'implementation', 'verification'])
      await markAllComplete(scopedArtifactStore, name, ['intent', 'implementation', 'verification'])
    }

    // Seed orchestrator-reported usage/timing fields directly into the
    // change's .metta.yaml, the same file the CLI records them in.
    async function seedMetadata(name: string, extra: Record<string, unknown>): Promise<void> {
      const YAML = (await import('yaml')).default
      const path = join(scopedSpecDir, 'changes', name, '.metta.yaml')
      const doc = YAML.parse(await readFile(path, 'utf-8')) as Record<string, unknown>
      Object.assign(doc, extra)
      await writeFile(path, YAML.stringify(doc))
    }

    const usageRecord = {
      task: 'implementation',
      agent: 'metta-executor',
      model: 'sonnet',
      tokens: 1234,
      timestamp: '2026-08-08T00:00:00.000Z',
    }

    /** Reject rendering of one template only; every other template renders for real. */
    function breakTemplate(templateName: string, message: string): void {
      const realRender = TemplateEngine.prototype.render
      vi.spyOn(TemplateEngine.prototype, 'render').mockImplementation(function (
        this: TemplateEngine,
        ...args: Parameters<typeof realRender>
      ) {
        if (args[0] === templateName) return Promise.reject(new Error(message))
        return realRender.apply(this, args)
      })
    }

    it('writes TOKENS.md pre-archive so the sweep carries it in beside UAT.md', async () => {
      await writeConfig() // tokens omitted → enabled by schema default

      await createCompleteChange('tokens success test', 'tokens-success-test')
      await seedMetadata('tokens-success-test', {
        token_usage: [usageRecord],
        artifact_timings: { implementation: { started: '2026-08-08T00:00:00.000Z' } },
      })
      const result = await scopedFinalizer.finalize('tokens-success-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-tokens-success-test$/)
      expect(result.tokensPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'TOKENS.md'))
      expect(result.tokensError).toBeUndefined()

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).toContain('TOKENS.md')
      expect(archived).toContain('UAT.md')

      const content = await readFile(result.tokensPath!, 'utf-8')
      expect(content).toContain('# Token usage: tokens-success-test')
      expect(content).toContain('**~1,234 tokens** across 1 record(s).')
      expect(content).toContain('No gaps found.')

      // Nothing left behind under spec/changes/ (the move took the whole dir).
      const remaining = await readdir(join(scopedSpecDir, 'changes')).catch(() => [] as string[])
      expect(remaining).not.toContain('tokens-success-test')
    })

    it('absent token_usage still produces a report listing every timed artifact as a gap', async () => {
      await writeConfig()

      await createCompleteChange('tokens empty test', 'tokens-empty-test')
      await seedMetadata('tokens-empty-test', {
        artifact_timings: {
          intent: { started: '2026-08-08T00:00:00.000Z' },
          implementation: { started: '2026-08-08T00:01:00.000Z' },
        },
      })
      const result = await scopedFinalizer.finalize('tokens-empty-test')

      expect(result.tokensPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'TOKENS.md'))
      expect(result.tokensError).toBeUndefined()

      const content = await readFile(result.tokensPath!, 'utf-8')
      expect(content).toContain('**~0 tokens** across 0 record(s).')
      expect(content).toContain('_No token usage recorded._')
      expect(content).toContain(
        '- `implementation` — run evidence with no token record; the recording hook missed this run',
      )
      expect(content).toContain(
        '- `intent` — run evidence with no token record; the recording hook missed this run',
      )
    })

    it('skips generation when tokens.enabled is false while UAT proceeds', async () => {
      await writeConfig('tokens:\n  enabled: false\n')

      await createCompleteChange('tokens disabled test', 'tokens-disabled-test')
      const result = await scopedFinalizer.finalize('tokens-disabled-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-tokens-disabled-test$/)
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()
      // UAT is independent of the tokens toggle.
      expect(result.uatPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'UAT.md'))

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).not.toContain('TOKENS.md')
      expect(archived).toContain('UAT.md')
    })

    it('returns tokensPath null and writes no TOKENS.md when constructed without a projectRoot', async () => {
      await artifactStore.createChange('tokens no root', 'quick', ['intent'])
      await markAllComplete(artifactStore, 'tokens-no-root', ['intent'])

      const result = await finalizer.finalize('tokens-no-root')

      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()
      const archived = await readdir(join(specDir, 'archive', result.archiveName))
      expect(archived).not.toContain('TOKENS.md')
    })

    it('degrades when the tokens template fails: finalize succeeds, tokensError set, UAT unaffected', async () => {
      await writeConfig()
      breakTemplate('tokens.md', 'synthetic tokens template failure')

      await createCompleteChange('tokens degraded test', 'tokens-degraded-test')
      const result = await scopedFinalizer.finalize('tokens-degraded-test')

      // Degradation never converts success to failure.
      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-tokens-degraded-test$/)
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toContain('synthetic tokens template failure')
      // UAT generation is independent of tokens degradation.
      expect(result.uatPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'UAT.md'))
      expect(result.uatError).toBeUndefined()

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).not.toContain('TOKENS.md')
      expect(archived).toContain('UAT.md')
    })

    it('removes a partially written TOKENS.md so it is never swept into the archive', async () => {
      await writeConfig()

      const realWrite = ArtifactStore.prototype.writeArtifact
      vi.spyOn(ArtifactStore.prototype, 'writeArtifact').mockImplementation(async function (
        this: ArtifactStore,
        ...args: Parameters<typeof realWrite>
      ) {
        if (args[1] === 'TOKENS.md') {
          await realWrite.call(this, args[0], 'TOKENS.md', '# partial')
          throw new Error('synthetic tokens write failure')
        }
        return realWrite.apply(this, args)
      })

      await createCompleteChange('tokens partial test', 'tokens-partial-test')
      const result = await scopedFinalizer.finalize('tokens-partial-test')

      expect(result.archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-tokens-partial-test$/)
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toContain('synthetic tokens write failure')

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).not.toContain('TOKENS.md')
    })

    it('UAT failure leaves tokens generation unaffected (independence both ways)', async () => {
      await writeConfig()
      breakTemplate('uat.md', 'synthetic uat template failure')

      await createCompleteChange('tokens uat degraded test', 'tokens-uat-degraded-test')
      await seedMetadata('tokens-uat-degraded-test', { token_usage: [usageRecord] })
      const result = await scopedFinalizer.finalize('tokens-uat-degraded-test')

      expect(result.uatPath).toBeNull()
      expect(result.uatError).toContain('synthetic uat template failure')
      expect(result.tokensPath).toBe(join(scopedSpecDir, 'archive', result.archiveName, 'TOKENS.md'))
      expect(result.tokensError).toBeUndefined()

      const archived = await readdir(join(scopedSpecDir, 'archive', result.archiveName))
      expect(archived).toContain('TOKENS.md')
      expect(archived).not.toContain('UAT.md')
    })

    it('dry-run returns tokensPath null and writes no TOKENS.md', async () => {
      await writeConfig()

      await createCompleteChange('tokens dry run test', 'tokens-dry-run-test')
      const result = await scopedFinalizer.finalize('tokens-dry-run-test', true)

      expect(result.archiveName).toBe('(dry-run)')
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'tokens-dry-run-test'))
      expect(changeFiles).not.toContain('TOKENS.md')
    })

    it('incomplete-artifacts abort returns tokensPath null and leaves no stray TOKENS.md', async () => {
      await writeConfig()

      await scopedArtifactStore.createChange('tokens incomplete test', 'quick', ['intent', 'implementation'])
      await scopedArtifactStore.markArtifact('tokens-incomplete-test', 'intent', 'complete')
      // 'implementation' deliberately left incomplete.

      const result = await scopedFinalizer.finalize('tokens-incomplete-test')

      expect(result.incompleteArtifacts).toBeDefined()
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'tokens-incomplete-test'))
      expect(changeFiles).not.toContain('TOKENS.md')
    })

    it('merge-conflict abort returns tokensPath null and leaves no stray TOKENS.md', async () => {
      await writeConfig()

      await createCompleteChange('tokens conflict test', 'tokens-conflict-test')
      // MODIFIED targeting a capability that does not exist → dry-run merge conflict.
      const deltaContent = `# missingcap (Delta)

## MODIFIED: Requirement: Nonexistent Behavior

The system MUST conflict on this delta.

### Scenario: Conflicted
- GIVEN a missing capability
- WHEN finalize runs
- THEN the merge conflicts
`
      await writeFile(join(scopedSpecDir, 'changes', 'tokens-conflict-test', 'spec.md'), deltaContent)

      const result = await scopedFinalizer.finalize('tokens-conflict-test')

      expect(result.specMerge.status).toBe('conflict')
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'tokens-conflict-test'))
      expect(changeFiles).not.toContain('TOKENS.md')
    })

    it('gate-failure abort returns tokensPath null and leaves no stray TOKENS.md', async () => {
      await writeConfig()

      const failingRegistry = new GateRegistry()
      failingRegistry.register({
        name: 'tests',
        description: 'always-failing gate',
        command: 'false',
        timeout: 5000,
        required: true,
        on_failure: 'stop',
      })
      const gatedFinalizer = new Finalizer(
        scopedSpecDir,
        scopedArtifactStore,
        scopedLockManager,
        failingRegistry,
        projectRoot,
      )

      await createCompleteChange('tokens gate fail test', 'tokens-gate-fail-test')
      const result = await gatedFinalizer.finalize('tokens-gate-fail-test')

      expect(result.gatesPassed).toBe(false)
      expect(result.tokensPath).toBeNull()
      expect(result.tokensError).toBeUndefined()

      const changeFiles = await readdir(join(scopedSpecDir, 'changes', 'tokens-gate-fail-test'))
      expect(changeFiles).not.toContain('TOKENS.md')
    })
  })
})
