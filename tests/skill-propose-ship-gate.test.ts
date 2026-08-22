import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..')
const proposeDeployedPath = join(repoRoot, '.claude', 'skills', 'metta-propose', 'SKILL.md')
const proposeTemplatePath = join(repoRoot, 'src', 'templates', 'skills', 'metta-propose', 'SKILL.md')
const autoTemplatePath = join(repoRoot, 'src', 'templates', 'skills', 'metta-auto', 'SKILL.md')
const fixIssuesTemplatePath = join(repoRoot, 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')

const SHIP_GATE_MARKER =
  '**Ship opt-in — the following sub-steps run ONLY when `STOP_AFTER = "ship"` (or the change record\'s persisted `stop_after` is `ship`):**'
const DEFAULT_PHRASE = '**Default path ends at an open PR. Do NOT merge; report the PR URL and stop.**'
const HANDOFF_PHRASE = 'PR open for review: <pr-url>. Run `/metta-ship` to land it'

const proposeCopies = [
  ['.claude/skills/metta-propose/SKILL.md', proposeDeployedPath],
  ['src/templates/skills/metta-propose/SKILL.md', proposeTemplatePath],
] as const

describe.each(proposeCopies)('metta-propose ship gate — %s', (_label, filePath) => {
  it('places all merge commands after the ship opt-in marker', async () => {
    const contents = await readFile(filePath, 'utf8')
    const parts = contents.split(SHIP_GATE_MARKER)
    expect(parts).toHaveLength(2)
    expect(parts[0]).not.toContain('gh pr merge')
    expect(parts[0]).not.toContain('gh pr checks')
    expect(parts[1]).toContain('gh pr checks <pr-number> --watch --fail-fast')
    expect(parts[1]).toContain('gh pr merge <pr-number> --merge')
  })

  it('contains the PR-open default phrase and the ship handoff phrase', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(contents).toContain(DEFAULT_PHRASE)
    expect(contents).toContain(HANDOFF_PHRASE)
  })

  it('does not contain unconditional finalize/ship mandate language', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(contents).not.toContain('Critical: You MUST verify, finalize, and ship')
    expect(contents).not.toContain('Do NOT stop after the last artifact')
    expect(contents).not.toContain('finalize + ship must happen')
    expect(contents).not.toContain('unless the user asked to leave it open')
  })

  it('retains the local-merge prohibition and PR creation step', async () => {
    const contents = await readFile(filePath, 'utf8')
    expect(contents).toContain('Direct local merge of the change branch into main')
    expect(contents).toContain('gh pr create')
  })
})

describe('scope guard — other skills keep their merge instructions', () => {
  it('metta-auto SKILL.md still contains gh pr merge', async () => {
    const contents = await readFile(autoTemplatePath, 'utf8')
    expect(contents).toContain('gh pr merge')
  })

  it('metta-fix-issues SKILL.md still contains gh pr merge', async () => {
    const contents = await readFile(fixIssuesTemplatePath, 'utf8')
    expect(contents).toContain('gh pr merge')
  })
})
