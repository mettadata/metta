import { Command } from 'commander'
import { mkdir, writeFile, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { createCliContext, outputJson } from '../helpers.js'
import { claudeCodeAdapter } from '../../delivery/claude-code-adapter.js'
import { installCommands } from '../../delivery/command-installer.js'

const execAsync = promisify(execFile)

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== 'n')
    })
  })
}

const BROWNFIELD_MARKERS = [
  'src', 'app', 'lib', 'pkg', 'cmd', 'internal',
]

const STACK_FILES: Record<string, string> = {
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

async function detectBrownfield(root: string, skipScan: boolean): Promise<{
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

export function registerInitCommand(program: Command): void {
  program
    .command('install')
    .alias('init')
    .description('Install Metta into a project')
    .option('--skip-scan', 'Force greenfield-style init')
    .option('--git-init', 'Initialize a git repo if one is not detected')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const root = ctx.projectRoot

      try {
        // Check for git repo
        let gitInitialized = false
        const hasGit = existsSync(join(root, '.git'))
        if (!hasGit) {
          if (options.gitInit) {
            await execAsync('git', ['init'], { cwd: root })
            gitInitialized = true
          } else if (json) {
            outputJson({
              status: 'git_missing',
              message: 'No git repository detected. Run with --git-init to create one, or run git init manually.',
            })
            process.exit(3)
          } else {
            const shouldInit = await askYesNo('No git repository detected. Initialize one? [Y/n] ')
            if (shouldInit) {
              await execAsync('git', ['init'], { cwd: root })
              gitInitialized = true
            } else {
              console.error('Metta requires a git repository. Run git init manually to continue.')
              process.exit(3)
            }
          }
        }

        // Create directories
        await mkdir(join(root, '.metta'), { recursive: true })
        await mkdir(join(root, 'spec', 'specs'), { recursive: true })
        await mkdir(join(root, 'spec', 'changes'), { recursive: true })
        await mkdir(join(root, 'spec', 'archive'), { recursive: true })
        await mkdir(join(root, 'spec', 'ideas'), { recursive: true })
        await mkdir(join(root, 'spec', 'issues'), { recursive: true })
        await mkdir(join(root, 'spec', 'backlog'), { recursive: true })
        await mkdir(join(root, 'spec', 'gaps'), { recursive: true })

        // Detect brownfield
        const { isBrownfield, detectedStack, detectedDirs } = await detectBrownfield(root, options.skipScan)

        // Create minimal config
        const configContent = `project:
  name: "${root.split('/').pop()}"
  description: ""
  stack: ""
`
        await writeFile(join(root, '.metta', 'config.yaml'), configContent, { flag: 'wx' }).catch(() => {
          // Config already exists
        })

        // Create constitution template
        const constitutionContent = `# ${root.split('/').pop()} — Project Constitution

## Project
Description of your project.

## Stack
Languages, frameworks, dependencies.

## Conventions
Coding standards and patterns.

## Architectural Constraints
Hard limits and technology choices.

## Quality Standards
Coverage, accessibility, performance targets.

## Off-Limits
Banned patterns and forbidden operations.
`
        await writeFile(join(root, 'spec', 'project.md'), constitutionContent, { flag: 'wx' }).catch(() => {
          // Constitution already exists
        })

        // Create .gitignore entries
        const gitignoreContent = `.metta/state.yaml
.metta/local.yaml
.metta/logs/
.metta/state.lock
`
        await writeFile(join(root, '.metta', '.gitignore'), gitignoreContent, { flag: 'wx' }).catch(() => {})

        // Detect AI tools and install slash commands
        const detectedTools: string[] = []
        const installedCommands: string[] = []

        // Claude Code
        if (existsSync(join(root, '.claude')) || existsSync(join(root, 'CLAUDE.md'))) {
          detectedTools.push('Claude Code')
          const installed = await installCommands(claudeCodeAdapter, root)
          installedCommands.push(...installed)
        } else {
          // Create .claude dir and install by default since it's v0.1 Claude Code only
          await mkdir(join(root, '.claude'), { recursive: true })
          detectedTools.push('Claude Code')
          const installed = await installCommands(claudeCodeAdapter, root)
          installedCommands.push(...installed)
        }

        // Commit setup files
        let committed = false
        try {
          await execAsync('git', ['add', '.metta/', 'spec/'], { cwd: root })
          // Also stage .claude/ if it was created
          if (existsSync(join(root, '.claude'))) {
            await execAsync('git', ['add', '.claude/'], { cwd: root })
          }
          await execAsync('git', ['commit', '-m', 'chore: initialize metta'], { cwd: root })
          committed = true
        } catch {
          // Nothing to commit (files may already be tracked)
        }

        // Build discovery instructions for the AI agent
        const discovery = buildDiscoveryInstructions(root, isBrownfield, detectedStack, detectedDirs)

        if (json) {
          outputJson({
            status: 'initialized',
            mode: isBrownfield ? 'brownfield' : 'greenfield',
            git_initialized: gitInitialized,
            committed,
            directories: ['.metta/', 'spec/'],
            constitution: 'spec/project.md',
            detected_tools: detectedTools,
            installed_commands: installedCommands,
            discovery,
          })
        } else {
          console.log(`Metta initialized (${isBrownfield ? 'brownfield' : 'greenfield'} mode)`)
          if (gitInitialized) {
            console.log('  Initialized: git repository')
          }
          console.log('  Created: .metta/')
          console.log('  Created: spec/')
          console.log('  Created: spec/project.md (constitution)')
          if (detectedTools.length > 0) {
            console.log(`  Detected: ${detectedTools.join(', ')}`)
            console.log(`  Installed: ${installedCommands.length} slash commands`)
          }
          if (committed) {
            console.log('  Committed: initial metta setup')
          }
          console.log('')
          console.log('Next: run /metta:init to complete project discovery')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'init_error', message } })
        } else {
          console.error(`Init failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

function buildDiscoveryInstructions(
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
