import { describe, it, expect } from 'vitest'
import {
  IssueFrontmatterError,
  splitFrontmatter,
  parseIssueFrontmatter,
  applyFrontmatterPatch,
} from '../src/issues/issue-frontmatter.js'

const FILE = 'spec/issues/example.md'

const LEGACY_BODY = [
  '# Gate runner swallows timeout',
  '',
  '**Captured**: 2026-08-01',
  '**Status**: logged',
  '**Severity**: major',
  '',
  'The gate runner drops the timeout error silently.',
  '',
].join('\n')

describe('splitFrontmatter', () => {
  it('returns undefined frontmatter for a legacy file (bold-label block)', () => {
    const result = splitFrontmatter(LEGACY_BODY)
    expect(result.rawFrontmatter).toBeUndefined()
    expect(result.body).toBe(LEGACY_BODY)
    expect(result.eol).toBe('\n')
  })

  it('splits a valid LF block; body is a verbatim slice after the closing fence', () => {
    const body = '# Title\n\nBody text.\n'
    const content = `---\ntype: idea\nbacklog: true\n---\n${body}`
    const result = splitFrontmatter(content)
    expect(result.rawFrontmatter).toBe('type: idea\nbacklog: true\n')
    expect(result.body).toBe(body)
    expect(result.eol).toBe('\n')
  })

  it('handles CRLF files: matching fences, eol reported, body bytes preserved', () => {
    const body = '# Title\r\n\r\nBody line.\r\n'
    const content = `---\r\ntype: idea\r\n---\r\n${body}`
    const result = splitFrontmatter(content)
    expect(result.rawFrontmatter).toBe('type: idea\r\n')
    expect(result.body).toBe(body)
    expect(result.eol).toBe('\r\n')
  })

  it('returns an empty raw block for ---\\n---\\n', () => {
    const content = '---\n---\n# Title\n'
    const result = splitFrontmatter(content)
    expect(result.rawFrontmatter).toBe('')
    expect(result.body).toBe('# Title\n')
  })

  it('ignores --- appearing mid-body (thematic break, second fence pair)', () => {
    const body = 'Intro\n\n---\n\nMore\n\n---\ntrailing: not-frontmatter\n---\n'
    const content = `---\nbacklog: true\n---\n${body}`
    expect(splitFrontmatter(content).body).toBe(body)
  })

  it('does not treat a line merely starting with --- as the closing fence', () => {
    const content = '---\ntitle: --- not a fence\n----\nmilestone: v0-6\n---\nbody\n'
    const result = splitFrontmatter(content)
    expect(result.rawFrontmatter).toBe('title: --- not a fence\n----\nmilestone: v0-6\n')
    expect(result.body).toBe('body\n')
  })

  it('throws for an opening fence with no closing fence', () => {
    expect(() => splitFrontmatter('---\ntype: idea\n# Title\n')).toThrow(/no closing '---' fence/)
  })

  it('takes the legacy path for a BOM-prefixed file (no fence at byte 0)', () => {
    const content = '﻿---\ntype: idea\n---\nbody\n'
    const result = splitFrontmatter(content)
    expect(result.rawFrontmatter).toBeUndefined()
    expect(result.body).toBe(content)
  })

  it('accepts a closing fence at end-of-file without a trailing newline', () => {
    const result = splitFrontmatter('---\nbacklog: true\n---')
    expect(result.rawFrontmatter).toBe('backlog: true\n')
    expect(result.body).toBe('')
  })
})

describe('parseIssueFrontmatter', () => {
  it('returns undefined frontmatter and the full content for legacy files', () => {
    const result = parseIssueFrontmatter(LEGACY_BODY, FILE)
    expect(result.frontmatter).toBeUndefined()
    expect(result.body).toBe(LEGACY_BODY)
  })

  it('parses a valid block and applies defaults', () => {
    const content = '---\nbacklog: true\n---\n# Title\n'
    const result = parseIssueFrontmatter(content, FILE)
    expect(result.frontmatter).toEqual({ type: 'issue', backlog: true })
    expect(result.body).toBe('# Title\n')
  })

  it('parses all fields', () => {
    const content = '---\ntype: idea\nbacklog: true\npriority: high\nmilestone: v0-6\norder: 2\n---\nbody\n'
    expect(parseIssueFrontmatter(content, FILE).frontmatter).toEqual({
      type: 'idea',
      backlog: true,
      priority: 'high',
      milestone: 'v0-6',
      order: 2,
    })
  })

  it('coerces an empty block to all defaults', () => {
    const result = parseIssueFrontmatter('---\n---\n# Title\n', FILE)
    expect(result.frontmatter).toEqual({ type: 'issue', backlog: false })
  })

  it('parses CRLF frontmatter', () => {
    const content = '---\r\ntype: idea\r\nbacklog: true\r\n---\r\nbody\r\n'
    const result = parseIssueFrontmatter(content, FILE)
    expect(result.frontmatter).toEqual({ type: 'idea', backlog: true })
    expect(result.body).toBe('body\r\n')
  })

  it('throws IssueFrontmatterError with the file path for an unclosed fence', () => {
    let caught: unknown
    try {
      parseIssueFrontmatter('---\ntype: idea\nbody without closing fence\n', FILE)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IssueFrontmatterError)
    expect((caught as IssueFrontmatterError).filePath).toBe(FILE)
    expect((caught as IssueFrontmatterError).message).toMatch(/no closing '---' fence/)
  })

  it('throws for non-map YAML (list)', () => {
    expect(() => parseIssueFrontmatter('---\n- a\n- b\n---\nbody\n', FILE))
      .toThrow(/frontmatter must be a YAML mapping/)
  })

  it('throws for non-map YAML (scalar)', () => {
    expect(() => parseIssueFrontmatter('---\njust a string\n---\nbody\n', FILE))
      .toThrow(/frontmatter must be a YAML mapping/)
  })

  it('wraps YAML syntax errors with the file path and cause', () => {
    let caught: unknown
    try {
      parseIssueFrontmatter('---\ntype: [unclosed\n---\nbody\n', FILE)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IssueFrontmatterError)
    expect((caught as IssueFrontmatterError).filePath).toBe(FILE)
    expect((caught as IssueFrontmatterError).message).toMatch(/invalid YAML in frontmatter/)
    expect((caught as IssueFrontmatterError).cause).toBeDefined()
  })

  it('rejects unknown keys via strict Zod', () => {
    expect(() => parseIssueFrontmatter('---\nassignee: alice\n---\nbody\n', FILE))
      .toThrow(/Unrecognized key\(s\) in object: 'assignee'/)
  })

  it('renders enum errors naming the field, received value, and allowed values', () => {
    let caught: unknown
    try {
      parseIssueFrontmatter('---\npriority: urgent\n---\nbody\n', FILE)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IssueFrontmatterError)
    const message = (caught as IssueFrontmatterError).message
    expect(message).toContain('priority')
    expect(message).toContain("'urgent'")
    expect(message).toContain("'high' | 'medium' | 'low'")
  })

  it('applies partial-frontmatter defaults: backlog only → type defaults to issue', () => {
    const result = parseIssueFrontmatter('---\nbacklog: true\n---\nbody\n', FILE)
    expect(result.frontmatter?.type).toBe('issue')
    expect(result.frontmatter?.backlog).toBe(true)
  })

  it('rejects a milestone value that is not a slug', () => {
    expect(() => parseIssueFrontmatter('---\nmilestone: Not_A_Slug\n---\nbody\n', FILE))
      .toThrow(IssueFrontmatterError)
  })
})

describe('applyFrontmatterPatch', () => {
  it('prepends a canonical-order block to a legacy file, body byte-identical', () => {
    const output = applyFrontmatterPatch(
      LEGACY_BODY,
      { backlog: true, type: 'idea', order: 1, priority: 'high' },
      FILE,
    )
    expect(output).toBe(`---\ntype: idea\nbacklog: true\npriority: high\norder: 1\n---\n${LEGACY_BODY}`)
    // Round-trip: the body comes back as the exact original bytes.
    expect(splitFrontmatter(output).body).toBe(LEGACY_BODY)
  })

  it('omits absent fields from a newly minted block', () => {
    const output = applyFrontmatterPatch('# Title\n', { backlog: true }, FILE)
    expect(output).toBe('---\nbacklog: true\n---\n# Title\n')
  })

  it('mutates only the patched key in an existing block, preserving value text, quoting, and order', () => {
    const content = '---\npriority: low\ntype: idea\nmilestone: "v0-6"\nbacklog: false\n---\n# Title\n'
    const output = applyFrontmatterPatch(content, { backlog: true }, FILE)
    expect(output).toBe('---\npriority: low\ntype: idea\nmilestone: "v0-6"\nbacklog: true\n---\n# Title\n')
  })

  it('appends a new key after existing keys', () => {
    const content = '---\ntype: idea\nbacklog: true\n---\nbody\n'
    const output = applyFrontmatterPatch(content, { order: 3 }, FILE)
    expect(output).toBe('---\ntype: idea\nbacklog: true\norder: 3\n---\nbody\n')
  })

  it('byte-preserves a tricky body across a patch (mid-body fences, no trailing newline)', () => {
    const body = 'Intro\n\n---\n\n```\n---\ncode fence content\n---\n```\nlast line without newline'
    const content = `---\nbacklog: false\n---\n${body}`
    const output = applyFrontmatterPatch(content, { backlog: true, priority: 'medium' }, FILE)
    expect(splitFrontmatter(output).body).toBe(body)
    expect(output.endsWith('last line without newline')).toBe(true)
  })

  it('preserves a body with no trailing newline when minting a new block', () => {
    const content = '# Title\nno trailing newline'
    const output = applyFrontmatterPatch(content, { backlog: true }, FILE)
    expect(output).toBe('---\nbacklog: true\n---\n# Title\nno trailing newline')
  })

  it('re-fences CRLF files with CRLF and preserves the CRLF body verbatim', () => {
    const body = '# Title\r\n\r\nBody.\r\n'
    const content = `---\r\ntype: idea\r\nbacklog: false\r\n---\r\n${body}`
    const output = applyFrontmatterPatch(content, { backlog: true }, FILE)
    expect(output).toBe(`---\r\ntype: idea\r\nbacklog: true\r\n---\r\n${body}`)
  })

  it('is idempotent: applying the same patch to its own output is identity', () => {
    const patch = { backlog: true, priority: 'high' as const }
    const first = applyFrontmatterPatch(LEGACY_BODY, patch, FILE)
    const second = applyFrontmatterPatch(first, patch, FILE)
    expect(second).toBe(first)
  })

  it('is idempotent on an existing hand-written block', () => {
    const content = '---\npriority: low\ntype: idea\nbacklog: false\n---\nbody\n'
    const patch = { backlog: true }
    const first = applyFrontmatterPatch(content, patch, FILE)
    const second = applyFrontmatterPatch(first, patch, FILE)
    expect(second).toBe(first)
  })

  it('returns the input unchanged for a patch with no defined keys', () => {
    expect(applyFrontmatterPatch(LEGACY_BODY, {}, FILE)).toBe(LEGACY_BODY)
    const withBlock = '---\nbacklog: true\n---\nbody\n'
    expect(applyFrontmatterPatch(withBlock, { priority: undefined }, FILE)).toBe(withBlock)
  })

  it('mutates an empty block in place (doc.set creates the map)', () => {
    const output = applyFrontmatterPatch('---\n---\n# Title\n', { backlog: true }, FILE)
    expect(output).toBe('---\nbacklog: true\n---\n# Title\n')
  })

  it('validates the result before returning: invalid patch value throws, nothing returned', () => {
    expect(() => applyFrontmatterPatch(LEGACY_BODY, { milestone: 'Not_A_Slug' }, FILE))
      .toThrow(IssueFrontmatterError)
  })

  it('fails loudly when the existing block is already invalid (unknown key)', () => {
    const content = '---\nassignee: alice\n---\nbody\n'
    expect(() => applyFrontmatterPatch(content, { backlog: true }, FILE))
      .toThrow(/Unrecognized key\(s\) in object: 'assignee'/)
  })

  it('fails loudly when the existing block is not a mapping', () => {
    expect(() => applyFrontmatterPatch('---\n- a\n---\nbody\n', { backlog: true }, FILE))
      .toThrow(/frontmatter must be a YAML mapping/)
  })

  it('throws IssueFrontmatterError with the file path for an unclosed fence', () => {
    let caught: unknown
    try {
      applyFrontmatterPatch('---\ntype: idea\nbody\n', { backlog: true }, FILE)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(IssueFrontmatterError)
    expect((caught as IssueFrontmatterError).filePath).toBe(FILE)
  })
})
