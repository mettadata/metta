import { describe, it, expect } from 'vitest'
import { formatDuration } from '../src/util/duration.js'

describe('formatDuration', () => {
  it('returns 0s for zero input', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('clamps negative input to 0s', () => {
    expect(formatDuration(-1000)).toBe('0s')
    expect(formatDuration(-1)).toBe('0s')
  })

  it('clamps NaN / Infinity to 0s', () => {
    expect(formatDuration(Number.NaN)).toBe('0s')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe('0s')
  })

  it('renders seconds under one minute', () => {
    expect(formatDuration(1_000)).toBe('1s')
    expect(formatDuration(30_000)).toBe('30s')
    expect(formatDuration(59_000)).toBe('59s')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(1_400)).toBe('1s')
    expect(formatDuration(1_500)).toBe('2s')
    expect(formatDuration(30_999)).toBe('31s')
  })

  it('crosses the minute boundary correctly', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(61_000)).toBe('1m 1s')
    expect(formatDuration(134_000)).toBe('2m 14s')
  })

  it('renders minutes-and-seconds up to one hour', () => {
    expect(formatDuration(59 * 60 * 1000 + 59 * 1000)).toBe('59m 59s')
    expect(formatDuration(45 * 60 * 1000)).toBe('45m 0s')
  })

  it('crosses the hour boundary correctly', () => {
    expect(formatDuration(3600 * 1000)).toBe('1h 0m')
    expect(formatDuration(3660 * 1000)).toBe('1h 1m')
    expect(formatDuration(2 * 3600 * 1000 + 30 * 60 * 1000)).toBe('2h 30m')
  })

  it('handles very long durations', () => {
    expect(formatDuration(25 * 3600 * 1000)).toBe('25h 0m')
  })
})
