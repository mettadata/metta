import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolAdapter, SkillContent } from './tool-adapter.js'

const AGENT_LOOP_INSTRUCTIONS = `## Agent Execution Pattern

For each artifact, you act as the **orchestrator** — lean context, no implementation. You spawn a subagent to do the work.

### Per-Artifact Loop

1. \`metta instructions <artifact> --json --change <name>\`
   → Returns: agent.persona, agent.tools, template, output_path, context
2. **Spawn a subagent** (Agent tool) with:
   - The agent persona from the instructions response
   - The template and output_path
   - Any context from previous artifacts
   - Clear task: "Write <output_path> following this template. Fill ALL sections with real content. Then git commit."
3. When the subagent completes:
   \`metta complete <artifact> --json --change <name>\`
   → Returns: next artifact to build, or all_complete: true
4. Repeat with next artifact

### Subagent Prompt Template

When spawning subagents, include this in the prompt:

"You are: {agent.persona}

Write the file {output_path} following this template:
{template}

Context from previous artifacts:
{read the files from spec/changes/<change>/}

Rules:
- Fill in ALL sections with real, specific content — no placeholders
- When done, run: git add {output_path} && git commit -m 'docs(<change>): create <artifact>'
- For implementation tasks, use conventional commits: feat(<change>): <description>
- For specs, use RFC 2119 keywords (MUST/SHOULD/MAY) and Given/When/Then scenarios"

### Why Subagents

- Fresh context window per task — no pollution from previous work
- Agent persona produces better output than one agent roleplaying
- Orchestrator stays lean (~15K tokens) — reserves full window for executors
- Each subagent commits atomically — revertable independently`

const METTA_SKILLS: SkillContent[] = [
  {
    name: 'metta:init',
    description: 'Initialize Metta in a project with interactive discovery',
    allowedTools: ['Read', 'Write', 'Bash', 'Grep', 'Glob', 'Agent'],
    body: `You are the **orchestrator** for Metta project initialization.

## Steps

1. \`metta init --json\` → scaffolds directories, installs skills, returns discovery instructions
2. Parse the \`discovery\` object from the JSON response
3. **Spawn a discovery agent** (Agent tool) with:
   - The agent persona from \`discovery.agent.persona\`
   - The mode (\`discovery.mode\`: brownfield or greenfield)
   - The detected stack/dirs from \`discovery.detected\` (brownfield only)
   - The questions from \`discovery.questions\`
   - The output paths from \`discovery.output_paths\`
   - The templates from \`discovery.constitution_template\` and \`discovery.context_template\`
   - Also update \`discovery.output_paths.config\` with the project name, description, and stack from the user's answers
   - Clear task: "Ask the questions using AskUserQuestion. For brownfield, scan the codebase first and present findings before asking. Fill the templates with real answers. Write the output files. Then git add + commit."
4. Report to user what was generated`,
  },
  {
    name: 'metta:propose',
    description: 'Start a new change with Metta',
    argumentHint: '<description of what you want to build>',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash', 'Agent'],
    body: `You are the **orchestrator** for a new spec-driven change. You manage the workflow; subagents do the work.

## Steps

1. \`metta propose "$ARGUMENTS" --json\` → creates change, returns change name + artifact list
2. For each artifact, use the Agent Execution Pattern below
3. After all artifacts: report status to user

${AGENT_LOOP_INSTRUCTIONS}`,
  },
  {
    name: 'metta:plan',
    description: 'Build planning artifacts for the active change',
    allowedTools: ['Read', 'Write', 'Grep', 'Glob', 'Bash', 'Agent'],
    body: `You are the **orchestrator** for building planning artifacts. Spawn subagents for each artifact.

## Steps

1. \`metta status --json\` → find which artifacts are ready
2. For each ready artifact, use the Agent Execution Pattern below
3. Continue until all planning artifacts are complete

${AGENT_LOOP_INSTRUCTIONS}`,
  },
  {
    name: 'metta:execute',
    description: 'Run implementation for the active change',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
    body: `You are the **orchestrator** for implementation. Spawn executor subagents for each task.

## Steps

1. \`metta status --json\` → confirm implementation is ready
2. Read \`spec/changes/<change>/tasks.md\` for the task list
3. For each task in batch order, **spawn a subagent** with:
   - Persona: "You are an implementation engineer. Write clean, tested code."
   - Task description, files to modify, verification criteria from tasks.md
   - Instructions to run tests after implementation
   - Instructions to commit: \`git commit -m "feat(<change>): <task description>"\`
4. After all tasks, spawn a subagent to write \`spec/changes/<change>/summary.md\`
5. \`metta complete implementation --json --change <name>\`

## Deviation Rules (include in every executor subagent prompt)

- Bug found → fix + separate commit: \`fix(<change>): ...\`
- Missing utility → add + separate commit
- Blocked (>10 lines to fix) → STOP, report back to orchestrator
- Design is wrong → STOP immediately, report back to orchestrator`,
  },
  {
    name: 'metta:verify',
    description: 'Verify implementation against spec',
    allowedTools: ['Read', 'Write', 'Bash', 'Grep', 'Glob', 'Agent'],
    body: `You are the **orchestrator** for verification. Spawn a verifier subagent.

## Steps

1. \`metta verify --json --change <name>\` → runs gates, returns results
2. **Spawn a verifier subagent** with:
   - Persona: "You are a verification engineer focused on spec compliance."
   - The spec from \`spec/changes/<change>/spec.md\`
   - The gate results
   - Task: check each Given/When/Then scenario against tests and code
   - Write results to \`spec/changes/<change>/summary.md\`
   - Commit: \`git commit -m "docs(<change>): verification summary"\`
3. \`metta complete verification --json --change <name>\``,
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
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
    body: `You are the **orchestrator** for a quick change (intent → implementation → verification).

## Steps

1. \`metta quick "$ARGUMENTS" --json\` → creates change with quick workflow
2. **Spawn proposer subagent** for the intent:
   \`metta instructions intent --json --change <name>\` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
3. \`metta complete intent --json --change <name>\` → advances to implementation
4. **Spawn executor subagent** for the implementation:
   - Persona: "You are an implementation engineer. Write clean, tested code."
   - Read the intent for context
   - Implement the change, run tests, commit code
   - Write \`spec/changes/<change>/summary.md\`, commit it
5. \`metta complete implementation --json --change <name>\`
6. Report to user what was done

${AGENT_LOOP_INSTRUCTIONS}`,
  },
  {
    name: 'metta:auto',
    description: 'Full lifecycle loop — discover, build, verify, ship',
    argumentHint: '<description of what to build>',
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
    body: `You are the **orchestrator** for the full Metta lifecycle. Spawn subagents for each phase.

## Steps

1. \`metta propose "$ARGUMENTS" --json\` → creates change
2. For each artifact, use the Agent Execution Pattern — spawn a subagent per artifact
3. For implementation: spawn executor subagents per task from tasks.md
4. Spawn verifier subagent to check spec compliance
5. \`metta finalize --json --change <name>\`
6. Report results to user

## Rules

- Ask discovery questions BEFORE writing spec — don't guess requirements
- Every subagent MUST write files to disk and git commit
- Every artifact MUST be followed by \`metta complete\` to advance workflow
- Deviation Rule 4: design is wrong → STOP, tell user

${AGENT_LOOP_INSTRUCTIONS}`,
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
