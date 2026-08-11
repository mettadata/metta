import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')

// Regression lint for session-cwd anchoring gaps in skill instruction templates
// (issue: residual-session-cwd-anchoring-gaps-in-skills-and-gate).
//
// Skill instructions that execute commands or read change artifacts MUST anchor
// to `{change_root}` — the root of the checkout hosting the change — because a
// worktree-hosted change does not live at the session cwd. PR #60 anchored most
// spots mechanically; this test keeps the pattern class from reappearing.
//
// Each rule flags a line only when it matches an executable-instruction shape
// AND the line does not already carry `{change_root}`. Prose mentions and the
// deliberately elliptical parallelism anti-examples (`...npm test...`) do not
// match these shapes.

const SKILL_TREES = ['.claude/skills', 'src/templates/skills']

// Skills that intentionally operate on the session/main checkout (no change
// context): release pushes main from main, import/init/refresh act on the
// project root itself.
const SESSION_ROOTED_SKILLS = new Set([
  'metta-release',
  'metta-import',
  'metta-init',
  'metta-refresh',
])

interface Rule {
  name: string
  pattern: RegExp
}

const RULES: Rule[] = [
  {
    // Change-branch pushes must run against the change's checkout.
    name: 'bare `git push -u origin metta/<...>` without git -C "{change_root}"',
    pattern: /git push -u origin metta\//,
  },
  {
    // Gate commands in agent prompts ("Run `npm test`") or verifier scope
    // lists ("Agent 1 runs `npm test`") must be anchored.
    name: 'unanchored gate command (Run/runs `npm ...` or `npx ...`)',
    pattern: /[Rr]uns? `(npm|npx) /,
  },
  {
    // Verifier reads of change artifacts must use the anchored absolute path.
    name: 'unanchored artifact read (Read spec.md / Read `spec.md`)',
    pattern: /Read `?spec\.md/,
  },
  {
    // Shell preconditions on change paths must be anchored.
    name: 'cwd-relative shell path (mkdir -p/test -s spec/changes/...)',
    pattern: /(mkdir -p|test -s) "?spec\/changes\//,
  },
  {
    // Backticked bare change paths in executable steps must be anchored.
    name: 'bare `spec/changes/<change>/...` path without {change_root}',
    pattern: /`spec\/changes\/<change>/,
  },
]

async function collectSkillFiles(): Promise<Array<{ tree: string; skill: string; path: string }>> {
  const files: Array<{ tree: string; skill: string; path: string }> = []
  for (const tree of SKILL_TREES) {
    const entries = await readdir(join(REPO_ROOT, tree), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('metta-')) continue
      if (SESSION_ROOTED_SKILLS.has(entry.name)) continue
      files.push({ tree, skill: entry.name, path: join(tree, entry.name, 'SKILL.md') })
    }
  }
  return files
}

describe('skill template change_root anchoring', () => {
  it('finds skill templates in both trees', async () => {
    const files = await collectSkillFiles()
    const trees = new Set(files.map((f) => f.tree))
    expect(trees.size).toBe(2)
    expect(files.length).toBeGreaterThan(0)
  })

  it('has no session-cwd-anchored commands or artifact paths in change-scoped skills', async () => {
    const files = await collectSkillFiles()
    const violations: string[] = []

    for (const file of files) {
      const content = await readFile(join(REPO_ROOT, file.path), 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, index) => {
        if (line.includes('{change_root}')) return
        for (const rule of RULES) {
          if (rule.pattern.test(line)) {
            violations.push(`${file.path}:${index + 1} — ${rule.name}\n    ${line.trim()}`)
          }
        }
      })
    }

    expect(
      violations,
      `Unanchored session-cwd patterns found in skill templates:\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
