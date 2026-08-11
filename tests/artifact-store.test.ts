import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

describe('ArtifactStore', () => {
  let tempDir: string
  let store: ArtifactStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-artifact-'))
    store = new ArtifactStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('createChange', () => {
    it('creates a change with metadata', async () => {
      const result = await store.createChange(
        'add user profiles',
        'standard',
        ['intent', 'spec', 'design', 'tasks', 'implementation', 'verification'],
      )

      expect(result.name).toBe('user-profiles')
      const metadata = await store.getChange('user-profiles')
      expect(metadata.workflow).toBe('standard')
      expect(metadata.status).toBe('active')
      expect(metadata.artifacts.intent).toBe('ready')
      expect(metadata.artifacts.spec).toBe('pending')
    })

    it('slugifies the description', async () => {
      const result = await store.createChange('Fix Payment Rounding!!!', 'quick', ['intent'])
      expect(result.name).toBe('fix-payment-rounding')
    })

    it('slugify caps at 60 characters instead of 30', async () => {
      const longDesc = 'fix the drag card across lists feature with multi-select and keyboard shortcuts'
      const result = await store.createChange(longDesc, 'quick', ['intent'])
      expect(result.name.length).toBeLessThanOrEqual(60)
      expect(result.name.length).toBeGreaterThan(30)
    })

    it('rejects duplicate change names', async () => {
      await store.createChange('test change', 'quick', ['intent'])
      await expect(store.createChange('test change', 'quick', ['intent'])).rejects.toThrow()
    })

    it('records base versions', async () => {
      await store.createChange('test', 'standard', ['intent'], {
        'auth/spec.md': 'sha256:abc123',
      })
      const metadata = await store.getChange('test')
      expect(metadata.base_versions['auth/spec.md']).toBe('sha256:abc123')
    })

    it('persists auto_accept_recommendation: true when autoAccept is true', async () => {
      await store.createChange('auto accept change', 'quick', ['intent'], {}, true)
      const metadata = await store.getChange('auto-accept-change')
      expect(metadata.auto_accept_recommendation).toBe(true)
    })

    it('omits auto_accept_recommendation when autoAccept is undefined', async () => {
      await store.createChange('undefined auto change', 'quick', ['intent'])
      const metadata = await store.getChange('undefined-auto-change')
      expect(metadata.auto_accept_recommendation).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(metadata, 'auto_accept_recommendation')).toBe(false)
    })

    it('omits auto_accept_recommendation when autoAccept is false', async () => {
      await store.createChange('false auto change', 'quick', ['intent'], {}, false)
      const metadata = await store.getChange('false-auto-change')
      expect(metadata.auto_accept_recommendation).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(metadata, 'auto_accept_recommendation')).toBe(false)
    })

    it('persists workflow_locked: true when workflowLocked is true', async () => {
      await store.createChange('locked change', 'standard', ['intent'], {}, undefined, true)
      const metadata = await store.getChange('locked-change')
      expect(metadata.workflow_locked).toBe(true)
    })

    it('omits workflow_locked when workflowLocked is undefined', async () => {
      await store.createChange('unlocked change', 'quick', ['intent'])
      const metadata = await store.getChange('unlocked-change')
      expect(metadata.workflow_locked).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(metadata, 'workflow_locked')).toBe(false)
    })

    it('persists both auto_accept_recommendation and workflow_locked when both set', async () => {
      await store.createChange('both flags change', 'standard', ['intent'], {}, true, true)
      const metadata = await store.getChange('both-flags-change')
      expect(metadata.auto_accept_recommendation).toBe(true)
      expect(metadata.workflow_locked).toBe(true)
    })

    it('persists stop_after when supplied', async () => {
      await store.createChange(
        'stop after change',
        'standard',
        ['intent', 'spec', 'tasks', 'implementation', 'verification'],
        {},
        false,
        false,
        'tasks',
      )
      const metadata = await store.getChange('stop-after-change')
      expect(metadata.stop_after).toBe('tasks')
    })

    it('omits stop_after when not supplied', async () => {
      await store.createChange('no stop after change', 'quick', ['intent'])
      const metadata = await store.getChange('no-stop-after-change')
      expect(metadata.stop_after).toBeUndefined()
      expect(Object.prototype.hasOwnProperty.call(metadata, 'stop_after')).toBe(false)
    })

    it('persists stop_after alongside autoAccept and workflowLocked', async () => {
      await store.createChange(
        'composed flags change',
        'standard',
        ['intent', 'spec', 'tasks', 'implementation', 'verification'],
        {},
        true,
        true,
        'spec',
      )
      const metadata = await store.getChange('composed-flags-change')
      expect(metadata.auto_accept_recommendation).toBe(true)
      expect(metadata.workflow_locked).toBe(true)
      expect(metadata.stop_after).toBe('spec')
    })
  })

  describe('listChanges', () => {
    it('lists all active changes', async () => {
      await store.createChange('change one', 'quick', ['intent'])
      await store.createChange('change two', 'standard', ['intent'])
      const changes = await store.listChanges()
      expect(changes.sort()).toEqual(['change-one', 'change-two'])
    })

    it('returns empty list when no changes exist', async () => {
      const changes = await store.listChanges()
      expect(changes).toEqual([])
    })
  })

  describe('markArtifact', () => {
    it('updates artifact status', async () => {
      await store.createChange('test', 'standard', ['intent', 'spec'])
      await store.markArtifact('test', 'intent', 'complete')
      const metadata = await store.getChange('test')
      expect(metadata.artifacts.intent).toBe('complete')
      expect(metadata.current_artifact).toBe('intent')
    })

    it('current_artifact advances when next artifact transitions to ready', async () => {
      await store.createChange('advance test', 'quick', ['intent', 'implementation', 'verification'])
      await store.markArtifact('advance-test', 'intent', 'complete')
      await store.markArtifact('advance-test', 'implementation', 'ready')
      const meta = await store.getChange('advance-test')
      expect(meta.artifacts.intent).toBe('complete')
      expect(meta.artifacts.implementation).toBe('ready')
      expect(meta.current_artifact).toBe('implementation')
    })

    it('current_artifact does not change for pending, failed, or skipped transitions', async () => {
      await store.createChange('negative test', 'quick', ['intent', 'implementation', 'verification'])
      await store.markArtifact('negative-test', 'intent', 'complete')
      const before = (await store.getChange('negative-test')).current_artifact
      await store.markArtifact('negative-test', 'implementation', 'pending')
      expect((await store.getChange('negative-test')).current_artifact).toBe(before)
      await store.markArtifact('negative-test', 'implementation', 'failed')
      expect((await store.getChange('negative-test')).current_artifact).toBe(before)
      await store.markArtifact('negative-test', 'implementation', 'skipped')
      expect((await store.getChange('negative-test')).current_artifact).toBe(before)
    })
  })

  describe('writeArtifact / readArtifact', () => {
    it('writes and reads artifact files', async () => {
      await store.createChange('test', 'quick', ['intent'])
      await store.writeArtifact('test', 'intent.md', '# Test Intent\n\nDescription here.')
      const content = await store.readArtifact('test', 'intent.md')
      expect(content).toContain('# Test Intent')
    })
  })

  describe('artifactExists', () => {
    it('returns false for non-existent artifacts', async () => {
      await store.createChange('test', 'quick', ['intent'])
      expect(await store.artifactExists('test', 'intent.md')).toBe(false)
    })

    it('returns true for existing artifacts', async () => {
      await store.createChange('test', 'quick', ['intent'])
      await store.writeArtifact('test', 'intent.md', 'content')
      expect(await store.artifactExists('test', 'intent.md')).toBe(true)
    })
  })

  describe('archive', () => {
    it('moves change to archive directory', async () => {
      await store.createChange('test', 'quick', ['intent'])
      const archiveName = await store.archive('test')
      expect(archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-test$/)

      // Original should be gone
      const changes = await store.listChanges()
      expect(changes).not.toContain('test')
    })
  })

  describe('abandon', () => {
    it('archives with abandoned status', async () => {
      await store.createChange('test', 'quick', ['intent'])
      const archiveName = await store.abandon('test')
      expect(archiveName).toMatch(/^\d{4}-\d{2}-\d{2}-test-abandoned$/)
    })
  })
})

describe('ArtifactStore worktree discovery', () => {
  let rootDir: string
  let store: ArtifactStore

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'metta-artifact-wt-'))
    store = new ArtifactStore(join(rootDir, 'spec'), {
      worktreesDir: join(rootDir, '.metta', 'worktrees'),
    })
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  // Simulate a worktree-per-change checkout: `.metta/worktrees/<name>/` with
  // its own spec/changes/<name>/ — discovery is filesystem-based, so a real
  // `git worktree add` is not required.
  async function createHostedChange(
    description: string,
  ): Promise<{ name: string; host: string; store: ArtifactStore }> {
    const name = store.deriveChangeName(description)
    const host = join(rootDir, '.metta', 'worktrees', name)
    await mkdir(join(host, 'spec'), { recursive: true })
    const hostStore = new ArtifactStore(join(host, 'spec'))
    await hostStore.createChange(description, 'standard', ['intent'])
    return { name, host, store: hostStore }
  }

  it('lists worktree-hosted changes alongside local ones', async () => {
    await store.createChange('local change', 'quick', ['intent'])
    await createHostedChange('hosted change')
    const changes = await store.listChanges()
    expect(changes.sort()).toEqual(['hosted-change', 'local-change'])
  })

  it('discoverChanges reports the hosting worktree path per change', async () => {
    await store.createChange('local change', 'quick', ['intent'])
    const { host } = await createHostedChange('hosted change')
    const { changes, warnings } = await store.discoverChanges()
    const byName = new Map(changes.map((change) => [change.name, change]))
    expect(byName.get('local-change')?.worktree).toBeUndefined()
    expect(byName.get('hosted-change')?.worktree).toBe(host)
    expect(warnings).toEqual([])
  })

  it('resolves a worktree-hosted change by name and injects the hosting worktree', async () => {
    const { host } = await createHostedChange('hosted change')
    const metadata = await store.getChange('hosted-change')
    expect(metadata.workflow).toBe('standard')
    expect(metadata.worktree).toBe(host)
  })

  it('specDirFor resolves the hosting worktree spec dir; local changes stay on the local spec dir', async () => {
    await store.createChange('local change', 'quick', ['intent'])
    const { host } = await createHostedChange('hosted change')
    expect(await store.specDirFor('local-change')).toBe(join(rootDir, 'spec'))
    expect(await store.specDirFor('hosted-change')).toBe(join(host, 'spec'))
  })

  it('routes artifact reads and writes to the hosting worktree', async () => {
    const { host } = await createHostedChange('hosted change')
    await store.writeArtifact('hosted-change', 'intent.md', '# Hosted intent')
    const onDisk = await readFile(
      join(host, 'spec', 'changes', 'hosted-change', 'intent.md'),
      'utf8',
    )
    expect(onDisk).toContain('# Hosted intent')
    expect(await store.readArtifact('hosted-change', 'intent.md')).toContain('# Hosted intent')
    expect(await store.artifactExists('hosted-change', 'intent.md')).toBe(true)
  })

  it('worktree copy wins a slug collision and a warning is surfaced', async () => {
    // Same slug in the main checkout and a worktree, with divergent workflows.
    const { host } = await createHostedChange('collision change')
    const localStore = new ArtifactStore(join(rootDir, 'spec'))
    await localStore.createChange('collision change', 'quick', ['intent'])

    const { changes, warnings } = await store.discoverChanges()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({ name: 'collision-change', worktree: host })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('collision-change')
    expect(warnings[0]).toContain(host)

    // Resolution by name returns the worktree copy (standard, not quick).
    const metadata = await store.getChange('collision-change')
    expect(metadata.workflow).toBe('standard')

    // listChanges forwards the warning to the injected onWarning sink —
    // never silently merged, and the store core performs no stderr I/O.
    const collected: string[] = []
    const sinkStore = new ArtifactStore(join(rootDir, 'spec'), {
      worktreesDir: join(rootDir, '.metta', 'worktrees'),
      onWarning: (warning) => collected.push(warning),
    })
    const names = await sinkStore.listChanges()
    expect(names).toEqual(['collision-change'])
    expect(collected.some((warning) => warning.includes('collision-change'))).toBe(true)
  })

  it('collision warning names both hosts for a worktree-vs-worktree collision', async () => {
    // The same slug hosted by two different worktree checkouts must produce a
    // warning naming BOTH hosts — not the hardcoded "main checkout" text.
    const hostA = join(rootDir, '.metta', 'worktrees', 'host-a')
    const hostB = join(rootDir, '.metta', 'worktrees', 'host-b')
    for (const host of [hostA, hostB]) {
      await mkdir(join(host, 'spec'), { recursive: true })
      await new ArtifactStore(join(host, 'spec')).createChange('dup change', 'quick', ['intent'])
    }
    const { changes, warnings } = await store.discoverChanges()
    expect(changes).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(`worktree '${hostA}'`)
    expect(warnings[0]).toContain(`worktree '${hostB}'`)
    expect(warnings[0]).not.toContain('main checkout')
  })

  it('does not persist the injected worktree host path on updateChange or markArtifact', async () => {
    const { name, host } = await createHostedChange('transient host change')
    // The runtime-derived host is visible to consumers...
    expect((await store.getChange(name)).worktree).toBe(host)
    // ...but writes must not bake the machine-specific absolute path into
    // the git-tracked .metta.yaml.
    await store.updateChange(name, { status: 'active' })
    await store.markArtifact(name, 'intent', 'complete')
    const onDisk = await readFile(join(host, 'spec', 'changes', name, '.metta.yaml'), 'utf8')
    expect(onDisk).not.toContain(host)
    expect(onDisk).not.toContain('worktree:')
    // Consumers still see the hosting worktree after the writes.
    const after = await store.getChange(name)
    expect(after.worktree).toBe(host)
    expect(after.artifacts.intent).toBe('complete')
  })

  it('preserves a worktree path that was explicitly stored at creation', async () => {
    const name = store.deriveChangeName('stored host change')
    const host = join(rootDir, '.metta', 'worktrees', name)
    await mkdir(join(host, 'spec'), { recursive: true })
    const hostStore = new ArtifactStore(join(host, 'spec'))
    await hostStore.createChange(
      'stored host change',
      'standard',
      ['intent'],
      {},
      undefined,
      undefined,
      undefined,
      host,
    )
    await store.updateChange(name, { status: 'active' })
    await store.markArtifact(name, 'intent', 'complete')
    const onDisk = await readFile(join(host, 'spec', 'changes', name, '.metta.yaml'), 'utf8')
    // Stored by propose (createChange) — writes must keep it.
    expect(onDisk).toContain(`worktree: ${host}`)
  })

  it('discovered host wins over a stale stored worktree path', async () => {
    // Simulate a repo move / cross-machine resume: the persisted `worktree`
    // value points at a path that no longer exists, but discovery finds the
    // live host. The live host must win — a stale absolute path would make
    // resolveChangeRoot silently fall back to the project root.
    const name = store.deriveChangeName('moved host change')
    const host = join(rootDir, '.metta', 'worktrees', name)
    const staleHost = join(rootDir, 'old-location', '.metta', 'worktrees', name)
    await mkdir(join(host, 'spec'), { recursive: true })
    const hostStore = new ArtifactStore(join(host, 'spec'))
    await hostStore.createChange(
      'moved host change',
      'standard',
      ['intent'],
      {},
      undefined,
      undefined,
      undefined,
      staleHost,
    )
    const metadata = await store.getChange(name)
    expect(metadata.worktree).toBe(host)
  })

  it('uses the stored worktree value when discovery finds nothing', async () => {
    // Change lives in the local spec dir with a persisted worktree value but
    // no discoverable worktree host — the stored value is all we have.
    const storedHost = join(rootDir, 'elsewhere', 'worktrees', 'stored-only-change')
    await store.createChange(
      'stored only change',
      'standard',
      ['intent'],
      {},
      undefined,
      undefined,
      undefined,
      storedHost,
    )
    const metadata = await store.getChange('stored-only-change')
    expect(metadata.worktree).toBe(storedHost)
  })

  it('round-tripping the injected host over a stale stored value never persists it', async () => {
    // Stored worktree is stale; getChange injects the discovered host. A
    // caller that round-trips the full getChange() result into updateChange
    // must not overwrite the stored value with the machine-specific injected
    // host — the stored value is restored on write.
    const name = store.deriveChangeName('roundtrip host change')
    const host = join(rootDir, '.metta', 'worktrees', name)
    const staleHost = join(rootDir, 'old-location', '.metta', 'worktrees', name)
    await mkdir(join(host, 'spec'), { recursive: true })
    const hostStore = new ArtifactStore(join(host, 'spec'))
    await hostStore.createChange(
      'roundtrip host change',
      'standard',
      ['intent'],
      {},
      undefined,
      undefined,
      undefined,
      staleHost,
    )
    const injected = await store.getChange(name)
    expect(injected.worktree).toBe(host)
    await store.updateChange(name, injected)
    const onDisk = await readFile(join(host, 'spec', 'changes', name, '.metta.yaml'), 'utf8')
    expect(onDisk).toContain(`worktree: ${staleHost}`)
    expect(onDisk).not.toContain(`worktree: ${host}\n`)
    // Consumers still see the live discovered host after the write.
    expect((await store.getChange(name)).worktree).toBe(host)
  })

  it('createChange rejects a slug already hosted in a worktree', async () => {
    await createHostedChange('taken change')
    await expect(store.createChange('taken change', 'quick', ['intent'])).rejects.toThrow(
      /already exists/,
    )
  })

  it('markArtifact writes to the hosting worktree copy', async () => {
    const { store: hostStore } = await createHostedChange('mutating change')
    await store.markArtifact('mutating-change', 'intent', 'complete')
    const metadata = await hostStore.getChange('mutating-change')
    expect(metadata.artifacts.intent).toBe('complete')
  })

  it('ignores worktrees when constructed without a worktreesDir', async () => {
    await createHostedChange('hidden change')
    const plainStore = new ArtifactStore(join(rootDir, 'spec'))
    expect(await plainStore.listChanges()).toEqual([])
  })
})
