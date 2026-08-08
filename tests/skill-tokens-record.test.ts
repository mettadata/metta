import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const TEMPLATE_SKILLS = join(REPO_ROOT, 'src', 'templates', 'skills')
const DEPLOYED_SKILLS = join(REPO_ROOT, '.claude', 'skills')
const TEMPLATE_GUARD = join(
  REPO_ROOT,
  'src',
  'templates',
  'hooks',
  'metta-guard-bash.mjs',
)
const DEPLOYED_GUARD = join(REPO_ROOT, '.claude', 'hooks', 'metta-guard-bash.mjs')

const OLD_MANDATE = 'After each subagent returns, record its reported token usage'

const FALLBACK_SENTENCE =
  "Token recording is automatic — a SubagentStop hook records each subagent's harness-measured usage; do not run `metta tokens record` after subagent returns. Only if the hook is unavailable, record manually: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name> --source prose`."

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

describe('skill templates defer token recording to the SubagentStop hook', () => {
  const skills = ['metta-plan', 'metta-execute', 'metta-verify', 'metta-next']

  for (const skill of skills) {
    for (const [label, root] of [
      ['template', TEMPLATE_SKILLS],
      ['deployed', DEPLOYED_SKILLS],
    ] as const) {
      it(`${label} ${skill}/SKILL.md drops the per-subagent recording mandate`, async () => {
        const content = await readFile(join(root, skill, 'SKILL.md'), 'utf8')
        expect(
          content.includes(OLD_MANDATE),
          `${label} ${skill} still carries the old per-subagent recording mandate`,
        ).toBe(false)
      })

      it(`${label} ${skill}/SKILL.md carries the verbatim hook-fallback sentence exactly once`, async () => {
        const content = await readFile(join(root, skill, 'SKILL.md'), 'utf8')
        expect(
          countOccurrences(content, FALLBACK_SENTENCE),
          `${label} ${skill} must contain the fallback sentence exactly once, verbatim`,
        ).toBe(1)
      })
    }

    it(`${skill}/SKILL.md template and deployed copies are byte-identical`, async () => {
      const [template, deployed] = await Promise.all([
        readFile(join(TEMPLATE_SKILLS, skill, 'SKILL.md')),
        readFile(join(DEPLOYED_SKILLS, skill, 'SKILL.md')),
      ])
      expect(
        template.equals(deployed),
        `${skill} template and deployed SKILL.md have drifted apart`,
      ).toBe(true)
    })
  }
})

describe('metta-guard-bash hook keeps the tokens allowlist entry', () => {
  it('template and deployed copies are byte-identical', async () => {
    const [template, deployed] = await Promise.all([
      readFile(TEMPLATE_GUARD),
      readFile(DEPLOYED_GUARD),
    ])
    expect(
      template.equals(deployed),
      'metta-guard-bash.mjs template and deployed copies have drifted apart',
    ).toBe(true)
  })

  it("ALLOWED_SUBCOMMANDS still contains 'tokens'", async () => {
    const content = await readFile(TEMPLATE_GUARD, 'utf8')
    const allowedBlock = content.match(
      /ALLOWED_SUBCOMMANDS = new Set\(\[[\s\S]*?\]\)/,
    )
    expect(allowedBlock, 'ALLOWED_SUBCOMMANDS set literal not found').not.toBeNull()
    expect(
      /'tokens',/.test(allowedBlock![0]),
      "ALLOWED_SUBCOMMANDS lost its 'tokens' entry",
    ).toBe(true)
  })
})
