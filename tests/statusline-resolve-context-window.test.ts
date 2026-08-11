import { describe, it, expect } from 'vitest'
import { resolveContextWindow, resolveUsedPercent } from '../src/templates/statusline/statusline.mjs'

describe('resolveContextWindow', () => {
  it('prefers context_window.context_window_size from the stdin payload', () => {
    expect(
      resolveContextWindow({
        model: { id: 'claude-haiku-4-5' },
        context_window: { context_window_size: 1_000_000 },
      }),
    ).toBe(1_000_000)
  })

  it('ignores a non-numeric context_window_size', () => {
    expect(
      resolveContextWindow({
        model: { id: 'claude-haiku-4-5' },
        context_window: { context_window_size: 'big' },
      }),
    ).toBe(200_000)
  })

  it('ignores a zero or negative context_window_size', () => {
    expect(resolveContextWindow({ context_window: { context_window_size: 0 } })).toBe(200_000)
    expect(resolveContextWindow({ context_window: { context_window_size: -5 } })).toBe(200_000)
  })

  it('returns 1_000_000 when model.id contains [1m]', () => {
    expect(resolveContextWindow({ model: { id: 'claude-opus-4-6[1m]' } })).toBe(1_000_000)
  })

  it('returns 1_000_000 for current 1M-window model families by prefix', () => {
    for (const id of [
      'claude-fable-5',
      'claude-mythos-5',
      'claude-opus-5',
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
    ]) {
      expect(resolveContextWindow({ model: { id } })).toBe(1_000_000)
    }
  })

  it('returns 1_000_000 for a 1M-family id with a suffix', () => {
    expect(resolveContextWindow({ model: { id: 'claude-fable-5-custom' } })).toBe(1_000_000)
  })

  it('returns 200_000 for haiku model ids', () => {
    expect(resolveContextWindow({ model: { id: 'claude-haiku-4-5' } })).toBe(200_000)
  })

  it('returns 200_000 for unrecognized model ids', () => {
    expect(resolveContextWindow({ model: { id: 'some-other-model' } })).toBe(200_000)
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

describe('resolveUsedPercent', () => {
  it('returns the rounded harness-computed percentage when present', () => {
    expect(resolveUsedPercent({ context_window: { used_percentage: 58.6 } })).toBe(59)
  })

  it('returns 0 for zero usage', () => {
    expect(resolveUsedPercent({ context_window: { used_percentage: 0 } })).toBe(0)
  })

  it('returns null when the field is absent', () => {
    expect(resolveUsedPercent({})).toBeNull()
    expect(resolveUsedPercent({ context_window: {} })).toBeNull()
  })

  it('returns null for non-numeric or negative values', () => {
    expect(resolveUsedPercent({ context_window: { used_percentage: 'high' } })).toBeNull()
    expect(resolveUsedPercent({ context_window: { used_percentage: -3 } })).toBeNull()
    expect(resolveUsedPercent({ context_window: { used_percentage: NaN } })).toBeNull()
  })
})
