import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolAdapter, SkillContent } from './tool-adapter.js'

const METTA_SKILLS: SkillContent[] = [
  {
    name: 'metta:propose',
    description: 'Start a new change with Metta',
    argumentHint: '<description of what you want to build>',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash'],
    body: `You are starting a new change using the Metta spec-driven development framework.

## Steps

1. Run \`metta propose "$ARGUMENTS" --json\` to initialize the change
2. Read the output to understand the workflow and first artifact needed
3. Run \`metta instructions intent --json\` to get detailed guidance
4. Follow the instructions to create the intent artifact
5. Run \`metta status --json\` to check progress and see what's next

## Rules

- Always run \`metta status --json\` before and after creating artifacts
- Follow the template structure from \`metta instructions\`
- Don't skip ahead — build artifacts in dependency order
- Commit artifacts as you create them`,
  },
  {
    name: 'metta:plan',
    description: 'Build planning artifacts for the active change',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash'],
    body: `You are building planning artifacts (design, tasks) for the active Metta change.

## Steps

1. Run \`metta status --json\` to see the current state
2. Run \`metta instructions <next-artifact> --json\` to get guidance for the next artifact
3. Create the artifact following the template and agent persona
4. Run \`metta status --json\` to confirm and see what's next
5. Repeat until all planning artifacts are complete

## Rules

- Build artifacts in dependency order shown by \`metta status\`
- Each artifact must satisfy its gate checks before proceeding
- Research artifacts should explore 2-4 approaches and present options`,
  },
  {
    name: 'metta:execute',
    description: 'Run implementation for the active change',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `You are implementing tasks from the active Metta change.

## Steps

1. Run \`metta status --json\` to confirm tasks are ready
2. Read the tasks artifact: \`spec/changes/<change>/tasks.md\`
3. Execute each task in batch order
4. After each task: run tests, lint, typecheck
5. Commit atomically per task with conventional commit messages
6. Run \`metta status --json\` after all tasks

## Deviation Rules

- Rule 1: Fix discovered bugs immediately, commit separately
- Rule 2: Add critical missing pieces, commit separately
- Rule 3: Fix blockers if < 10 lines, else escalate
- Rule 4: STOP for architectural decisions — don't improvise`,
  },
  {
    name: 'metta:verify',
    description: 'Verify implementation against spec',
    allowedTools: ['Read', 'Bash', 'Grep', 'Glob'],
    body: `You are verifying the implementation against the spec for the active Metta change.

## Steps

1. Run \`metta verify --json\` to run all gates
2. Read the spec: \`spec/changes/<change>/spec.md\`
3. For each scenario in the spec, verify the implementation satisfies it
4. Check test coverage for each scenario
5. Create a summary artifact at \`spec/changes/<change>/summary.md\`

## Rules

- Every Given/When/Then scenario must have a passing test
- Flag any spec scenarios not covered by tests
- Do not modify implementation code — only verify and report`,
  },
  {
    name: 'metta:ship',
    description: 'Finalize and ship the active change',
    allowedTools: ['Read', 'Write', 'Bash', 'Grep', 'Glob'],
    body: `You are finalizing and shipping the active Metta change.

## Steps

1. Run \`metta finalize --dry-run --json\` to preview
2. If clean, run \`metta finalize --json\` to archive and merge specs
3. Run \`metta ship --dry-run --json\` to preview the merge
4. If clean, run \`metta ship --json\` to merge to main

## Rules

- Always dry-run before the real operation
- Resolve any spec merge conflicts before shipping
- Do not force-push or skip verification steps`,
  },
  {
    name: 'metta:status',
    description: 'Check current Metta change status',
    allowedTools: ['Read', 'Bash'],
    body: `Check the current state of Metta changes.

Run \`metta status --json\` and report the results to the user.
If no changes are active, suggest \`metta propose\` or \`metta quick\`.`,
  },
  {
    name: 'metta:quick',
    description: 'Quick mode — small change without planning',
    argumentHint: '<description of the small change>',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `You are doing a quick change with Metta — skip planning, go straight to implementation.

## Steps

1. Run \`metta quick "$ARGUMENTS" --json\` to create the change
2. Run \`metta instructions intent --json\` for the intent artifact
3. Create a brief intent, then implement directly
4. Run tests, lint, typecheck after implementation
5. Run \`metta verify --json\` to check gates

## Rules

- Quick mode is for small, well-understood changes
- Still commit atomically and run gates
- If the change turns out to be complex, switch to \`metta propose\``,
  },
  {
    name: 'metta:auto',
    description: 'Full lifecycle loop — discover, build, verify, ship',
    argumentHint: '<description of what to build>',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    body: `You are running Metta auto mode — full lifecycle from discovery to shipping.

## Steps

1. Run \`metta auto "$ARGUMENTS" --json\` to start
2. Run \`metta propose "$ARGUMENTS" --json\` to create the change
3. Run through each artifact in order using \`metta instructions <artifact> --json\`
4. Execute all tasks, run gates after each
5. Run \`metta verify --json\` — if gaps found, re-plan and fix
6. Run \`metta finalize --json\` then \`metta ship --json\`

## Rules

- Ask all discovery questions upfront before executing
- If the same scenarios fail for 2+ cycles, stop and surface the issue
- Deviation Rule 4 always halts auto mode — ask the user`,
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
