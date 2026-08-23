import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const SKILL_TREES = ['src/templates/skills', '.claude/skills'] as const
const SHIP_SKILLS = [
  'metta-ship',
  'metta-propose',
  'metta-quick',
  'metta-auto',
  'metta-fix-issues',
  'metta-fix-gap',
] as const

// Frozen copy of the canonical sentence — copied byte-exact from
// .claude/skills/metta-ship/SKILL.md. Never retype it.
const UAT_GATE_SENTENCE =
  'UAT gate (mandatory unless the effective uat.enforce_on_ship is false): spawn the metta-uat-runner subagent via the Agent tool (subagent_type: metta-uat-runner) against the archived UAT.md at the uatPath reported by metta finalize --json, sanity-check the diff, commit the run record as docs(<change>): UAT run record, attach the run summary to the PR, and treat any failed step as a blocker — report it, leave the PR open and flagged, and stop before any merge.'
const PR_CREATE_CMD = 'gh pr create --title'
const PR_MERGE_CMD = 'gh pr merge <pr-number> --merge'

// 12 [label, absolutePath] tuples — the label doubles as the offender name in failures
const cases = SKILL_TREES.flatMap((tree) =>
  SHIP_SKILLS.map(
    (skill) => [`${tree}/${skill}/SKILL.md`, join(REPO_ROOT, tree, skill, 'SKILL.md')] as const,
  ),
)

describe.each(cases)('UAT ship gate — %s', (label, filePath) => {
  it('contains the byte-identical UAT gate sentence exactly once', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(
      contents.split(UAT_GATE_SENTENCE).length - 1,
      `${label}: gate sentence count`,
    ).toBe(1)
  })

  it('places the UAT gate before PR creation', async () => {
    const contents = await readFile(filePath, 'utf8')
    const gate = contents.indexOf(UAT_GATE_SENTENCE)
    const create = contents.indexOf(PR_CREATE_CMD)
    expect(gate, `${label}: gate sentence missing`).toBeGreaterThan(-1)
    expect(create, `${label}: PR create step missing`).toBeGreaterThan(-1)
    expect(gate, `${label}: UAT gate must precede gh pr create`).toBeLessThan(create)
  })

  it('places the UAT gate before the merge step', async () => {
    const contents = await readFile(filePath, 'utf8')
    const gate = contents.indexOf(UAT_GATE_SENTENCE)
    const merge = contents.indexOf(PR_MERGE_CMD)
    expect(gate, `${label}: gate sentence missing`).toBeGreaterThan(-1)
    expect(merge, `${label}: merge step missing`).toBeGreaterThan(-1)
    expect(gate, `${label}: UAT gate must precede gh pr merge`).toBeLessThan(merge)
  })
})

describe.each([
  [
    'src/templates/skills/metta-ship/SKILL.md',
    join(REPO_ROOT, 'src/templates/skills/metta-ship/SKILL.md'),
  ],
  ['.claude/skills/metta-ship/SKILL.md', join(REPO_ROOT, '.claude/skills/metta-ship/SKILL.md')],
] as const)('metta-ship Agent tool — %s', (label, filePath) => {
  it('frontmatter allowed-tools includes Agent', async () => {
    const contents = await readFile(filePath, 'utf8')
    const frontmatter = contents.split('---')[1] ?? ''
    expect(frontmatter, `${label}: allowed-tools must list Agent`).toMatch(
      /allowed-tools:.*\bAgent\b/,
    )
  })
})

describe('UAT ship gate — aggregate coverage', () => {
  it('the gate sentence appears verbatim in all six ship-path skills in both trees', async () => {
    const missing: string[] = []
    for (const [label, filePath] of cases) {
      const contents = await readFile(filePath, 'utf8')
      if (!contents.includes(UAT_GATE_SENTENCE)) missing.push(label)
    }
    expect(
      missing,
      `Files missing the byte-identical UAT gate sentence:\n${missing.join('\n')}`,
    ).toEqual([])
  })
})
