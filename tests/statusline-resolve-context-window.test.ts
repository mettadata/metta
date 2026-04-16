import { describe, it, expect } from 'vitest'
import { resolveContextWindow } from '../src/templates/statusline/statusline.mjs'

describe('resolveContextWindow', () => {
  it('returns 1_000_000 when model.id contains [1m]', () => {
    expect(resolveContextWindow({ model: { id: 'claude-opus-4-6[1m]' } })).toBe(1_000_000)
  })

  it('returns 1_000_000 when [1m] is a substring with suffix', () => {
    expect(resolveContextWindow({ model: { id: 'claude-opus-4-6[1m]-custom' } })).toBe(1_000_000)
  })

  it('returns 200_000 when model.id has no [1m]', () => {
    expect(resolveContextWindow({ model: { id: 'claude-sonnet-4-6' } })).toBe(200_000)
  })

  it('returns 200_000 when model is absent', () => {
    expect(resolveContextWindow({})).toBe(200_000)
  })

  it('returns 200_000 when model is a string (wrong type)', () => {
    expect(resolveContextWindow({ model: 'claude-sonnet-4-6' })).toBe(200_000)
  })

  it('returns 200_000 when model.id is not a string', () => {
    expect(resolveContextWindow({ model: { id: 42 } })).toBe(200_000)
  })
})
