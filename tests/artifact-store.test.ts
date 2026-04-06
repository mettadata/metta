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
