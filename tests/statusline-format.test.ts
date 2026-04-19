import { describe, it, expect } from 'vitest'
import { formatStatusLine, pickColorForSlug } from '../src/templates/statusline/statusline.mjs'

const PALETTE = [31, 32, 33, 34, 35, 36, 91, 92]

describe('pickColorForSlug', () => {
  it('same slug yields same code on two calls', () => {
    const a = pickColorForSlug('my-change-slug')
    const b = pickColorForSlug('my-change-slug')
    expect(a).toBe(b)
  })

  it('any slug yields a code in the palette', () => {
    for (const slug of ['foo', 'bar-baz', 'x', 'a-very-long-slug-name-here']) {
      expect(PALETTE).toContain(pickColorForSlug(slug))
    }
  })

  it('empty string does not throw and returns a palette code', () => {
    const code = pickColorForSlug('')
    expect(PALETTE).toContain(code)
  })
})

describe('formatStatusLine', () => {
  it('active artifact + slug + ctxPct contains percentage and ANSI', () => {
    const result = formatStatusLine({ artifact: 'execute', slug: 'my-change', ctxPct: 43 })
    expect(result).toContain('] 43%')
    expect(result).toContain('\x1b[')
  })

  it('idle + no slug + no pct is exactly [metta: idle] with no ANSI or %', () => {
    const result = formatStatusLine({ artifact: 'idle', slug: null, ctxPct: null })
    expect(result).toBe('[metta: idle]')
    expect(result).not.toContain('\x1b')
    expect(result).not.toContain('%')
  })

  it('active artifact + slug + no pct contains ANSI but no trailing %', () => {
    const result = formatStatusLine({ artifact: 'plan', slug: 'some-slug', ctxPct: null })
    expect(result).toContain('\x1b[')
    expect(result).toContain('\x1b[0m')
    expect(result).not.toContain('%')
  })

  it('unknown artifact is not colored even with slug', () => {
    const result = formatStatusLine({ artifact: 'unknown', slug: 'some-slug', ctxPct: null })
    expect(result).toBe('[metta: unknown]')
    expect(result).not.toContain('\x1b')
  })

  it('ANSI reset appears immediately after artifact text', () => {
    const artifact = 'verify'
    const result = formatStatusLine({ artifact, slug: 'a-slug', ctxPct: 50 })
    expect(result).toContain(`${artifact}\x1b[0m`)
  })

  it('ctxPct of 0 is included and ends with ] 0%', () => {
    const result = formatStatusLine({ artifact: 'execute', slug: 'slug', ctxPct: 0 })
    expect(result).toMatch(/\] 0%$/)
  })

  it('workflow + active artifact + slug + ctxPct uses colon-compact format with ANSI', () => {
    const result = formatStatusLine({
      artifact: 'implementation',
      slug: 'my-change',
      ctxPct: 43,
      workflow: 'quick',
    })
    expect(result).toContain('[metta:quick:')
    expect(result).toMatch(/\] 43%$/)
    expect(result).toContain('\x1b[')
    expect(result).toContain('\x1b[0m')
  })

  it('workflow is ignored for idle artifact', () => {
    const result = formatStatusLine({
      artifact: 'idle',
      slug: null,
      ctxPct: null,
      workflow: 'quick',
    })
    expect(result).toBe('[metta: idle]')
  })

  it('workflow is ignored for unknown artifact', () => {
    const result = formatStatusLine({
      artifact: 'unknown',
      slug: 'some-slug',
      ctxPct: null,
      workflow: 'quick',
    })
    expect(result).toBe('[metta: unknown]')
  })

  it('empty-string workflow falls back to legacy space format', () => {
    const result = formatStatusLine({
      artifact: 'execute',
      slug: 'my-change',
      ctxPct: null,
      workflow: '',
    })
    expect(result).toContain('[metta: ')
    expect(result).not.toContain('[metta::')
  })

  it('omitted workflow falls back to legacy space format', () => {
    const result = formatStatusLine({ artifact: 'plan', slug: 'my-change', ctxPct: 10 })
    expect(result).toContain('[metta: ')
    expect(result).toMatch(/\] 10%$/)
  })
})
