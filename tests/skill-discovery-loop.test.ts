import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..')
const proposeTemplatePath = join(repoRoot, 'src', 'templates', 'skills', 'metta-propose', 'SKILL.md')
const proposeDeployedPath = join(repoRoot, '.claude', 'skills', 'metta-propose', 'SKILL.md')
const quickTemplatePath = join(repoRoot, 'src', 'templates', 'skills', 'metta-quick', 'SKILL.md')
const quickDeployedPath = join(repoRoot, '.claude', 'skills', 'metta-quick', 'SKILL.md')

const EXIT_PHRASE = "I'm done — proceed with these answers"

describe('metta-propose SKILL.md — discovery loop', () => {
  it('contains DISCOVERY LOOP header and no DISCOVERY GATE', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain('DISCOVERY LOOP')
    expect(contents).not.toContain('DISCOVERY GATE')
  })

  it('contains the canonical exit-option phrase', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain(EXIT_PHRASE)
  })

  it('contains a Round 1 reference (scope + architecture)', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain('Round 1')
  })

  it('contains a Round 2 reference (data + integration)', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain('Round 2')
  })

  it('contains a Round 3 reference (edge cases + non-functional)', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain('Round 3')
  })

  it('contains the between-round status line template', async () => {
    const contents = await readFile(proposeTemplatePath, 'utf8')
    expect(contents).toContain('Resolved:')
    expect(contents).toContain('Open:')
    expect(contents).toContain('proceeding to Round')
  })
})

describe('metta-quick SKILL.md — gated discovery loop', () => {
  it('contains a trivial-detection gate reference', async () => {
    const contents = await readFile(quickTemplatePath, 'utf8')
    const hasTrivialMarker =
      contents.includes('trivial') ||
      contents.includes('single-line fix') ||
      contents.includes('typo') ||
      contents.includes('one-file delete')
    expect(hasTrivialMarker).toBe(true)
  })

  it('contains a DISCOVERY LOOP reference', async () => {
    const contents = await readFile(quickTemplatePath, 'utf8')
    expect(contents).toContain('DISCOVERY LOOP')
  })

  it('contains the canonical exit-option phrase', async () => {
    const contents = await readFile(quickTemplatePath, 'utf8')
    expect(contents).toContain(EXIT_PHRASE)
  })
})

describe('byte-identity — REQ-3', () => {
  it('metta-propose template matches deployed copy byte-for-byte', async () => {
    const template = await readFile(proposeTemplatePath, 'utf8')
    const deployed = await readFile(proposeDeployedPath, 'utf8')
    expect(template).toBe(deployed)
  })

  it('metta-quick template matches deployed copy byte-for-byte', async () => {
    const template = await readFile(quickTemplatePath, 'utf8')
    const deployed = await readFile(quickDeployedPath, 'utf8')
    expect(template).toBe(deployed)
  })
})
