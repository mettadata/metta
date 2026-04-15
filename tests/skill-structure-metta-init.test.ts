import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SKILL_PATH = join(
  import.meta.dirname,
  '..',
  'src', 'templates', 'skills', 'metta-init', 'SKILL.md'
)

const EXIT_PHRASE = "I'm done \u2014 proceed with these answers"

function sections(full: string): string[] {
  return full.split(/(?=^## Round \d)/im)
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('metta-init SKILL.md structure', () => {
  it('has exactly 3 Round headings (REQ-35)', async () => {
    const full = await readFile(SKILL_PATH, 'utf8')
    expect((full.match(/^## Round \d/gim) || []).length).toBe(3)
  })

  it('includes the early-exit option at least 3 times (REQ-36)', async () => {
    const full = await readFile(SKILL_PATH, 'utf8')
    expect(countOccurrences(full, EXIT_PHRASE)).toBeGreaterThanOrEqual(3)
  })

  it('Round 1 contains no WebSearch or WebFetch references (REQ-37)', async () => {
    const full = await readFile(SKILL_PATH, 'utf8')
    const parts = sections(full)
    const r1Section = parts.find(p => /^## Round 1/im.test(p)) ?? ''
    expect(r1Section).not.toContain('WebSearch')
    expect(r1Section).not.toContain('WebFetch')
  })

  it('template and deployed copy of SKILL.md are byte-identical', async () => {
    const template = await readFile(SKILL_PATH, 'utf8')
    const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-init', 'SKILL.md')
    const deployed = await readFile(deployedPath, 'utf8')
    expect(deployed).toBe(template)
  })

  it('Round 2 and Round 3 reference WebSearch (REQ-38)', async () => {
    const full = await readFile(SKILL_PATH, 'utf8')
    const parts = sections(full)
    const r2Section = parts.find(p => /^## Round 2/im.test(p)) ?? ''
    const r3Section = parts.find(p => /^## Round 3/im.test(p)) ?? ''
    expect(r2Section).toContain('WebSearch')
    expect(r3Section).toContain('WebSearch')
  })

  it('no round contains more than 4 AskUserQuestion call sites (REQ-39)', async () => {
    const full = await readFile(SKILL_PATH, 'utf8')
    const parts = sections(full)
    const roundSections = parts.filter(p => /^## Round \d/im.test(p))
    for (const section of roundSections) {
      expect(countOccurrences(section, 'AskUserQuestion')).toBeLessThanOrEqual(4)
    }
  })
})
