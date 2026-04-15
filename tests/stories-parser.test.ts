import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseStories, StoriesParseError } from '../src/specs/stories-parser.js'

async function writeFixture(dir: string, content: string): Promise<string> {
  const path = join(dir, 'stories.md')
  await writeFile(path, content, 'utf8')
  return path
}

function makeStory(n: number, opts: { title?: string; omit?: string } = {}): string {
  const title = opts.title ?? `Story ${n}`
  const lines = [`## US-${n}: ${title}`, '']
  if (opts.omit !== 'asA') lines.push(`**As a** user number ${n}`, '')
  if (opts.omit !== 'iWantTo') lines.push(`**I want to** do thing ${n}`, '')
  if (opts.omit !== 'soThat') lines.push(`**So that** I get value ${n}`, '')
  if (opts.omit !== 'priority') lines.push(`**Priority:** P${((n - 1) % 3) + 1}`, '')
  if (opts.omit !== 'independentTestCriteria')
    lines.push(`**Independent Test Criteria:** can be tested in isolation ${n}`, '')
  lines.push(
    '**Acceptance Criteria:**',
    '',
    `- **Given** a user ${n} **When** they act **Then** outcome ${n} occurs`,
    '',
  )
  return lines.join('\n')
}

describe('parseStories', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stories-parser-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('parses a three-story document', async () => {
    const md = [
      '# User Stories',
      '',
      makeStory(1),
      makeStory(2),
      makeStory(3),
    ].join('\n')
    const path = await writeFixture(dir, md)
    const doc = await parseStories(path)
    expect(doc.kind).toBe('stories')
    if (doc.kind !== 'stories') throw new Error('unreachable')
    expect(doc.stories).toHaveLength(3)
    expect(doc.stories[0].id).toBe('US-1')
    expect(doc.stories[0].asA).toContain('user number 1')
    expect(doc.stories[0].acceptanceCriteria[0].given).toContain('user 1')
    expect(doc.stories[0].acceptanceCriteria[0].when).toContain('act')
    expect(doc.stories[0].acceptanceCriteria[0].then).toContain('outcome 1')
    expect(doc.stories[2].id).toBe('US-3')
  })

  it('parses a sentinel document', async () => {
    const md = [
      '# User Stories',
      '',
      '## No user stories — internal/infrastructure change',
      '',
      '**Justification:** This is an internal refactor with no user-facing behavior change.',
      '',
    ].join('\n')
    const path = await writeFixture(dir, md)
    const doc = await parseStories(path)
    expect(doc.kind).toBe('sentinel')
    if (doc.kind !== 'sentinel') throw new Error('unreachable')
    expect(doc.justification.length).toBeGreaterThan(10)
    expect(doc.justification).toContain('internal refactor')
  })

  it('throws StoriesParseError on missing required field (soThat)', async () => {
    const md = [
      '# User Stories',
      '',
      makeStory(1, { omit: 'soThat' }),
    ].join('\n')
    const path = await writeFixture(dir, md)
    await expect(parseStories(path)).rejects.toMatchObject({
      name: 'StoriesParseError',
      field: 'soThat',
      storyId: 'US-1',
    })
  })

  it('throws StoriesParseError on duplicate US-N ID', async () => {
    const md = [
      '# User Stories',
      '',
      makeStory(1),
      makeStory(1, { title: 'Duplicate' }),
    ].join('\n')
    const path = await writeFixture(dir, md)
    try {
      await parseStories(path)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StoriesParseError)
      expect((err as StoriesParseError).message).toContain('US-1')
      expect((err as StoriesParseError).storyId).toBe('US-1')
    }
  })

  it('throws StoriesParseError on non-monotonic IDs (US-1 then US-3)', async () => {
    const md = [
      '# User Stories',
      '',
      makeStory(1),
      makeStory(3),
    ].join('\n')
    const path = await writeFixture(dir, md)
    try {
      await parseStories(path)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StoriesParseError)
      const msg = (err as StoriesParseError).message
      expect(msg).toMatch(/US-2|monotonic|sequence/i)
    }
  })

  it('throws StoriesParseError on non-numeric US-X heading', async () => {
    const md = [
      '# User Stories',
      '',
      '## US-ABC: Not a number',
      '',
      '**As a** user',
      '',
      '**I want to** test',
      '',
      '**So that** it works',
      '',
      '**Priority:** P1',
      '',
      '**Independent Test Criteria:** isolated',
      '',
      '**Acceptance Criteria:**',
      '',
      '- **Given** x **When** y **Then** z',
      '',
    ].join('\n')
    const path = await writeFixture(dir, md)
    await expect(parseStories(path)).rejects.toBeInstanceOf(StoriesParseError)
  })
})
