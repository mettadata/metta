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

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install Metta into a project')
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
            statusline_installed: statuslineInstalled,
          })
        } else {
          console.log('Metta initialized')
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
          if (guardInstalled) {
            console.log('  Installed: PreToolUse guard hook (.claude/hooks/metta-guard-edit.mjs)')
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
