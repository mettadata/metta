import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
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

  it('archive moves content to resolved directory preserving original file', async () => {
    const slug = await store.create('flaky test', 'fails randomly', 'minor')
    const originalPath = join(tempDir, 'issues', `${slug}.md`)
    const resolvedPath = join(tempDir, 'issues', 'resolved', `${slug}.md`)
    const originalContent = await readFile(originalPath, 'utf-8')

    await store.archive(slug)

    const resolvedContent = await readFile(resolvedPath, 'utf-8')
    expect(resolvedContent).toBe(originalContent)
    // original preserved (remove() handles deletion)
    await expect(stat(originalPath)).resolves.toBeDefined()
  })

  it('archive throws when slug does not exist', async () => {
    await expect(store.archive('nonexistent-slug')).rejects.toThrow(
      /Issue 'nonexistent-slug' not found/,
    )
  })

  it('archive is idempotent when resolved copy already exists', async () => {
    const slug = await store.create('dup issue', 'desc', 'major')
    await store.archive(slug)
    await expect(store.archive(slug)).resolves.toBeUndefined()

    const resolvedPath = join(tempDir, 'issues', 'resolved', `${slug}.md`)
    const content = await readFile(resolvedPath, 'utf-8')
    expect(content).toContain('dup issue')
  })

  it('remove deletes the source issue file', async () => {
    const slug = await store.create('removable', 'desc', 'minor')
    const sourcePath = join(tempDir, 'issues', `${slug}.md`)
    await expect(stat(sourcePath)).resolves.toBeDefined()

    await store.remove(slug)

    await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('remove throws ENOENT when source file is missing', async () => {
    await expect(store.remove('never-existed')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects path-traversal slugs on archive/remove/show/exists', async () => {
    const bad = ['../escape', '..\\escape', '/abs/path', 'a/b', 'Foo', '']
    for (const slug of bad) {
      await expect(store.archive(slug)).rejects.toThrow(/Invalid issue slug/)
      await expect(store.remove(slug)).rejects.toThrow(/Invalid issue slug/)
      await expect(store.show(slug)).rejects.toThrow(/Invalid issue slug/)
      await expect(store.exists(slug)).rejects.toThrow(/Invalid issue slug/)
    }
  })
})
