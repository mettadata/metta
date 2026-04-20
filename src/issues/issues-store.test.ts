import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IssuesStore } from './issues-store.js'

describe('IssuesStore parseIssue body tolerance', () => {
  let tmpDir: string
  let store: IssuesStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-issues-'))
    store = new IssuesStore(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('round-trips a freeform body with no headings', async () => {
    const description = 'A plain paragraph with no headings.'
    const slug = await store.create('freeform title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.description).toBe(description)
  })

  it('round-trips a structured H2 body without leaking headings into the title', async () => {
    const description =
      '## Symptom\nfoo fails\n\n## Root Cause Analysis\nbar is broken\n\n### Evidence\nsrc/foo.ts:42 — confirms failure\n\n## Candidate Solutions\n1. Fix bar. Tradeoff: risky.'
    const slug = await store.create('structured title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.title).toBe('structured title')
    expect(issue.description).toContain('## Symptom')
    expect(issue.description).toContain('## Root Cause Analysis')
    expect(issue.description).toContain('## Candidate Solutions')
    expect(issue.title).not.toContain('##')
  })

  it('keeps metadata boundaries intact when the body starts with an H2', async () => {
    const description = '## Symptom\nsome symptom text here'
    const slug = await store.create('metadata boundary title', description, 'minor')

    const issue = await store.show(slug)

    expect(issue.severity).toBe('minor')
    expect(issue.description.startsWith('## Symptom')).toBe(true)
    expect(issue.severity).not.toContain('##')
  })
})
