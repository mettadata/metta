import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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
