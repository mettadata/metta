import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConstitution, ConstitutionParseError } from '../src/constitution/constitution-parser.js'

async function writeTmp(content: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'constitution-parser-'))
  const path = join(dir, 'project.md')
  await writeFile(path, content, 'utf-8')
  return { dir, path }
}

describe('parseConstitution', () => {
  let dirs: string[] = []

  beforeEach(() => {
    dirs = []
  })

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true })
    }
  })

  it('CP-1: parses a constitution with both Conventions and Off-Limits sections', async () => {
    const md = `# Project

## Conventions
- Use TypeScript strict mode
- Always include .js extensions

## Off-Limits
- No CommonJS
- No singletons
`
    const { dir, path } = await writeTmp(md)
    dirs.push(dir)
    const result = await parseConstitution(path)
    expect(result.conventions).toEqual([
      'Use TypeScript strict mode',
      'Always include .js extensions',
    ])
    expect(result.offLimits).toEqual(['No CommonJS', 'No singletons'])
  })

  it('CP-2: parses a single-section constitution (only Conventions present)', async () => {
    const md = `# Project

## Conventions
- Convention one
- Convention two
`
    const { dir, path } = await writeTmp(md)
    dirs.push(dir)
    const result = await parseConstitution(path)
    expect(result.conventions).toEqual(['Convention one', 'Convention two'])
    expect(result.offLimits).toEqual([])
  })

  it('CP-3: throws ConstitutionParseError when neither section is present', async () => {
    const md = `# Project

## Stack
- TypeScript

## Quality Standards
- Tests required
`
    const { dir, path } = await writeTmp(md)
    dirs.push(dir)
    await expect(parseConstitution(path)).rejects.toBeInstanceOf(ConstitutionParseError)
  })

  it('CP-4: preserves inline backticks in article text and strips surrounding backticks', async () => {
    const md = `# Project

## Conventions
- Always include \`.js\` extensions in TypeScript import paths
- Use \`unified\` and \`remark-parse\` for markdown

## Off-Limits
- \`No CommonJS\`
`
    const { dir, path } = await writeTmp(md)
    dirs.push(dir)
    const result = await parseConstitution(path)
    expect(result.conventions).toEqual([
      'Always include `.js` extensions in TypeScript import paths',
      'Use `unified` and `remark-parse` for markdown',
    ])
    // Surrounding backticks stripped, but inline ones preserved
    expect(result.offLimits).toEqual(['No CommonJS'])
  })

  it('CP-5: handles trailing whitespace and empty lines around sections', async () => {
    const md = `# Project


## Conventions

- First rule
- Second rule



## Off-Limits

- No bad things


`
    const { dir, path } = await writeTmp(md)
    dirs.push(dir)
    const result = await parseConstitution(path)
    expect(result.conventions).toEqual(['First rule', 'Second rule'])
    expect(result.offLimits).toEqual(['No bad things'])
  })
})
