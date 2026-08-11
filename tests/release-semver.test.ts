import { describe, it, expect } from 'vitest'
import { SemverParseError, parseSemver, bumpVersion } from '../src/release/semver.js'

describe('parseSemver', () => {
  it('parses a simple x.y.z version', () => {
    expect(parseSemver('1.4.2')).toEqual({ major: 1, minor: 4, patch: 2 })
  })

  it('parses all-zero components', () => {
    expect(parseSemver('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('parses multi-digit components', () => {
    expect(parseSemver('10.20.300')).toEqual({ major: 10, minor: 20, patch: 300 })
  })

  const rejected: Array<[string, string]> = [
    ['leading v prefix', 'v1.2.3'],
    ['prerelease suffix', '1.2.3-rc.1'],
    ['build metadata', '1.2.3+build.5'],
    ['prerelease and build metadata', '1.2.3-alpha+001'],
    ['leading whitespace', ' 1.2.3'],
    ['trailing whitespace', '1.2.3 '],
    ['interior whitespace', '1. 2.3'],
    ['missing patch component', '1.2'],
    ['extra component', '1.2.3.4'],
    ['negative component', '1.-2.3'],
    ['non-numeric component', '1.two.3'],
    ['leading zeros', '01.2.3'],
    ['leading zeros in minor', '1.02.3'],
    ['leading zeros in patch', '1.2.03'],
    ['empty string', ''],
    ['bare word', 'latest'],
    ['trailing dot', '1.2.3.'],
  ]

  for (const [label, input] of rejected) {
    it(`rejects ${label}: ${JSON.stringify(input)}`, () => {
      expect(() => parseSemver(input)).toThrow(SemverParseError)
    })
  }

  it('names the accepted x.y.z form and the offending input in the error message', () => {
    let error: unknown
    try {
      parseSemver('v1.2.3-rc.1')
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(SemverParseError)
    const parseError = error as SemverParseError
    expect(parseError.message).toContain('x.y.z')
    expect(parseError.message).toContain('v1.2.3-rc.1')
    expect(parseError.input).toBe('v1.2.3-rc.1')
    expect(parseError.name).toBe('SemverParseError')
  })
})

describe('bumpVersion', () => {
  it('major bump increments major and zeroes minor and patch', () => {
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0')
  })

  it('minor bump increments minor and zeroes patch', () => {
    expect(bumpVersion('1.4.2', 'minor')).toBe('1.5.0')
  })

  it('patch bump increments patch only', () => {
    expect(bumpVersion('1.4.2', 'patch')).toBe('1.4.3')
  })

  it('bumps from 0.0.0 at every level', () => {
    expect(bumpVersion('0.0.0', 'major')).toBe('1.0.0')
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0')
    expect(bumpVersion('0.0.0', 'patch')).toBe('0.0.1')
  })

  it('handles multi-digit rollover-free arithmetic', () => {
    expect(bumpVersion('9.9.9', 'patch')).toBe('9.9.10')
    expect(bumpVersion('9.19.9', 'minor')).toBe('9.20.0')
    expect(bumpVersion('19.9.9', 'major')).toBe('20.0.0')
  })

  it('throws SemverParseError for an invalid current version', () => {
    expect(() => bumpVersion('v1.2.3', 'patch')).toThrow(SemverParseError)
    expect(() => bumpVersion('1.2.3-rc.1', 'minor')).toThrow(SemverParseError)
  })
})
