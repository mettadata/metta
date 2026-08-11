import { describe, it, expect } from 'vitest'
import { computePercent, formatPercent } from '../src/templates/statusline/statusline.mjs'

describe('computePercent', () => {
  it('returns 50 for half usage', () => {
    expect(computePercent(100_000, 200_000)).toBe(50)
  })

  it('rounds to nearest integer', () => {
    expect(computePercent(100_001, 200_000)).toBe(50)
  })

  it('returns 43 for 430k of 1M', () => {
    expect(computePercent(430_000, 1_000_000)).toBe(43)
  })

  it('returns 0 when nothing used', () => {
    expect(computePercent(0, 200_000)).toBe(0)
  })

  it('returns 100 when fully used', () => {
    expect(computePercent(200_000, 200_000)).toBe(100)
  })

  it('returns >100 without clamping when over limit', () => {
    expect(computePercent(210_000, 200_000)).toBe(105)
  })
})

describe('formatPercent', () => {
  it('renders values at or below 100 as N%', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(59)).toBe('59%')
    expect(formatPercent(100)).toBe('100%')
  })

  it('renders values above 100 as the clamped overflow marker', () => {
    expect(formatPercent(101)).toBe('>100%!')
    expect(formatPercent(297)).toBe('>100%!')
  })
})
