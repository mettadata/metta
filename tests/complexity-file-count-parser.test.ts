import { describe, it, expect } from 'vitest'
import { parseFileCountFromSection } from '../src/complexity/file-count-parser.js'

describe('parseFileCountFromSection', () => {
  it('returns the count of file-like inline-code references in a matching section', () => {
    const md = [
      '# Intent',
      '',
      '## Overview',
      '',
      'Some prose.',
      '',
      '## Impact',
      '',
      '- `src/foo.ts` will be created',
      '- `tests/foo.test.ts` will be added',
      '- `src/bar.yaml` will be updated',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(3)
  })

  it('returns 0 when the heading is absent', () => {
    const md = [
      '# Intent',
      '',
      '## Overview',
      '',
      '- `src/foo.ts`',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(0)
  })

  it('deduplicates repeated references so the same file counts once', () => {
    const md = [
      '## Impact',
      '',
      '- `src/foo.ts` is modified',
      '- `src/foo.ts` is referenced again',
      '- `src/bar.ts` is also modified',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(2)
  })

  it('excludes inline-code nodes that do not look like file paths', () => {
    const md = [
      '## Impact',
      '',
      '- `src/foo.ts` is modified',
      '- Inline example: `const x = 1` is not a file',
      '- Flag reference: `--json`',
      '- Type name: `ParsedSpec`',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(1)
  })

  it('counts mixed extensions (TS + YAML + MD) in the same section', () => {
    const md = [
      '## Impact',
      '',
      '- `src/foo.ts` (code)',
      '- `config/app.yaml` (config)',
      '- `docs/readme.md` (docs)',
      '- `src/bar.tsx` (component)',
      '- `pkg/main.go` (go)',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(5)
  })

  it('does not count inline code after the next H2 boundary', () => {
    const md = [
      '## Impact',
      '',
      '- `src/a.ts`',
      '- `src/b.ts`',
      '',
      '## Notes',
      '',
      '- `src/c.ts` should not count',
      '- `tests/d.test.ts` should not count',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(2)
  })

  it('matches section heading passed without leading hashes', () => {
    const md = [
      '## Files',
      '',
      '- `src/x.ts`',
      '- `src/y.ts`',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, 'Files')).toBe(2)
  })

  it('collects inline code nested inside deeper constructs within the section', () => {
    const md = [
      '## Impact',
      '',
      'Paragraph referencing `src/alpha.ts` inline.',
      '',
      '### Sub-section',
      '',
      '> Blockquote mentions `src/beta.ts` here.',
      '',
      '- list item with `src/gamma.yml`',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(3)
  })

  it('returns 0 when section is present but has no file-like inline code', () => {
    const md = [
      '## Impact',
      '',
      'No files yet. `const x = 1` and `TypeName` are not files.',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(0)
  })

  it('recognizes bare path-prefix tokens even without a known extension', () => {
    const md = [
      '## Impact',
      '',
      '- `src/cli/commands/new` (directory-like path)',
      '- `tests/fixtures/sample` (another prefix)',
      '- `unrelated-identifier`',
      '',
    ].join('\n')

    expect(parseFileCountFromSection(md, '## Impact')).toBe(2)
  })
})
