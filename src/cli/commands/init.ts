import { Command } from 'commander'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize project with Metta')
    .option('--skip-scan', 'Force greenfield-style init')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const root = ctx.projectRoot

      try {
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

        if (json) {
          outputJson({
            status: 'initialized',
            mode: isBrownfield ? 'brownfield' : 'greenfield',
            directories: ['.metta/', 'spec/'],
            constitution: 'spec/project.md',
          })
        } else {
          console.log(`Metta initialized (${isBrownfield ? 'brownfield' : 'greenfield'} mode)`)
          console.log('  Created: .metta/')
          console.log('  Created: spec/')
          console.log('  Created: spec/project.md (constitution)')
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
