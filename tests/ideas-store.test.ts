import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IdeasStore } from '../src/ideas/ideas-store.js'

describe('IdeasStore', () => {
  let tempDir: string
  let store: IdeasStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-ideas-'))
    store = new IdeasStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates and retrieves an idea', async () => {
    const slug = await store.create('dark mode toggle', 'Should respect system preference')
    expect(slug).toBe('dark-mode-toggle')

    const idea = await store.show(slug)
    expect(idea.title).toBe('dark mode toggle')
    expect(idea.status).toBe('idea')
  })

  it('lists ideas', async () => {
    await store.create('idea one', 'desc one')
    await store.create('idea two', 'desc two')
    const list = await store.list()
    expect(list).toHaveLength(2)
  })

  it('returns empty list when no ideas', async () => {
    const list = await store.list()
    expect(list).toEqual([])
  })

  it('captures context', async () => {
    await store.create('test idea', 'desc', 'add-user-profiles')
    const idea = await store.show('test-idea')
    expect(idea.captured_during).toBe('add-user-profiles')
  })

  it('checks existence', async () => {
    expect(await store.exists('nope')).toBe(false)
    await store.create('test', 'desc')
    expect(await store.exists('test')).toBe(true)
  })
})
