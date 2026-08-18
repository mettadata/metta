import { describe, it, expect } from 'vitest'
import { escapeJsonControls } from '../src/util/escape-json-controls.js'

describe('escapeJsonControls', () => {
  it('leaves U+007E (upper printable-ASCII boundary) unchanged', () => {
    expect(escapeJsonControls('tilde ~ end')).toBe('tilde ~ end')
  })

  it('escapes U+007F (DEL, lower range boundary)', () => {
    expect(escapeJsonControls('a\x7fb')).toBe('a\\u007fb')
  })

  it('escapes U+009F (upper range boundary)', () => {
    expect(escapeJsonControls('a\x9fb')).toBe('a\\u009fb')
  })

  it('leaves U+00A0 (first code unit above the range) unchanged', () => {
    expect(escapeJsonControls('a\u00a0b')).toBe('a\u00a0b')
  })

  it('escapes U+009B (raw 8-bit CSI) with lowercase hex', () => {
    expect(escapeJsonControls('a\x9bb')).toBe('a\\u009bb')
  })

  it('escapes every code unit in the full U+007F-U+009F range', () => {
    for (let code = 0x7f; code <= 0x9f; code++) {
      const input = String.fromCharCode(code)
      const expected = '\\u' + code.toString(16).padStart(4, '0')
      expect(escapeJsonControls(input)).toBe(expected)
    }
  })

  it('passes ordinary ASCII through unchanged', () => {
    const input = 'plain text 123 !"#$%&\'()*+,-./:;<=>?@[]^_`{|}'
    expect(escapeJsonControls(input)).toBe(input)
  })

  it('passes multi-byte UTF-8 (emoji, CJK, accents) through unchanged', () => {
    const input = 'café naïve 日本語 中文字 emoji 🎉👍 §±°µ'
    expect(escapeJsonControls(input)).toBe(input)
  })

  it('passes U+2028/U+2029 line separators through unchanged', () => {
    const input = 'a\u2028b\u2029c'
    expect(escapeJsonControls(input)).toBe(input)
  })

  it('leaves pre-existing backslash-uXXXX escape text intact', () => {
    const input = '"already \\u009b escaped \\u007f text"'
    expect(escapeJsonControls(input)).toBe(input)
  })

  it('leaves structural JSON characters intact', () => {
    const input = '{"key": ["value", 1, true, null], "nested": {"a": "b"}}'
    expect(escapeJsonControls(input)).toBe(input)
  })

  it('returns the empty string unchanged', () => {
    expect(escapeJsonControls('')).toBe('')
  })

  it('is idempotent on a hostile mixed input', () => {
    const hostile = '{"t\x9bitle": "del\x7f \x80mid\x9f end 🎉 \\u0041"}'
    const once = escapeJsonControls(hostile)
    expect(escapeJsonControls(once)).toBe(once)
    expect(once).toBe('{"t\\u009bitle": "del\\u007f \\u0080mid\\u009f end 🎉 \\u0041"}')
  })

  it('preserves parsed values when applied to JSON.stringify output with C1-laced keys and values', () => {
    const value = {
      ['key\x9bcsi']: 'value with DEL \x7f and C1 \x80\x8d\x9f',
      ['plain']: {
        ['nested\x85key']: ['arr\x9bitem', 42, true, null],
        ['unicode']: 'café 日本語 🎉 \u00a0\u2028',
      },
    }
    const serialized = JSON.stringify(value, null, 2)
    const escaped = escapeJsonControls(serialized)
    // eslint-disable-next-line no-control-regex
    expect(escaped).not.toMatch(/[\x7f-\x9f]/)
    expect(JSON.parse(escaped)).toEqual(value)
    // Byte-identical values: re-serializing the parse result of the escaped
    // text matches the original serialization exactly.
    expect(JSON.stringify(JSON.parse(escaped), null, 2)).toBe(serialized)
  })

  it('handles a ~100-200KB payload laced with the full DEL/C1 range', () => {
    const fullRange = Array.from({ length: 0x9f - 0x7f + 1 }, (_, i) => String.fromCharCode(0x7f + i)).join('')
    const entries: string[] = []
    for (let i = 0; i < 1500; i++) {
      entries.push('padding text ' + String(i) + ' ' + fullRange + ' café 🎉 more filler content here')
    }
    const serialized = JSON.stringify({ entries }, null, 2)
    expect(serialized.length).toBeGreaterThan(100_000)
    expect(serialized.length).toBeLessThan(300_000)

    const escaped = escapeJsonControls(serialized)
    // eslint-disable-next-line no-control-regex
    expect(escaped).not.toMatch(/[\x7f-\x9f]/)
    const parsed = JSON.parse(escaped) as { entries: string[] }
    expect(parsed).toEqual({ entries })
    expect(parsed.entries[0]).toContain(fullRange)
  })
})
