import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { IssuesStore } from '../src/issues/issues-store.js'

describe('IssuesStore', () => {
  let tempDir: string
  let store: IssuesStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-issues-'))
    store = new IssuesStore(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('creates and retrieves an issue', async () => {
    const slug = await store.create('login form flashes', 'Hydration issue', 'minor')
    expect(slug).toBe('login-form-flashes')

    const issue = await store.show(slug)
    expect(issue.title).toBe('login form flashes')
    expect(issue.severity).toBe('minor')
    expect(issue.status).toBe('logged')
  })

  it('creates with critical severity', async () => {
    await store.create('payment fails', 'Amounts over 10k', 'critical')
    const issue = await store.show('payment-fails')
    expect(issue.severity).toBe('critical')
  })

  it('lists issues with severity', async () => {
    await store.create('issue one', 'desc', 'minor')
    await store.create('issue two', 'desc', 'major')
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list.some(i => i.severity === 'major')).toBe(true)
  })

  it('captures context', async () => {
    await store.create('test issue', 'desc', 'minor', 'during add-profiles')
    const issue = await store.show('test-issue')
    expect(issue.context).toBe('during add-profiles')
  })

  it('returns empty list when no issues', async () => {
    const list = await store.list()
    expect(list).toEqual([])
  })
})
