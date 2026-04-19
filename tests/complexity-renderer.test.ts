import { describe, it, expect } from 'vitest'
import { renderBanner, renderStatusLine } from '../src/complexity/renderer.js'
import type { ComplexityScore } from '../src/schemas/change-metadata.js'

function makeScore(
  recommended: 'trivial' | 'quick' | 'standard' | 'full',
  fileCount: number,
): ComplexityScore {
  const scoreMap = { trivial: 0, quick: 1, standard: 2, full: 3 } as const
  return {
    score: scoreMap[recommended],
    signals: { file_count: fileCount },
    recommended_workflow: recommended,
  }
}

describe('renderBanner', () => {
  it('returns empty string when score is null', () => {
    expect(renderBanner(null, 'quick')).toBe('')
  })

  it('returns empty string when score is undefined', () => {
    expect(renderBanner(undefined, 'quick')).toBe('')
  })

  it('emits agreement banner when recommended matches current', () => {
    const score = makeScore('quick', 2)
    const out = renderBanner(score, 'quick')
    expect(out).toContain('Advisory:')
    expect(out).toContain('current workflow quick matches recommendation quick')
  })

  it('emits agreement banner for standard/standard', () => {
    const score = makeScore('standard', 5)
    const out = renderBanner(score, 'standard')
    expect(out).toContain('Advisory:')
    expect(out).toContain('current workflow standard matches recommendation standard')
  })

  it('emits downscale banner when recommended is lower than current', () => {
    const score = makeScore('trivial', 1)
    const out = renderBanner(score, 'standard')
    expect(out).toContain('Advisory:')
    expect(out).toContain('current standard, scored trivial -- downscale recommended')
  })

  it('emits upscale banner when recommended is higher than current', () => {
    const score = makeScore('standard', 5)
    const out = renderBanner(score, 'quick')
    expect(out).toContain('Advisory:')
    expect(out).toContain('current quick, scored standard -- upscale recommended')
  })

  it('applies yellow ANSI color to the Advisory prefix', () => {
    const score = makeScore('quick', 2)
    const out = renderBanner(score, 'quick')
    // \x1b[33m is yellow; verify it wraps "Advisory:"
    expect(out).toContain('\x1b[33mAdvisory:\x1b[0m')
  })

  describe('tier ordering', () => {
    it('scored standard with chosen quick produces upscale (not downscale)', () => {
      const score = makeScore('standard', 5)
      const out = renderBanner(score, 'quick')
      expect(out).toContain('upscale recommended')
      expect(out).not.toContain('downscale recommended')
    })

    it('scored trivial with chosen standard produces downscale (not upscale)', () => {
      const score = makeScore('trivial', 1)
      const out = renderBanner(score, 'standard')
      expect(out).toContain('downscale recommended')
      expect(out).not.toContain('upscale recommended')
    })

    it('scored quick with chosen full produces downscale', () => {
      const score = makeScore('quick', 2)
      const out = renderBanner(score, 'full')
      expect(out).toContain('downscale recommended')
    })

    it('scored full with chosen trivial produces upscale', () => {
      const score = makeScore('full', 10)
      const out = renderBanner(score, 'trivial')
      expect(out).toContain('upscale recommended')
    })
  })
})

describe('renderStatusLine', () => {
  it('returns empty string when score is null', () => {
    expect(renderStatusLine(null)).toBe('')
  })

  it('returns empty string when score is undefined', () => {
    expect(renderStatusLine(undefined)).toBe('')
  })

  it('uses singular "file" when file_count === 1', () => {
    const score = makeScore('trivial', 1)
    const out = renderStatusLine(score)
    expect(out).toContain('Complexity:')
    expect(out).toContain('(1 file)')
    expect(out).not.toContain('(1 files)')
  })

  it('uses plural "files" when file_count > 1', () => {
    const score = makeScore('standard', 5)
    const out = renderStatusLine(score)
    expect(out).toContain('Complexity:')
    expect(out).toContain('(5 files)')
  })

  it('uses plural "files" when file_count === 0', () => {
    const score = makeScore('trivial', 0)
    const out = renderStatusLine(score)
    expect(out).toContain('(0 files)')
  })

  it('includes the trivial tier label', () => {
    const score = makeScore('trivial', 1)
    const out = renderStatusLine(score)
    expect(out).toContain('trivial')
    expect(out).toContain('recommended: trivial')
  })

  it('includes the quick tier label', () => {
    const score = makeScore('quick', 2)
    const out = renderStatusLine(score)
    expect(out).toContain('quick')
    expect(out).toContain('recommended: quick')
  })

  it('includes the standard tier label', () => {
    const score = makeScore('standard', 5)
    const out = renderStatusLine(score)
    expect(out).toContain('standard')
    expect(out).toContain('recommended: standard')
  })

  it('includes the full tier label', () => {
    const score = makeScore('full', 10)
    const out = renderStatusLine(score)
    expect(out).toContain('full')
    expect(out).toContain('recommended: full')
  })

  it('applies cyan ANSI color to the Complexity: label', () => {
    const score = makeScore('quick', 2)
    const out = renderStatusLine(score)
    // \x1b[36m is cyan; verify it wraps "Complexity:"
    expect(out).toContain('\x1b[36mComplexity:\x1b[0m')
  })
})
