import { describe, expect, it } from 'vitest'
import type { StoriesDocument, Story } from '../src/schemas/story.js'
import { detectDrift, validateFulfillsRefs } from '../src/stories/story-validator.js'

function makeStory(id: string): Story {
  return {
    id,
    title: `Title ${id}`,
    asA: 'user',
    iWantTo: 'do a thing',
    soThat: 'I get value',
    priority: 'P1',
    independentTestCriteria: 'can be tested in isolation',
    acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
  }
}

const storiesDoc: StoriesDocument = {
  kind: 'stories',
  stories: [makeStory('US-1'), makeStory('US-2'), makeStory('US-3')],
}

const sentinelDoc: StoriesDocument = {
  kind: 'sentinel',
  justification: 'internal infrastructure change with no user-facing value',
}

describe('validateFulfillsRefs', () => {
  it('returns empty array when all refs are valid', () => {
    expect(validateFulfillsRefs(['US-1', 'US-2'], storiesDoc)).toEqual([])
  })

  it('returns broken_fulfills error for a non-existent reference', () => {
    const issues = validateFulfillsRefs(['US-99'], storiesDoc)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('broken_fulfills')
    expect(issues[0]?.severity).toBe('error')
    expect(issues[0]?.fulfillsRef).toBe('US-99')
  })

  it('returns all broken refs when multiple do not resolve', () => {
    const issues = validateFulfillsRefs(['US-1', 'US-42', 'US-2', 'US-99'], storiesDoc)
    expect(issues).toHaveLength(2)
    const refs = issues.map((i) => i.fulfillsRef).sort()
    expect(refs).toEqual(['US-42', 'US-99'])
    for (const issue of issues) {
      expect(issue.kind).toBe('broken_fulfills')
      expect(issue.severity).toBe('error')
    }
  })

  it('treats any Fulfills ref as broken against a sentinel document', () => {
    const issues = validateFulfillsRefs(['US-1', 'US-2'], sentinelDoc)
    expect(issues).toHaveLength(2)
    for (const issue of issues) {
      expect(issue.kind).toBe('broken_fulfills')
      expect(issue.severity).toBe('error')
      expect(issue.message).toMatch(/sentinel/)
    }
  })
})

describe('detectDrift', () => {
  it('returns a drift warning when stories.md is newer than spec.md', () => {
    const issue = detectDrift(2000, 1000)
    expect(issue).not.toBeNull()
    expect(issue?.kind).toBe('drift')
    expect(issue?.severity).toBe('warning')
  })

  it('returns null when spec.md is newer than stories.md', () => {
    expect(detectDrift(1000, 2000)).toBeNull()
  })

  it('returns null when mtimes are equal', () => {
    expect(detectDrift(1000, 1000)).toBeNull()
  })
})
