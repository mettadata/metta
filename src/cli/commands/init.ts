import { Command } from 'commander'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createCliContext, outputJson } from '../helpers.js'
import { detectBrownfield, buildDiscoveryInstructions } from './discovery-helpers.js'

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Discover project context and emit discovery instructions')
    .option('--skip-scan', 'Force greenfield-style init')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const root = ctx.projectRoot

      // Precondition: metta install must have been run
      if (!existsSync(join(root, '.metta', 'config.yaml'))) {
        const message = 'No .metta/ directory found. Run `metta install` first.'
        if (json) {
          outputJson({
            error: {
              code: 3,
              type: 'metta_not_installed',
              message,
            },
          })
        } else {
          console.error(message)
        }
        process.exit(3)
      }

      try {
        const { isBrownfield, detectedStack, detectedDirs } = await detectBrownfield(root, options.skipScan)
        const discovery = buildDiscoveryInstructions(root, isBrownfield, detectedStack, detectedDirs)

        if (json) {
          outputJson({ discovery })
        } else {
          console.log(`Metta discovery (${isBrownfield ? 'brownfield' : 'greenfield'} mode)`)
          if (detectedStack.length > 0) {
            console.log(`  Detected stack: ${detectedStack.join(', ')}`)
          }
          if (detectedDirs.length > 0) {
            console.log(`  Detected directories: ${detectedDirs.join(', ')}`)
          }
          console.log('')
          console.log('Next: run `/metta:init` in Claude Code to run the interactive discovery interview')
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
