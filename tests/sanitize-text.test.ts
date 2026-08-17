import { describe, it, expect } from 'vitest'
import { stripControlSequences, stripControlSequencesMultiline } from '../src/util/sanitize-text.js'

describe('stripControlSequences', () => {
  it('strips color CSI sequences', () => {
    expect(stripControlSequences('\x1b[31mred\x1b[0m text')).toBe('red text')
    expect(stripControlSequences('\x1b[1;38;5;196mbold\x1b[m')).toBe('bold')
  })

  it('strips cursor-movement CSI sequences', () => {
    expect(stripControlSequences('a\x1b[2Ab\x1b[10;20Hc\x1b[1Kd')).toBe('abcd')
  })

  it('strips screen-clear CSI sequences', () => {
    expect(stripControlSequences('before\x1b[2Jafter')).toBe('beforeafter')
    expect(stripControlSequences('\x1b[3J\x1b[H\x1b[2Jwiped')).toBe('wiped')
  })

  it('strips BEL-terminated OSC title-set sequences', () => {
    expect(stripControlSequences('\x1b]0;evil title\x07visible')).toBe('visible')
  })

  it('strips ST-terminated OSC title-set sequences', () => {
    expect(stripControlSequences('\x1b]2;evil title\x1b\\visible')).toBe('visible')
  })

  it('strips 8-bit-ST-terminated OSC without swallowing trailing text', () => {
    const result = stripControlSequences('\x1b]0;title\x9cvisible')
    expect(result).toBe('visible')
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
  })

  it('strips unterminated OSC without eating trailing terminated text', () => {
    expect(stripControlSequences('\x1b]0;no terminator')).toBe('')
    // A later ESC ends the unterminated body, so a following CSI still strips.
    expect(stripControlSequences('\x1b]0;dangling\x1b[31mred')).toBe('red')
  })

  it('strips OSC-8 hyperlink sequences, keeping only the link text', () => {
    const input = '\x1b]8;;https://evil.example\x07click me\x1b]8;;\x07'
    expect(stripControlSequences(input)).toBe('click me')
  })

  it('strips DCS sequences', () => {
    expect(stripControlSequences('\x1bPq#0;2;0;0;0#0~~\x1b\\after')).toBe('after')
    expect(stripControlSequences('\x1bPunterminated dcs')).toBe('')
  })

  it('strips 8-bit-ST-terminated DCS without swallowing trailing text', () => {
    const result = stripControlSequences('\x1bPq#0;2;0;0;0\x9cvisible')
    expect(result).toBe('visible')
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
  })

  it('strips SOS, PM, and APC string sequences', () => {
    expect(stripControlSequences('\x1bXsos body\x1b\\a')).toBe('a')
    expect(stripControlSequences('\x1b^pm body\x1b\\b')).toBe('b')
    expect(stripControlSequences('\x1b_apc body\x1b\\c')).toBe('c')
  })

  it('strips two-byte Fe escapes', () => {
    expect(stripControlSequences('a\x1bMb\x1bDc\x1bEd')).toBe('abcd')
  })

  it('strips raw 8-bit C1 CSI and other C1 controls', () => {
    expect(stripControlSequences('a\x9bb')).toBe('ab')
    expect(stripControlSequences('x\x90\x9d\x85y')).toBe('xy')
  })

  it('strips bare C0 controls: BEL, backspace, CR', () => {
    expect(stripControlSequences('ding\x07dong')).toBe('dingdong')
    expect(stripControlSequences('over\x08\x08write')).toBe('overwrite')
    expect(stripControlSequences('line\rreset')).toBe('linereset')
    expect(stripControlSequences('del\x7fete')).toBe('delete')
  })

  it('strips a lone trailing ESC', () => {
    expect(stripControlSequences('trailing\x1b')).toBe('trailing')
  })

  it('passes plain ASCII and Unicode >= U+00A0 through unchanged', () => {
    const input = 'plain text 123 — café naïve 日本語 emoji 🎉👍 §±°µ nbsp'
    expect(stripControlSequences(input)).toBe(input)
  })

  it('returns the empty string unchanged', () => {
    expect(stripControlSequences('')).toBe('')
  })

  it('is idempotent', () => {
    const hostile = '\x1b[31m\x1b]0;t\x07\x9btext\x1b'
    const once = stripControlSequences(hostile)
    expect(stripControlSequences(once)).toBe(once)
    expect(once).toBe('text')
  })

  it('is idempotent on 8-bit-ST-terminated sequences', () => {
    const hostile = '\x1b]0;t\x9c\x1bPdcs\x9ctext\x9c'
    const once = stripControlSequences(hostile)
    expect(stripControlSequences(once)).toBe(once)
    expect(once).toBe('text')
  })
})

describe('stripControlSequencesMultiline', () => {
  it('preserves LF line structure', () => {
    expect(stripControlSequencesMultiline('line one\nline two\n\nline four')).toBe('line one\nline two\n\nline four')
  })

  it('strips CSI sequences on every line while keeping newlines', () => {
    const input = '\x1b[31mred\x1b[0m first\n\x1b[2Jsecond\nplain third'
    expect(stripControlSequencesMultiline(input)).toBe('red first\nsecond\nplain third')
  })

  it('normalizes CRLF input to LF', () => {
    expect(stripControlSequencesMultiline('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree')
    expect(stripControlSequencesMultiline('mid\rline\r\n')).toBe('midline\n')
  })

  it('strips OSC, DCS, C1 controls, and lone ESC per line', () => {
    const input = '\x1b]0;evil\x07one\n\x1bPdcs\x1b\\two\na\x9bb\ntrailing\x1b'
    expect(stripControlSequencesMultiline(input)).toBe('one\ntwo\nab\ntrailing')
  })

  it('bounds an unterminated OSC body to its own line', () => {
    // The single-line helper would let an unterminated OSC swallow to the end
    // of the string; the multiline variant stops it at the line break.
    expect(stripControlSequencesMultiline('\x1b]0;dangling\nnext line')).toBe('\nnext line')
  })

  it('passes plain ASCII and Unicode >= U+00A0 through unchanged', () => {
    const input = 'plain — café naïve\n日本語 emoji 🎉\n§±°µ nbsp'
    expect(stripControlSequencesMultiline(input)).toBe(input)
  })

  it('returns the empty string unchanged', () => {
    expect(stripControlSequencesMultiline('')).toBe('')
  })

  it('is idempotent', () => {
    const hostile = '\x1b[31mred\x1b[0m one\r\n\x1b]0;t\x07two\n\x9bthree\x1b'
    const once = stripControlSequencesMultiline(hostile)
    expect(stripControlSequencesMultiline(once)).toBe(once)
    expect(once).toBe('red one\ntwo\nthree')
  })
})
