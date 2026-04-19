import { describe, it, expect } from 'vitest'
import {
  tierFromFileCount,
  scoreFromIntentImpact,
  scoreFromSummaryFiles,
  isScorePresent,
} from '../src/complexity/scorer.js'
import type { ChangeMetadata } from '../src/schemas/change-metadata.js'

function baseMetadata(overrides: Partial<ChangeMetadata> = {}): ChangeMetadata {
  return {
    workflow: 'standard',
    created: '2026-04-19T00:00:00.000Z',
    status: 'active',
    current_artifact: 'intent',
    base_versions: {},
    artifacts: { intent: 'pending' },
    ...overrides,
  }
}

describe('tierFromFileCount', () => {
  it('returns trivial for n = 0', () => {
    expect(tierFromFileCount(0)).toBe('trivial')
  })

  it('returns trivial for n = 1 (upper trivial boundary)', () => {
    expect(tierFromFileCount(1)).toBe('trivial')
  })

  it('returns quick for n = 2 (lower quick boundary)', () => {
    expect(tierFromFileCount(2)).toBe('quick')
  })

  it('returns standard for n = 4 (lower standard boundary)', () => {
    expect(tierFromFileCount(4)).toBe('standard')
  })

  it('returns full for n = 8 (lower full boundary)', () => {
    expect(tierFromFileCount(8)).toBe('full')
  })

  it('returns full for larger counts like n = 15', () => {
    expect(tierFromFileCount(15)).toBe('full')
  })
})

describe('scoreFromIntentImpact', () => {
  it('returns a quick score when ## Impact lists 3 files', () => {
    const md = [
      '# Intent',
      '',
      '## Impact',
      '',
      '- `src/foo.ts`',
      '- `src/bar.ts`',
      '- `tests/foo.test.ts`',
      '',
    ].join('\n')

    const score = scoreFromIntentImpact(md)
    expect(score).not.toBeNull()
    expect(score!.signals.file_count).toBe(3)
    expect(score!.recommended_workflow).toBe('quick')
    expect(score!.score).toBe(1)
  })

  it('returns a score with file_count 0 when ## Impact heading exists but section is empty', () => {
    const md = [
      '# Intent',
      '',
      '## Impact',
      '',
      'No files listed yet.',
      '',
    ].join('\n')

    const score = scoreFromIntentImpact(md)
    expect(score).not.toBeNull()
    expect(score!.signals.file_count).toBe(0)
    expect(score!.recommended_workflow).toBe('trivial')
    expect(score!.score).toBe(0)
  })

  it('returns null when the ## Impact heading is entirely missing', () => {
    const md = [
      '# Intent',
      '',
      '## Overview',
      '',
      '- `src/foo.ts`',
      '',
    ].join('\n')

    expect(scoreFromIntentImpact(md)).toBeNull()
  })
})

describe('scoreFromSummaryFiles', () => {
  it('returns a standard score when ## Files lists 5 files', () => {
    const md = [
      '# Summary',
      '',
      '## Files',
      '',
      '- `src/a.ts`',
      '- `src/b.ts`',
      '- `src/c.ts`',
      '- `tests/a.test.ts`',
      '- `tests/b.test.ts`',
      '',
    ].join('\n')

    const score = scoreFromSummaryFiles(md)
    expect(score).not.toBeNull()
    expect(score!.signals.file_count).toBe(5)
    expect(score!.recommended_workflow).toBe('standard')
    expect(score!.score).toBe(2)
  })

  it('returns null when the ## Files heading is missing', () => {
    const md = [
      '# Summary',
      '',
      '## Notes',
      '',
      '- `src/a.ts`',
      '',
    ].join('\n')

    expect(scoreFromSummaryFiles(md)).toBeNull()
  })
})

describe('isScorePresent', () => {
  it('returns true when complexity_score is a valid ComplexityScore', () => {
    const md = baseMetadata({
      complexity_score: {
        score: 1,
        signals: { file_count: 3 },
        recommended_workflow: 'quick',
      },
    })

    expect(isScorePresent(md)).toBe(true)
  })

  it('returns false when complexity_score is undefined', () => {
    expect(isScorePresent(baseMetadata())).toBe(false)
  })
})
