import { Command } from 'commander'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson } from '../helpers.js'
import { claudeCodeAdapter } from '../../delivery/claude-code-adapter.js'
import { installCommands } from '../../delivery/command-installer.js'

const execAsync = promisify(execFile)

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
          } else {
            if (json) {
              outputJson({
                status: 'git_missing',
                message: 'No git repository detected. Run with --git-init to create one, or run git init manually.',
              })
            } else {
              console.error('No git repository detected in this directory.')
              console.error('Run: metta init --git-init   (to create one automatically)')
              console.error('  or: git init               (to create one manually)')
            }
            process.exit(3)
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
        let isBrownfield = false
        if (!options.skipScan) {
          try {
            const srcStat = await stat(join(root, 'src'))
            isBrownfield = srcStat.isDirectory()
          } catch {
            // No src dir — greenfield
          }
        }

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

        if (json) {
          outputJson({
            status: 'initialized',
            mode: isBrownfield ? 'brownfield' : 'greenfield',
            git_initialized: gitInitialized,
            directories: ['.metta/', 'spec/'],
            constitution: 'spec/project.md',
            detected_tools: detectedTools,
            installed_commands: installedCommands,
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
          console.log('')
          console.log('Next: edit spec/project.md, then run metta propose')
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
