import { describe, it, expect } from 'vitest'
import {
  PrioritySchema,
  StorySchema,
  StoriesDocumentSchema,
} from '../src/schemas/story.js'

const validStory = {
  id: 'US-1',
  title: 'Author writes a story',
  asA: 'product author',
  iWantTo: 'capture a user story',
  soThat: 'the team understands the value',
  priority: 'P1' as const,
  independentTestCriteria: 'The story can be verified without any other story',
  acceptanceCriteria: [
    { given: 'an intent', when: 'I author a story', then: 'it is saved' },
  ],
}

const secondStory = {
  ...validStory,
  id: 'US-2',
  title: 'Author edits a story',
}

describe('PrioritySchema', () => {
  it('accepts P1, P2, P3', () => {
    expect(PrioritySchema.parse('P1')).toBe('P1')
    expect(PrioritySchema.parse('P2')).toBe('P2')
    expect(PrioritySchema.parse('P3')).toBe('P3')
  })

  it('rejects unknown priority', () => {
    expect(() => PrioritySchema.parse('P4')).toThrow()
  })
})

describe('StorySchema', () => {
  it('accepts a well-formed story', () => {
    expect(() => StorySchema.parse(validStory)).not.toThrow()
  })

  it('rejects an invalid US ID format', () => {
    const bad = { ...validStory, id: 'us-1' }
    const result = StorySchema.safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('id'))).toBe(true)
    }
  })

  it('rejects a missing required field (soThat)', () => {
    const { soThat: _omitted, ...rest } = validStory
    const result = StorySchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('soThat'))).toBe(true)
    }
  })

  it('rejects invalid priority enum value', () => {
    const bad = { ...validStory, priority: 'P4' }
    expect(() => StorySchema.parse(bad)).toThrow()
  })

  it('rejects an empty acceptanceCriteria array', () => {
    const bad = { ...validStory, acceptanceCriteria: [] }
    const result = StorySchema.safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('acceptanceCriteria')),
      ).toBe(true)
    }
  })
})

describe('StoriesDocumentSchema', () => {
  it('accepts a valid two-story document', () => {
    const doc = { kind: 'stories' as const, stories: [validStory, secondStory] }
    const parsed = StoriesDocumentSchema.parse(doc)
    expect(parsed.kind).toBe('stories')
    if (parsed.kind === 'stories') {
      expect(parsed.stories).toHaveLength(2)
    }
  })

  it('rejects an empty stories array when kind is "stories"', () => {
    const doc = { kind: 'stories', stories: [] }
    const result = StoriesDocumentSchema.safeParse(doc)
    expect(result.success).toBe(false)
  })

  it('accepts a valid sentinel document with sufficient justification', () => {
    const doc = {
      kind: 'sentinel' as const,
      justification: 'Internal refactor with no user-facing surface.',
    }
    const parsed = StoriesDocumentSchema.parse(doc)
    expect(parsed.kind).toBe('sentinel')
    if (parsed.kind === 'sentinel') {
      expect(parsed.justification.length).toBeGreaterThanOrEqual(10)
    }
  })

  it('rejects a sentinel with justification shorter than 10 characters', () => {
    const doc = { kind: 'sentinel', justification: 'too short' }
    const result = StoriesDocumentSchema.safeParse(doc)
    expect(result.success).toBe(false)
  })

  it('rejects a document without the "kind" discriminator', () => {
    const doc = { stories: [validStory] }
    const result = StoriesDocumentSchema.safeParse(doc)
    expect(result.success).toBe(false)
  })
})
