import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

// Content pins for the layer-1 shell-write path discipline introduced by
// fix-guard-edit-worktree-write-friction-caused-cross-repo (design C1).
//
// The executor and verifier personas carry the full discipline (prevention
// travels with every spawn); the metta-execute skill binds executors via its
// spawn contract; six sibling executor-dispatching skills carry one
// byte-identical escalation sentence. Template ↔ deployed byte-identity is
// enforced by tests/template-deploy-sync.test.ts — this file pins the content
// itself in BOTH trees so neither copy can silently lose the discipline.

const AGENT_TREES = ['src/templates/agents', '.claude/agents']
const SKILL_TREES = ['src/templates/skills', '.claude/skills']

// The one sentence that must be byte-identical across all six sibling
// executor-dispatching skills (design C1 — pinned to close wording drift).
const ESCALATION_SENTENCE =
  'If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success with no on-disk effect), escalate to the user with the report; never work around it via bash writes or orchestrator-performed writes.'

const SIBLING_SKILLS = [
  'metta-quick',
  'metta-auto',
  'metta-fix-issues',
  'metta-fix-gap',
  'metta-propose',
  'metta-verify',
]

describe('executor persona shell-write path discipline', () => {
  it.each(AGENT_TREES)('%s/metta-executor.md carries the discipline section and Rule 6', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-executor.md'), 'utf8')
    // Section marker
    expect(content).toContain('## Shell-Write Path Discipline')
    // change_root is the only authoritative root
    expect(content).toContain('only authoritative root')
    expect(content).toContain('Never re-derive target paths from the session cwd')
    // Bash-mediated writes must stay under change_root
    expect(content).toContain('MUST target an absolute path under')
    expect(content).toContain('Writing via Bash to any path outside `change_root` is forbidden')
    // No change_root -> no bash writes
    expect(content).toContain('do not perform bash file writes at all')
    // Silent-write anomaly STOP rule with bash-fallback prohibition
    expect(content).toContain('**Rule 6**')
    expect(content).toContain('Silent-write anomaly')
    expect(content).toContain('NEVER rewrite the content via bash (heredoc, redirection, script)')
    // git-status step doubles as write verification; no-op edits are not anomalies
    expect(content).toContain('doubles as write verification')
    expect(content).toContain('a no-op edit (content already present) is not an anomaly')
    // Scope note excludes build/test side-writes
    expect(content).toContain('not the internal side-writes of build/test commands')
  })

  it.each(AGENT_TREES)('%s/metta-executor.md preserves existing Deviation Rules 1-5', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-executor.md'), 'utf8')
    for (const rule of ['**Rule 1**', '**Rule 2**', '**Rule 3**', '**Rule 4**', '**Rule 5**']) {
      expect(content).toContain(rule)
    }
  })
})

describe('verifier persona shell-write path discipline', () => {
  it.each(AGENT_TREES)('%s/metta-verifier.md carries the discipline section', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-verifier.md'), 'utf8')
    expect(content).toContain('## Shell-Write Path Discipline')
    expect(content).toContain('only sanctioned file write is the verification artifact')
    expect(content).toContain('MUST target an absolute path under')
    expect(content).toContain('Writing via Bash to any path outside `change_root` is forbidden')
  })

  it.each(AGENT_TREES)('%s/metta-verifier.md splits refusal fallback from silent-write anomaly', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-verifier.md'), 'utf8')
    // The heredoc fallback is refusal-only — never a silent-success workaround
    expect(content).toContain(
      'The heredoc fallback applies ONLY to an explicit refusal — a `tool_use_error` returned by the Write tool.',
    )
    expect(content).toContain('It NEVER applies to a silent-write anomaly')
    expect(content).toContain('STOP and report the target path')
    // Fallback target stays change_root-anchored
    expect(content).toContain(
      'the heredoc target MUST be the exact orchestrator-provided path under `change_root` — never a re-derived path',
    )
    // The pre-existing pinned strings survive (append-only amendment;
    // also asserted by tests/agents-byte-identity.test.ts)
    expect(content).toContain('ATTEMPT the Write tool first.')
    expect(content).toContain('When Write is refused, fall back to writing the artifact via a shell heredoc')
    expect(content).toContain('Never skip the artifact and never relocate it')
  })
})

describe('metta-execute skill spawn contract and STOP escalation', () => {
  it.each(SKILL_TREES)('%s/metta-execute/SKILL.md binds executors to path discipline', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-execute', 'SKILL.md'), 'utf8')
    // Spawn-contract binding
    expect(content).toContain('Executors are bound by change_root shell-write path discipline')
    expect(content).toContain(
      'include the `change_root` value in every executor prompt for this reason',
    )
    // Rule 6 one-line form in the per-prompt Deviation Rules block
    expect(content).toContain('Silent-write anomaly (Edit/Write reports success but the change is not on disk')
    expect(content).toContain('NEVER rewrite the content via bash (heredoc, redirection, script)')
  })

  it.each(SKILL_TREES)('%s/metta-execute/SKILL.md carries silent-write STOP handling for the orchestrator', async (tree) => {
    const content = await readFile(join(REPO_ROOT, tree, 'metta-execute', 'SKILL.md'), 'utf8')
    expect(content).toContain('**Silent-write STOP handling (orchestrator):**')
    expect(content).toContain('ESCALATE to the user immediately')
    expect(content).toContain('do not re-dispatch the executor with instructions to write via bash')
    expect(content).toContain('do not perform the write yourself — in or outside the worktree')
  })
})

describe('sibling skill escalation sentence (cross-file byte-identity)', () => {
  const cases = SKILL_TREES.flatMap((tree) => SIBLING_SKILLS.map((skill) => [tree, skill] as const))

  it.each(cases)('%s/%s/SKILL.md contains the exact escalation sentence', async (tree, skill) => {
    const content = await readFile(join(REPO_ROOT, tree, skill, 'SKILL.md'), 'utf8')
    expect(content).toContain(ESCALATION_SENTENCE)
  })

  it('the escalation sentence appears verbatim in all six sibling skills in both trees', async () => {
    const missing: string[] = []
    for (const tree of SKILL_TREES) {
      for (const skill of SIBLING_SKILLS) {
        const content = await readFile(join(REPO_ROOT, tree, skill, 'SKILL.md'), 'utf8')
        if (!content.includes(ESCALATION_SENTENCE)) missing.push(`${tree}/${skill}/SKILL.md`)
      }
    }
    expect(missing, `Files missing the byte-identical escalation sentence:\n${missing.join('\n')}`).toEqual([])
  })
})
