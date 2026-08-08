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

describe('skill templates call `metta tokens record`', () => {
  const skillsThatRecordTokens = [
    'metta-plan',
    'metta-execute',
    'metta-verify',
    'metta-next',
  ]

  for (const skill of skillsThatRecordTokens) {
    it(`${skill}/SKILL.md carries the verbatim token-recording instruction`, async () => {
      const content = await read(skill)
      expect(
        content.includes('metta tokens record --task'),
        `${skill} is missing the tokens record instruction`,
      ).toBe(true)
      expect(
        content.includes(
          'metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>',
        ),
        `${skill} tokens record command deviates from the verbatim instruction`,
      ).toBe(true)
    })
  }
})
