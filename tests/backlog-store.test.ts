import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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
})
