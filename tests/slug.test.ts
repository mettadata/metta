import { describe, expect, it } from 'vitest'
import { SLUG_RE, toSlug } from '../src/util/slug.js'

describe('toSlug', () => {
  it('lowercases and hyphenates basic input', () => {
    expect(toSlug('Hello World')).toBe('hello-world')
  })

  it('strips non-ASCII characters (em dash, smart quotes)', () => {
    expect(toSlug('Specification — card cover colors')).toBe('specification-card-cover-colors')
  })

  it('trims leading and trailing hyphens', () => {
    expect(toSlug('  hello world!  ')).toBe('hello-world')
  })

  it('truncates at the nearest word boundary below maxLen', () => {
    const result = toSlug('a-very-long-description-that-will-be-truncated', { maxLen: 30 })
    expect(result.length).toBeLessThanOrEqual(30)
    expect(result).not.toMatch(/-$/)
    // Must land at a word boundary, not mid-word. Expected: 'a-very-long-description-that' (28 chars).
    expect(result).toBe('a-very-long-description-that')
  })

  it('filters stop-words when opts.stopWords is provided', () => {
    const result = toSlug('add user profiles', { stopWords: new Set(['add']) })
    expect(result).toBe('user-profiles')
  })

  it('does NOT filter stop-words by default', () => {
    const result = toSlug('add user profiles')
    expect(result).toBe('add-user-profiles')
  })

  it('hard-truncates when no word boundary fits maxLen', () => {
    const result = toSlug('supercalifragilisticexpialidocious', { maxLen: 10 })
    expect(result).toBe('supercalif')
    expect(result.length).toBe(10)
  })

  it('throws on empty input', () => {
    expect(() => toSlug('')).toThrow(/empty slug/)
  })

  it('throws on all-non-ASCII input', () => {
    expect(() => toSlug('!!!—!!!')).toThrow(/empty slug/)
  })

  it('produces output that matches SLUG_RE at default maxLen', () => {
    expect(SLUG_RE.test(toSlug('Some Long Descriptive Title'))).toBe(true)
  })
})
