import { Command } from 'commander'
import { mkdir, writeFile, readFile, copyFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { createCliContext, outputJson } from '../helpers.js'
import { claudeCodeAdapter } from '../../delivery/claude-code-adapter.js'
import { installCommands } from '../../delivery/command-installer.js'

const execAsync = promisify(execFile)

async function installMettaGuardHook(root: string): Promise<void> {
  const hookDir = join(root, '.claude', 'hooks')
  const hookPath = join(hookDir, 'metta-guard-edit.mjs')
  const settingsPath = join(root, '.claude', 'settings.json')

  const templateHook = new URL('../../templates/hooks/metta-guard-edit.mjs', import.meta.url).pathname
  await mkdir(hookDir, { recursive: true })
  await copyFile(templateHook, hookPath)
  await chmod(hookPath, 0o755)

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, 'utf8')
    try {
      settings = JSON.parse(raw)
    } catch (err) {
      throw new Error(`.claude/settings.json exists but is not valid JSON — refusing to overwrite. Fix it and re-run metta install. Cause: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const rawHooks = settings.hooks
  const hooks: Record<string, unknown> = rawHooks && typeof rawHooks === 'object' && !Array.isArray(rawHooks)
    ? (rawHooks as Record<string, unknown>)
    : {}
  const rawPre = hooks.PreToolUse
  const preToolUse: Array<Record<string, unknown>> = Array.isArray(rawPre) ? rawPre : []
  const alreadyRegistered = preToolUse.some((entry) => {
    const hooksArr = Array.isArray(entry?.hooks) ? (entry.hooks as Array<Record<string, unknown>>) : []
    return hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes('metta-guard-edit.mjs'))
  })
  if (!alreadyRegistered) {
    preToolUse.push({
      matcher: 'Edit|Write|NotebookEdit|MultiEdit',
      hooks: [{ type: 'command', command: '.claude/hooks/metta-guard-edit.mjs' }],
    })
    hooks.PreToolUse = preToolUse
    settings.hooks = hooks
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  }
}

async function installMettaBashGuardHook(root: string): Promise<void> {
  const hookDir = join(root, '.claude', 'hooks')
  const hookPath = join(hookDir, 'metta-guard-bash.mjs')
  const settingsPath = join(root, '.claude', 'settings.json')

  const templateHook = new URL('../../templates/hooks/metta-guard-bash.mjs', import.meta.url).pathname
  await mkdir(hookDir, { recursive: true })
  await copyFile(templateHook, hookPath)
  await chmod(hookPath, 0o755)

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, 'utf8')
    try {
      settings = JSON.parse(raw)
    } catch (err) {
      throw new Error(`.claude/settings.json exists but is not valid JSON — refusing to overwrite. Fix it and re-run metta install. Cause: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const rawHooks = settings.hooks
  const hooks: Record<string, unknown> = rawHooks && typeof rawHooks === 'object' && !Array.isArray(rawHooks)
    ? (rawHooks as Record<string, unknown>)
    : {}
  const rawPre = hooks.PreToolUse
  const preToolUse: Array<Record<string, unknown>> = Array.isArray(rawPre) ? rawPre : []
  const alreadyRegistered = preToolUse.some((entry) => {
    const hooksArr = Array.isArray(entry?.hooks) ? (entry.hooks as Array<Record<string, unknown>>) : []
    return hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes('metta-guard-bash.mjs'))
  })
  if (!alreadyRegistered) {
    preToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '.claude/hooks/metta-guard-bash.mjs' }],
    })
    hooks.PreToolUse = preToolUse
    settings.hooks = hooks
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  }
}

async function installMettaStatusline(root: string): Promise<void> {
  const statuslineDir = join(root, '.claude', 'statusline')
  const statuslinePath = join(statuslineDir, 'statusline.mjs')
  const settingsPath = join(root, '.claude', 'settings.json')
  const installedCmd = '.claude/statusline/statusline.mjs'

  const templateScript = new URL('../../templates/statusline/statusline.mjs', import.meta.url).pathname
  await mkdir(statuslineDir, { recursive: true })
  await copyFile(templateScript, statuslinePath)
  await chmod(statuslinePath, 0o755)

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    const raw = await readFile(settingsPath, 'utf8')
    try {
      settings = JSON.parse(raw)
    } catch (err) {
      throw new Error(`.claude/settings.json exists but is not valid JSON — refusing to overwrite. Fix it and re-run metta install. Cause: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const existing = settings.statusLine
  if (existing !== undefined) {
    const existingCmd = (existing as Record<string, unknown>)?.command
    if (typeof existingCmd === 'string' && existingCmd === installedCmd) {
      return
    }
    process.stderr.write(
      `Warning: statusLine already set in .claude/settings.json (${JSON.stringify(existingCmd ?? existing)}) — skipping. Remove it manually to let metta manage it.\n`
    )
    return
  }

  settings.statusLine = { type: 'command', command: installedCmd, padding: 0 }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}

function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== 'n')
    })
  })
}

type StackName = 'rust' | 'go' | 'python' | 'js'
const SCAFFOLD_STACKS = new Set<StackName>(['rust', 'go', 'python'])
const STACK_PRIORITY: StackName[] = ['rust', 'go', 'python', 'js']
const VALID_STACKS = new Set<string>(['rust', 'go', 'python', 'js'])

/**
 * Resolve the list of stacks for the install run.
 * - '--stack skip' → the literal 'skip' (sentinel)
 * - '--stack <csv>' → the parsed list; 'invalid' if any entry is unknown
 * - no flag → auto-detect from marker files in projectRoot
 */
function resolveStacksFromFlagOrMarkers(stackFlag: string | undefined, root: string): StackName[] | 'skip' | 'invalid' {
  if (stackFlag !== undefined) {
    if (stackFlag.trim() === 'skip') return 'skip'
    const parts = stackFlag.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return 'invalid'
    for (const p of parts) {
      if (!VALID_STACKS.has(p)) return 'invalid'
    }
    // Reorder per STACK_PRIORITY so multi-stack commentary is stable
    const ordered = STACK_PRIORITY.filter((s) => parts.includes(s)) as StackName[]
    return ordered
  }
  const detected: StackName[] = []
  if (existsSync(join(root, 'Cargo.toml'))) detected.push('rust')
  if (existsSync(join(root, 'go.mod'))) detected.push('go')
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'requirements.txt'))) detected.push('python')
  if (existsSync(join(root, 'package.json'))) detected.push('js')
  return STACK_PRIORITY.filter((s) => detected.includes(s)) as StackName[]
}

/**
 * Write or upgrade `.metta/config.yaml` to include the detected stacks.
 */
async function writeStacksToConfig(root: string, stacks: StackName[]): Promise<void> {
  const configPath = join(root, '.metta', 'config.yaml')
  let raw: string
  try {
    raw = await readFile(configPath, 'utf8')
  } catch {
    // Config doesn't exist yet (should have been created earlier in install)
    return
  }
  // Replace `stack: ""` line if present, else inject a `stacks:` line under `project:`.
  const stacksLine = `  stacks: [${stacks.map((s) => `"${s}"`).join(', ')}]`
  const lines = raw.split('\n')
  const stackIdx = lines.findIndex((l) => /^\s*stack:\s*"/.test(l))
  if (stackIdx !== -1) {
    // Replace the legacy single-string `stack:` line with the new array form.
    lines.splice(stackIdx, 1, stacksLine)
  } else {
    // Append under `project:` block — find the project: line and insert after
    // the last indented child of it.
    const projIdx = lines.findIndex((l) => l.startsWith('project:'))
    if (projIdx !== -1) {
      let insertAt = projIdx + 1
      while (insertAt < lines.length && lines[insertAt].startsWith('  ')) {
        insertAt++
      }
      lines.splice(insertAt, 0, stacksLine)
    } else {
      // Fallback: append a new project block
      lines.push('project:', stacksLine)
    }
  }
  await writeFile(configPath, lines.join('\n'), 'utf8')
}

/**
 * Copy the 4 gate YAMLs from dist/templates/gate-scaffolds/<primary>/
 * into <root>/.metta/gates/. Never overwrite existing files.
 * For multi-stack projects, prepend a comment block naming the other stacks.
 */
async function scaffoldGateYamls(root: string, primary: StackName, allStacks: StackName[]): Promise<string[]> {
  const scaffoldDir = new URL(`../../templates/gate-scaffolds/${primary}`, import.meta.url).pathname
  const gatesDir = join(root, '.metta', 'gates')
  await mkdir(gatesDir, { recursive: true })

  const others = allStacks.filter((s) => s !== primary)
  const commentHeader = others.length > 0
    ? [
        `# Multi-stack project detected: ${primary} (primary), ${others.join(', ')}`,
        `# To run all toolchains, edit 'command:' to chain them, e.g. 'cargo test && pytest'`,
        `# or remove this gate and add a per-stack file.`,
        '',
      ].join('\n')
    : ''

  const names = ['tests', 'lint', 'typecheck', 'build']
  const written: string[] = []
  for (const name of names) {
    const src = join(scaffoldDir, `${name}.yaml`)
    const dest = join(gatesDir, `${name}.yaml`)
    if (existsSync(dest)) continue // never overwrite
    let content = await readFile(src, 'utf8')
    if (commentHeader) content = commentHeader + content
    await writeFile(dest, content, 'utf8')
    written.push(`${name}.yaml`)
  }
  return written
}

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install Metta into a project')
    .option('--git-init', 'Initialize a git repo if one is not detected')
    .option('--stack <spec>', 'Override stack detection: rust|python|go|js|skip (comma-separated for multi-stack)')
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

        // Create directories (only essential ones — others created on demand)
        await mkdir(join(root, '.metta'), { recursive: true })
        await mkdir(join(root, 'spec', 'specs'), { recursive: true })
        await mkdir(join(root, 'spec', 'changes'), { recursive: true })
        await mkdir(join(root, 'spec', 'archive'), { recursive: true })

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

        // Detect project stack and scaffold .metta/gates/ for non-JS projects.
        const stacks = resolveStacksFromFlagOrMarkers(options.stack, root)
        if (stacks === 'invalid') {
          throw new Error(`Invalid --stack value. Supported: rust, python, go, js, skip (or comma-separated like 'rust,python').`)
        }

        let scaffoldedGates: string[] = []
        if (stacks !== 'skip' && stacks.length > 0) {
          await writeStacksToConfig(root, stacks)
          const primary = stacks[0]
          if (primary !== 'js' && SCAFFOLD_STACKS.has(primary)) {
            scaffoldedGates = await scaffoldGateYamls(root, primary, stacks)
          }
        } else if (stacks !== 'skip' && stacks.length === 0) {
          // No markers detected — print a hint for manual override.
          if (!json) {
            console.log('  No stack markers detected. To customize gate commands, drop YAML files in .metta/gates/ (see docs/getting-started.md).')
          }
        }

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

        // Install Claude Code PreToolUse guard hook + settings.json entry
        let guardInstalled = false
        try {
          await installMettaGuardHook(root)
          guardInstalled = true
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`Warning: failed to install metta-guard hook — ${message}`)
        }

        // Install Claude Code PreToolUse Bash guard hook + settings.json entry
        let bashGuardInstalled = false
        try {
          await installMettaBashGuardHook(root)
          bashGuardInstalled = true
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`Warning: failed to install metta-guard-bash hook — ${message}`)
        }

        // Install Claude Code statusline
        let statuslineInstalled = false
        try {
          await installMettaStatusline(root)
          statuslineInstalled = true
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`Warning: failed to install statusline — ${message}`)
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

        if (json) {
          outputJson({
            status: 'initialized',
            git_initialized: gitInitialized,
            committed,
            directories: ['.metta/', 'spec/'],
            constitution: 'spec/project.md',
            detected_tools: detectedTools,
            installed_commands: installedCommands,
            guard_hook_installed: guardInstalled,
            bash_guard_hook_installed: bashGuardInstalled,
            statusline_installed: statuslineInstalled,
            stacks: stacks === 'skip' ? [] : stacks,
            scaffolded_gates: scaffoldedGates,
          })
        } else {
          console.log('Metta initialized')
          if (gitInitialized) {
            console.log('  Initialized: git repository')
          }
          console.log('  Created: .metta/')
          console.log('  Created: spec/')
          console.log('  Created: spec/project.md (constitution)')
          if (stacks !== 'skip' && stacks.length > 0) {
            console.log(`  Detected stack${stacks.length > 1 ? 's' : ''}: ${stacks.join(', ')}`)
            if (scaffoldedGates.length > 0) {
              console.log(`  Scaffolded: ${scaffoldedGates.length} gate YAML${scaffoldedGates.length > 1 ? 's' : ''} in .metta/gates/`)
            }
          }
          if (detectedTools.length > 0) {
            console.log(`  Detected: ${detectedTools.join(', ')}`)
            console.log(`  Installed: ${installedCommands.length} slash commands`)
          }
          if (guardInstalled) {
            console.log('  Installed: PreToolUse guard hook (.claude/hooks/metta-guard-edit.mjs)')
          }
          if (bashGuardInstalled) {
            console.log('  Installed: PreToolUse Bash guard hook (.claude/hooks/metta-guard-bash.mjs)')
          }
          if (statuslineInstalled) {
            console.log('  Installed: statusline (.claude/statusline/statusline.mjs)')
          }
          if (committed) {
            console.log('  Committed: initial metta setup')
          }
          console.log('')
          console.log('Next: run `metta init` to discover project context')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'install_error', message } })
        } else {
          console.error(`Install failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

export { installMettaStatusline }
