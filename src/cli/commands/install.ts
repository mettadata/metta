import { Command } from 'commander'
import { mkdir, writeFile, readFile, copyFile, chmod, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, getErrorMessage, askYesNo, getPackageVersion } from '../helpers.js'
import { installCommands } from '../../delivery/command-installer.js'
import { setProjectField } from '../../config/config-writer.js'
import { stampInstalledVersion } from '../../config/version-drift.js'

const execAsync = promisify(execFile)

/**
 * Read and parse a `.claude/settings.json` file. Returns an empty object when
 * the file does not exist. Throws a descriptive error (rather than silently
 * overwriting) when the file exists but contains invalid JSON.
 */
async function readSettingsJson(settingsPath: string): Promise<Record<string, unknown>> {
  if (!existsSync(settingsPath)) return {}
  const raw = await readFile(settingsPath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`.claude/settings.json exists but is not valid JSON — refusing to overwrite. Fix it and re-run metta install. Cause: ${getErrorMessage(err)}`)
  }
}

/**
 * Copy every file in `src/templates/hooks/` into `<root>/.claude/hooks/`,
 * preserving executable bits. Enumerating the templates directory (rather
 * than hardcoding filenames) guarantees any hook added to the templates dir
 * ships with zero installer changes — mirrors the readdir-driven pattern in
 * `src/delivery/command-installer.ts`. Copies unconditionally overwrite
 * (hooks are metta-owned assets, same as skills/agents), so re-running
 * install repairs a project that is missing hooks added since its last
 * install.
 */
async function installMettaHooks(root: string): Promise<string[]> {
  const hookDir = join(root, '.claude', 'hooks')
  const templatesHooksDir = new URL('../../templates/hooks/', import.meta.url).pathname
  await mkdir(hookDir, { recursive: true })

  const entries = await readdir(templatesHooksDir, { withFileTypes: true })
  const installed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const src = join(templatesHooksDir, entry.name)
    const dest = join(hookDir, entry.name)
    await copyFile(src, dest)
    await chmod(dest, 0o755)
    installed.push(entry.name)
  }
  return installed
}

async function registerGuardEditHook(root: string): Promise<void> {
  const settingsPath = join(root, '.claude', 'settings.json')
  const settings = await readSettingsJson(settingsPath)

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

async function registerGuardBashHook(root: string): Promise<void> {
  const settingsPath = join(root, '.claude', 'settings.json')
  const settings = await readSettingsJson(settingsPath)

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

async function registerTokensRecordHook(root: string): Promise<void> {
  const settingsPath = join(root, '.claude', 'settings.json')
  const settings = await readSettingsJson(settingsPath)

  const rawHooks = settings.hooks
  const hooks: Record<string, unknown> = rawHooks && typeof rawHooks === 'object' && !Array.isArray(rawHooks)
    ? (rawHooks as Record<string, unknown>)
    : {}
  const rawStop = hooks.SubagentStop
  const subagentStop: Array<Record<string, unknown>> = Array.isArray(rawStop) ? rawStop : []
  const alreadyRegistered = subagentStop.some((entry) => {
    const hooksArr = Array.isArray(entry?.hooks) ? (entry.hooks as Array<Record<string, unknown>>) : []
    return hooksArr.some((h) => typeof h?.command === 'string' && h.command.includes('metta-tokens-record.mjs'))
  })
  if (!alreadyRegistered) {
    subagentStop.push({
      hooks: [{ type: 'command', command: '.claude/hooks/metta-tokens-record.mjs' }],
    })
    hooks.SubagentStop = subagentStop
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

  const settings = await readSettingsJson(settingsPath)

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
  await setProjectField(root, ['project', 'stacks'], stacks)
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
            const shouldInit = await askYesNo('No git repository detected. Initialize one? [Y/n]', {
              defaultYes: true,
              jsonMode: json,
            })
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

        // Create minimal config. The release block requires a detectable
        // version file (ReleaseConfigSchema is strict and mandates
        // scheme + version_file), so it is scaffolded only when package.json
        // exists; other projects keep the absent-config skip behavior.
        const releaseBlock = existsSync(join(root, 'package.json'))
          ? `release:
  scheme: semver
  version_file: package.json
  github_release: false
  # Ship-path skills cut a release automatically after each merged ship;
  # set prompt to be asked each time, or off for on-demand /metta-release only.
  on_ship: auto
`
          : ''
        const configContent = `project:
  name: "${root.split('/').pop()}"
  description: ""
  stack: ""
models:
  # Model-tier routing: planning/review always top-tier; executors on
  # trivial/quick changes run sonnet. Alternatives: quality (all top-tier), budget (haiku/sonnet).
  profile: balanced
uat:
  # Ship-path skills run the archived UAT.md before hand-back; set false to opt out.
  enforce_on_ship: true
${releaseBlock}`
        await writeFile(join(root, '.metta', 'config.yaml'), configContent, { flag: 'wx' }).catch(() => {
          // Config already exists
        })

        // Stamp the running binary version. Always re-stamp — re-running install
        // after an upgrade/downgrade is the documented way to clear drift.
        await stampInstalledVersion(root, await getPackageVersion())

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

        // Create .gitignore entries. This file lives at .metta/.gitignore, so
        // patterns must be relative to the .metta/ directory itself: a pattern
        // containing a non-trailing slash (like `.metta/state.yaml`) is anchored
        // to the .gitignore's own directory and would only match
        // `.metta/.metta/state.yaml` — i.e. nothing.
        const gitignoreContent = `state.yaml
local.yaml
logs/
state.lock
scratch/
`
        // Best-effort write with the exclusive `wx` flag: if .metta/.gitignore
        // already exists from a prior install run, the EEXIST is expected and we
        // intentionally leave the existing file untouched.
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
          const installed = await installCommands(root)
          installedCommands.push(...installed)
        } else {
          // Create .claude dir and install by default since it's v0.1 Claude Code only
          await mkdir(join(root, '.claude'), { recursive: true })
          detectedTools.push('Claude Code')
          const installed = await installCommands(root)
          installedCommands.push(...installed)
        }

        // Install every Claude Code hook from src/templates/hooks/ (readdir-driven —
        // any hook added to the templates dir is deployed with zero installer changes).
        let hooksInstalled: string[] = []
        try {
          hooksInstalled = await installMettaHooks(root)
        } catch (err) {
          const message = getErrorMessage(err)
          console.error(`Warning: failed to install metta hooks — ${message}`)
        }

        // Register settings.json entries for hooks that require them. Three
        // hooks are settings-registered: metta-guard-edit and metta-guard-bash
        // (PreToolUse) plus metta-tokens-record (SubagentStop — Claude Code
        // only fires SubagentStop hooks that are settings-registered).
        // metta-session-mint and metta-guard-agent-dispatch are
        // frontmatter-scoped by design and must not be registered here.
        let guardInstalled = false
        if (hooksInstalled.includes('metta-guard-edit.mjs')) {
          try {
            await registerGuardEditHook(root)
            guardInstalled = true
          } catch (err) {
            const message = getErrorMessage(err)
            console.error(`Warning: failed to register metta-guard hook — ${message}`)
          }
        }

        // Register the PreToolUse Bash guard hook + settings.json entry
        let bashGuardInstalled = false
        if (hooksInstalled.includes('metta-guard-bash.mjs')) {
          try {
            await registerGuardBashHook(root)
            bashGuardInstalled = true
          } catch (err) {
            const message = getErrorMessage(err)
            console.error(`Warning: failed to register metta-guard-bash hook — ${message}`)
          }
        }

        // Register the SubagentStop tokens-record hook + settings.json entry
        let tokensRecordInstalled = false
        if (hooksInstalled.includes('metta-tokens-record.mjs')) {
          try {
            await registerTokensRecordHook(root)
            tokensRecordInstalled = true
          } catch (err) {
            const message = getErrorMessage(err)
            console.error(`Warning: failed to register metta-tokens-record hook — ${message}`)
          }
        }

        // Install Claude Code statusline
        let statuslineInstalled = false
        try {
          await installMettaStatusline(root)
          statuslineInstalled = true
        } catch (err) {
          const message = getErrorMessage(err)
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
            hooks_installed: hooksInstalled,
            guard_hook_installed: guardInstalled,
            bash_guard_hook_installed: bashGuardInstalled,
            tokens_record_hook_installed: tokensRecordInstalled,
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
          if (hooksInstalled.length > 0) {
            console.log(`  Installed: ${hooksInstalled.length} hook${hooksInstalled.length > 1 ? 's' : ''} (.claude/hooks/)`)
          }
          if (guardInstalled) {
            console.log('  Installed: PreToolUse guard hook (.claude/hooks/metta-guard-edit.mjs)')
          }
          if (bashGuardInstalled) {
            console.log('  Installed: PreToolUse Bash guard hook (.claude/hooks/metta-guard-bash.mjs)')
          }
          if (tokensRecordInstalled) {
            console.log('  Installed: SubagentStop tokens-record hook (.claude/hooks/metta-tokens-record.mjs)')
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
        const message = getErrorMessage(err)
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
