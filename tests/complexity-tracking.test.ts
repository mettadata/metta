import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseComplexityTracking } from '../src/constitution/complexity-tracking.js'

describe('parseComplexityTracking', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-complexity-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function writeSpec(content: string): Promise<string> {
    const path = join(tempDir, 'spec.md')
    await writeFile(path, content, 'utf8')
    return path
  }

  it('CT-1: returns a populated map from a well-formed Complexity Tracking section', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Overview',
        '',
        'Some text.',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: required for plugin registry to share state across modules',
        '- No string literal templates: YAML embed needs interpolation at runtime',
        '',
        '## Requirements',
        '',
        '- REQ-1',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(2)
    expect(result.get('No singletons')).toBe(
      'required for plugin registry to share state across modules',
    )
    expect(result.get('No string literal templates')).toBe(
      'YAML embed needs interpolation at runtime',
    )
  })

  it('CT-2: returns an empty map when the section is absent', async () => {
    const path = await writeSpec(
      ['# Spec', '', '## Overview', '', 'No tracking here.', ''].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(0)
  })

  it('CT-3: returns an empty map when the section is present but empty', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '## Next Section',
        '',
        '- not a tracking entry',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(0)
  })

  it('CT-4: parses entries whose article contains backticks/colons by splitting on the first ": " only', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- `metta install`: justification for shipping a separate install command',
        '',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(1)
    expect(result.get('`metta install`')).toBe(
      'justification for shipping a separate install command',
    )
  })

  it('CT-5: preserves inline backticks inside the rationale', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: needed because `GlobalRegistry` must dedupe across `import` boundaries',
        '',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.get('No singletons')).toBe(
      'needed because `GlobalRegistry` must dedupe across `import` boundaries',
    )
  })
})
