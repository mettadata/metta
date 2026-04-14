import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BacklogStore } from '../src/backlog/backlog-store.js'

describe('BacklogStore', () => {
  let tempDir: string
  let store: BacklogStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-backlog-'))
    store = new BacklogStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('adds and retrieves a backlog item', async () => {
    const slug = await store.add('dark mode', 'Implement dark mode', 'idea/dark-mode', 'medium')
    expect(slug).toBe('dark-mode')

    const item = await store.show(slug)
    expect(item.title).toBe('dark mode')
    expect(item.status).toBe('backlog')
    expect(item.priority).toBe('medium')
    expect(item.source).toBe('idea/dark-mode')
  })

  it('lists backlog items', async () => {
    await store.add('item one', 'desc', undefined, 'high')
    await store.add('item two', 'desc', undefined, 'low')
    const list = await store.list()
    expect(list).toHaveLength(2)
  })

  it('removes a backlog item', async () => {
    await store.add('to remove', 'desc')
    expect(await store.exists('to-remove')).toBe(true)
    await store.remove('to-remove')
    expect(await store.exists('to-remove')).toBe(false)
  })

  it('returns empty list when no items', async () => {
    const list = await store.list()
    expect(list).toEqual([])
  })

  describe('archive()', () => {
    it('copies to spec/backlog/done/<slug>.md preserving content', async () => {
      await store.add('some item', 'My description', 'idea/some-item', 'high')
      const originalContent = await readFile(join(tempDir, 'backlog', 'some-item.md'), 'utf8')
      await store.archive('some-item')
      const archivedContent = await readFile(join(tempDir, 'backlog', 'done', 'some-item.md'), 'utf8')
      expect(archivedContent).toBe(originalContent)
    })

    it('with changeName appends Shipped-in metadata', async () => {
      await store.add('some item', 'desc')
      await store.archive('some-item', 'my-change')
      const archived = await readFile(join(tempDir, 'backlog', 'done', 'some-item.md'), 'utf8')
      expect(archived).toContain('**Shipped-in**: my-change')
    })

    it('throws when slug does not exist', async () => {
      await expect(store.archive('ghost-item')).rejects.toThrow(/Backlog item 'ghost-item' not found/)
      await expect(stat(join(tempDir, 'backlog', 'done', 'ghost-item.md'))).rejects.toThrow()
    })

    it('rejects hostile slug', async () => {
      await expect(store.archive('../../../etc/passwd')).rejects.toThrow(/Invalid backlog slug/)
    })

    it('rejects hostile changeName', async () => {
      await store.add('valid item', 'desc')
      await expect(store.archive('valid-item', '../../hostile')).rejects.toThrow(
        /Invalid backlog slug '\.\.\/\.\.\/hostile'/,
      )
      await expect(stat(join(tempDir, 'backlog', 'done', 'valid-item.md'))).rejects.toThrow()
    })

    it('rejects metachar input like item;rm -rf', async () => {
      await expect(store.archive('item;rm -rf')).rejects.toThrow(/Invalid backlog slug/)
    })
  })

  describe('assertSafeSlug guards', () => {
    it('remove rejects hostile slug', async () => {
      await expect(store.remove('../escape')).rejects.toThrow(/Invalid backlog slug/)
    })

    it('show rejects hostile slug', async () => {
      await expect(store.show('../../secret')).rejects.toThrow(/Invalid backlog slug '\.\.\/\.\.\/secret'/)
    })

    it('exists rejects hostile slug', async () => {
      await expect(store.exists('../etc/hosts')).rejects.toThrow(/Invalid backlog slug/)
    })
  })
})
