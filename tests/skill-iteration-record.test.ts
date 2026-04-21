import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const TEMPLATE_ROOT = join(
  import.meta.dirname,
  '..',
  'src',
  'templates',
  'skills',
)

async function read(skillName: string): Promise<string> {
  return readFile(join(TEMPLATE_ROOT, skillName, 'SKILL.md'), 'utf8')
}

describe('skill templates call `metta iteration record`', () => {
  const skillsThatLoopBoth = [
    'metta-propose',
    'metta-fix-issues',
    'metta-fix-gap',
    'metta-auto',
  ]

  for (const skill of skillsThatLoopBoth) {
    it(`${skill}/SKILL.md invokes iteration record for both review and verify`, async () => {
      const content = await read(skill)
      expect(
        content.includes('metta iteration record --phase review'),
        `${skill} is missing the review iteration record line`,
      ).toBe(true)
      expect(
        content.includes('metta iteration record --phase verify'),
        `${skill} is missing the verify iteration record line`,
      ).toBe(true)
      // The line MUST be prefixed with METTA_SKILL=1.
      expect(content).toMatch(
        /METTA_SKILL=1 metta iteration record --phase review/,
      )
      expect(content).toMatch(
        /METTA_SKILL=1 metta iteration record --phase verify/,
      )
    })
  }

  it('metta-quick/SKILL.md invokes iteration record for both review and verify', async () => {
    const content = await read('metta-quick')
    expect(content).toMatch(
      /METTA_SKILL=1 metta iteration record --phase review/,
    )
    expect(content).toMatch(
      /METTA_SKILL=1 metta iteration record --phase verify/,
    )
  })
})
