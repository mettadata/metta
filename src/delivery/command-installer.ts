import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolAdapter, SkillContent } from './tool-adapter.js'

const METTA_SKILLS: SkillContent[] = [
  {
    name: 'metta:propose',
    description: 'Start a new change with Metta',
    argumentHint: '<description of what you want to build>',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash'],
    body: `Start a new spec-driven change. The metta CLI manages all state — you follow its instructions.

## Loop

1. \`metta propose "$ARGUMENTS" --json\` → creates change, returns change name + artifact list
2. \`metta instructions <artifact> --json --change <name>\` → returns template, agent persona, output_path
3. Write the artifact file to the output_path. Fill in ALL sections with real content — no placeholders.
4. \`git add <output_path> && git commit -m "docs(<change>): create <artifact>"\`
5. \`metta complete <artifact> --json --change <name>\` → marks done, returns next artifact + next command
6. Repeat from step 2 until \`all_complete: true\`

## Critical Rules

- ALWAYS write artifact files to disk — never just describe them
- ALWAYS git commit immediately after writing each artifact
- ALWAYS call \`metta complete\` after each artifact — it advances the workflow
- Follow the template from \`metta instructions\` — fill every section with real content
- Specs MUST use RFC 2119 (MUST/SHOULD/MAY) and Given/When/Then scenarios`,
  },
  {
    name: 'metta:plan',
    description: 'Build planning artifacts for the active change',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash'],
    body: `Build the next planning artifacts. The CLI tells you what's needed.

## Loop

1. \`metta status --json\` → see which artifacts are pending/ready
2. \`metta instructions <next-ready-artifact> --json --change <name>\` → get template + context
3. Read existing artifacts from spec/changes/<change>/ for context
4. Write the artifact file to output_path with real content
5. \`git add <file> && git commit -m "docs(<change>): create <artifact>"\`
6. \`metta complete <artifact> --json --change <name>\` → returns next artifact
7. Repeat until all planning artifacts are complete`,
  },
  {
    name: 'metta:execute',
    description: 'Run implementation for the active change',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `Implement the tasks from the active change.

## Steps

1. \`metta status --json\` → confirm implementation is ready
2. Read \`spec/changes/<change>/tasks.md\`
3. For each task in batch order:
   a. Implement the code changes
   b. Run tests/lint: \`npm test\`
   c. \`git commit -m "feat(<change>): <task description>"\`
4. Write summary to \`spec/changes/<change>/summary.md\`
5. \`git add spec/changes/<change>/summary.md && git commit -m "docs(<change>): implementation summary"\`
6. \`metta complete implementation --json --change <name>\`

## Deviation Rules

- Bug found → fix + separate commit: \`fix(<change>): ...\`
- Missing utility → add + separate commit
- Blocked (>10 lines to fix) → STOP, tell user
- Design is wrong → STOP immediately, tell user`,
  },
  {
    name: 'metta:verify',
    description: 'Verify implementation against spec',
    allowedTools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    body: `Verify the implementation matches the spec.

## Steps

1. \`metta verify --json --change <name>\` → runs gates, returns results
2. Read \`spec/changes/<change>/spec.md\` → check each scenario
3. For each Given/When/Then scenario: confirm a passing test exists
4. Write results to \`spec/changes/<change>/summary.md\`
5. \`git add spec/changes/<change>/summary.md && git commit -m "docs(<change>): verification summary"\`
6. \`metta complete verification --json --change <name>\``,
  },
  {
    name: 'metta:ship',
    description: 'Finalize and ship the active change',
    allowedTools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    body: `Finalize the change — archive, merge specs, prepare for main.

## Steps

1. \`metta finalize --dry-run --json --change <name>\` → preview
2. If clean: \`metta finalize --json --change <name>\` → archives change, merges specs
3. Git commit any remaining changes
4. Report result to user

If spec conflicts are reported, stop and tell the user.`,
  },
  {
    name: 'metta:status',
    description: 'Check current Metta change status',
    allowedTools: ['Read', 'Bash'],
    body: `Run \`metta status --json\` and report results to the user.

If no changes active, suggest \`/metta:propose\` or \`/metta:quick\`.
If multiple changes, list them all with their status.`,
  },
  {
    name: 'metta:quick',
    description: 'Quick mode — small change without full planning',
    argumentHint: '<description of the small change>',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `Quick change — intent, implement, verify. No research/design/tasks phases.

## Steps

1. \`metta quick "$ARGUMENTS" --json\` → creates change with quick workflow
2. \`metta instructions intent --json --change <name>\` → get intent template
3. Write intent to the output_path (Problem, Proposal, Impact, Out of Scope)
4. \`git add spec/changes/<change>/intent.md && git commit -m "docs(<change>): create intent"\`
5. \`metta complete intent --json --change <name>\` → advances to implementation
6. Implement the change — write/edit code files
7. Run tests: \`npm test\` (if configured)
8. \`git commit -m "feat(<change>): <what was implemented>"\`
9. Write summary to \`spec/changes/<change>/summary.md\` (what changed, how to test)
10. \`git add spec/changes/<change>/summary.md && git commit -m "docs(<change>): summary"\`
11. \`metta complete implementation --json --change <name>\`

## Critical Rules

- MUST write intent.md and summary.md to disk — not just describe them
- MUST git commit after each step
- MUST call \`metta complete\` to advance the workflow
- If complex, tell user to use \`/metta:propose\` instead`,
  },
  {
    name: 'metta:auto',
    description: 'Full lifecycle loop — discover, build, verify, ship',
    argumentHint: '<description of what to build>',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `Full lifecycle — propose through finalize, driven by CLI commands.

## Loop

1. \`metta propose "$ARGUMENTS" --json\` → creates change
2. For each artifact in order:
   a. \`metta instructions <artifact> --json --change <name>\`
   b. Write artifact to output_path with real content
   c. \`git commit -m "docs(<change>): create <artifact>"\`
   d. \`metta complete <artifact> --json --change <name>\` → returns next
3. For implementation: read tasks.md, implement each task, commit each
4. Write summary.md with verification results
5. \`metta complete verification --json --change <name>\`
6. \`metta finalize --json --change <name>\`

## Rules

- Ask discovery questions BEFORE writing spec — don't guess requirements
- MUST write files + commit + call \`metta complete\` for every artifact
- Deviation Rule 4: design is wrong → STOP, tell user`,
  },
]

export async function installCommands(
  adapter: ToolAdapter,
  projectRoot: string,
): Promise<string[]> {
  const installed: string[] = []

  const skillsDir = adapter.skillsDir(projectRoot)
  if (skillsDir) {
    for (const skill of METTA_SKILLS) {
      const skillDir = join(skillsDir, `metta-${skill.name.replace('metta:', '')}`)
      await mkdir(skillDir, { recursive: true })
      const content = adapter.formatSkill(skill)
      await writeFile(join(skillDir, 'SKILL.md'), content)
      installed.push(skill.name)
    }
  }

  return installed
}

export function getAvailableSkills(): SkillContent[] {
  return METTA_SKILLS
}
