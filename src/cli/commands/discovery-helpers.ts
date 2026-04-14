import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { stat, readdir } from 'node:fs/promises'

export const BROWNFIELD_MARKERS = [
  'src', 'app', 'lib', 'pkg', 'cmd', 'internal',
]

export const STACK_FILES: Record<string, string> = {
  'package.json': 'Node.js / JavaScript / TypeScript',
  'Cargo.toml': 'Rust',
  'go.mod': 'Go',
  'requirements.txt': 'Python',
  'pyproject.toml': 'Python',
  'Gemfile': 'Ruby',
  'build.gradle': 'Java / Kotlin (Gradle)',
  'pom.xml': 'Java (Maven)',
  'composer.json': 'PHP',
  'mix.exs': 'Elixir',
  'Package.swift': 'Swift',
}

export async function detectBrownfield(root: string, skipScan: boolean): Promise<{
  isBrownfield: boolean
  detectedStack: string[]
  detectedDirs: string[]
}> {
  if (skipScan) return { isBrownfield: false, detectedStack: [], detectedDirs: [] }

  const detectedStack: string[] = []
  const detectedDirs: string[] = []

  // Check for stack marker files
  for (const [file, stack] of Object.entries(STACK_FILES)) {
    if (existsSync(join(root, file))) {
      detectedStack.push(stack)
    }
  }

  // Check for source directories
  for (const dir of BROWNFIELD_MARKERS) {
    try {
      const s = await stat(join(root, dir))
      if (s.isDirectory()) {
        const entries = await readdir(join(root, dir))
        if (entries.length > 0) detectedDirs.push(dir)
      }
    } catch {
      // Not found
    }
  }

  const isBrownfield = detectedStack.length > 0 || detectedDirs.length > 0

  return { isBrownfield, detectedStack, detectedDirs }
}

export function buildDiscoveryInstructions(
  root: string,
  isBrownfield: boolean,
  detectedStack: string[],
  detectedDirs: string[],
): {
  agent: { name: string; persona: string; tools: string[] }
  mode: 'brownfield' | 'greenfield'
  detected: { stack: string[]; directories: string[] }
  questions: Array<{ id: string; question: string; hint: string }>
  output_paths: { constitution: string; context_file: string; config: string }
  constitution_template: string
  context_template: string
} {
  const projectName = root.split('/').pop() ?? 'project'

  const greenfieldQuestions = [
    { id: 'description', question: 'What does this project do?', hint: 'One clear paragraph — what it is, who it serves, why it exists' },
    { id: 'stack', question: "What's the tech stack?", hint: 'Languages, frameworks, databases, key dependencies' },
    { id: 'conventions', question: 'What coding conventions matter most?', hint: 'Naming, file structure, component patterns, import style' },
    { id: 'constraints', question: 'Any architectural constraints?', hint: 'Hard limits, banned patterns, technology choices' },
    { id: 'quality', question: 'Quality standards?', hint: 'Test coverage targets, accessibility, performance budgets' },
    { id: 'off_limits', question: "What's off-limits?", hint: 'Banned operations, security constraints, anti-patterns' },
  ]

  const brownfieldQuestions = [
    { id: 'corrections', question: 'Anything to add or correct from what I detected?', hint: 'Review the inferred stack and conventions above' },
    { id: 'constraints', question: 'Any architectural constraints not visible in the code?', hint: 'Decisions made for business/compliance/performance reasons' },
    { id: 'off_limits', question: "What's off-limits?", hint: 'Banned operations, patterns being migrated away from' },
  ]

  return {
    agent: {
      name: 'discoverer',
      persona: 'You are a senior technical interviewer and project architect. Understand this project through conversation, then generate a project constitution and AI context file.',
      tools: ['Read', 'Write', 'Grep', 'Glob', 'Bash', 'AskUserQuestion'],
    },
    mode: isBrownfield ? 'brownfield' : 'greenfield',
    detected: { stack: detectedStack, directories: detectedDirs },
    questions: isBrownfield ? brownfieldQuestions : greenfieldQuestions,
    output_paths: {
      constitution: join(root, 'spec', 'project.md'),
      context_file: join(root, 'CLAUDE.md'),
      config: join(root, '.metta', 'config.yaml'),
    },
    constitution_template: `# ${projectName} — Project Constitution

## Project
{description}

## Stack
{stack}

## Conventions
{conventions}

## Architectural Constraints
{constraints}

## Quality Standards
{quality}

## Off-Limits
{off_limits}
`,
    context_template: `# ${projectName}

<!-- metta:project-start source:spec/project.md -->
## Project

**${projectName}** — {short_description}

Stack: {stack_summary}
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

{conventions_list}
<!-- metta:conventions-end -->

<!-- metta:workflow-start -->
## Metta Workflow

Use these entry points:
- \`metta propose <description>\` for new features
- \`metta quick <description>\` for small fixes
- \`metta auto <description>\` for full lifecycle
- \`metta status --json\` for current state
<!-- metta:workflow-end -->
`,
  }
}
