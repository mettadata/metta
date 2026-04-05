import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { StateStore, StateValidationError, StateLockError } from '../src/state/state-store.js'

const TestSchema = z.object({
  name: z.string(),
  value: z.number(),
}).strict()

type TestData = z.infer<typeof TestSchema>

describe('StateStore', () => {
  let tempDir: string
  let store: StateStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-test-'))
    store = new StateStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('write + read', () => {
    it('writes and reads valid data', async () => {
      const data: TestData = { name: 'test', value: 42 }
      await store.write('test.yaml', TestSchema, data)
      const result = await store.read('test.yaml', TestSchema)
      expect(result).toEqual(data)
    })

    it('creates parent directories automatically', async () => {
      const data: TestData = { name: 'nested', value: 1 }
      await store.write('deep/nested/test.yaml', TestSchema, data)
      const result = await store.read('deep/nested/test.yaml', TestSchema)
      expect(result).toEqual(data)
    })

    it('throws StateValidationError on read with invalid data', async () => {
      await store.writeRaw('bad.yaml', 'name: test\nvalue: not-a-number\n')
      await expect(store.read('bad.yaml', TestSchema)).rejects.toThrow(StateValidationError)
    })

    it('throws StateValidationError on write with invalid data', async () => {
      const badData = { name: 'test', value: 'not-a-number' } as unknown as TestData
      await expect(store.write('test.yaml', TestSchema, badData)).rejects.toThrow(StateValidationError)
    })

    it('throws StateValidationError with issues array', async () => {
      await store.writeRaw('bad.yaml', 'name: 123\nvalue: abc\n')
      try {
        await store.read('bad.yaml', TestSchema)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(StateValidationError)
        expect((err as StateValidationError).issues.length).toBeGreaterThan(0)
      }
    })

    it('rejects extra fields via .strict()', async () => {
      await store.writeRaw('strict.yaml', 'name: test\nvalue: 42\nextra: bad\n')
      await expect(store.read('strict.yaml', TestSchema)).rejects.toThrow(StateValidationError)
    })
  })

  describe('exists', () => {
    it('returns false for non-existent files', async () => {
      expect(await store.exists('nope.yaml')).toBe(false)
    })

    it('returns true for existing files', async () => {
      await store.writeRaw('yes.yaml', 'hello')
      expect(await store.exists('yes.yaml')).toBe(true)
    })
  })

  describe('delete', () => {
    it('deletes a file', async () => {
      await store.writeRaw('del.yaml', 'data')
      expect(await store.exists('del.yaml')).toBe(true)
      await store.delete('del.yaml')
      expect(await store.exists('del.yaml')).toBe(false)
    })
  })

  describe('advisory locking', () => {
    it('acquires and releases a lock', async () => {
      const release = await store.acquireLock('state.lock')
      expect(await store.exists('state.lock')).toBe(true)
      await release()
      expect(await store.exists('state.lock')).toBe(false)
    })

    it('fails to acquire a held lock within timeout', async () => {
      const release = await store.acquireLock('state.lock')
      await expect(store.acquireLock('state.lock', 300)).rejects.toThrow(StateLockError)
      await release()
    })
  })

  describe('readRaw / writeRaw', () => {
    it('reads and writes raw strings without validation', async () => {
      await store.writeRaw('raw.md', '# Hello\n\nWorld')
      const content = await store.readRaw('raw.md')
      expect(content).toBe('# Hello\n\nWorld')
    })
  })

  describe('getFullPath', () => {
    it('returns the full path', () => {
      const full = store.getFullPath('sub/file.yaml')
      expect(full).toBe(join(tempDir, 'sub/file.yaml'))
    })
  })
})
