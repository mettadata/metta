import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    await rm(tempDir, { recursive: true, force: true })
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
    await rm(rootDir, { recursive: true, force: true })
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

    // listChanges surfaces the warning on stderr — never silently merged.
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const names = await store.listChanges()
      expect(names).toEqual(['collision-change'])
      expect(
        spy.mock.calls.some((call) => String(call[0]).includes('collision-change')),
      ).toBe(true)
    } finally {
      spy.mockRestore()
    }
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
