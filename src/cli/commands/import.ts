import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'
import { join } from 'node:path'

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import existing code into metta specs with gap reports')
    .argument('[target]', 'Capability name or directory to import')
    .option('--all', 'Import entire codebase')
    .option('--dry-run', 'Preview what would be generated without writing')
    .action(async (target, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (!target && !options.all) {
          if (json) {
            outputJson({ error: { code: 4, type: 'missing_arg', message: 'Specify a capability, directory, or use --all' } })
          } else {
            console.error('Usage: metta import <capability|directory> or metta import --all')
          }
          process.exit(4)
        }

        const capability = options.all ? 'all' : target
        const scanPaths = options.all
          ? [join(ctx.projectRoot, 'src')]
          : [join(ctx.projectRoot, 'src', target)]
        const specOutputDir = options.all
          ? join('spec', 'specs')
          : join('spec', 'specs', capability)
        const gapsOutputDir = join('spec', 'gaps')

        const result = {
          capability,
          scan_paths: scanPaths,
          output_paths: {
            specs: specOutputDir,
            gaps: gapsOutputDir,
          },
          dry_run: !!options.dryRun,
          instructions: {
            agent_type: 'metta-researcher',
            steps: [
              `Scan all files in: ${scanPaths.join(', ')}`,
              'Extract: routes, functions, types, models, tests, existing specs',
              'Identify capability boundaries',
              `Generate spec drafts in ${specOutputDir}/<capability>/spec.md`,
              'Run reconciliation against existing code',
              `Write gap files to ${gapsOutputDir}/ for any issues found`,
            ],
          },
        }

        if (json) {
          outputJson(result)
        } else {
          console.log(`Import: ${capability}`)
          console.log(`Scan paths: ${scanPaths.join(', ')}`)
          console.log(`Spec output: ${specOutputDir}`)
          console.log(`Gaps output: ${gapsOutputDir}`)
          if (options.dryRun) {
            console.log('\n[dry-run] No files will be written.')
          }
          console.log('\nSteps:')
          for (const step of result.instructions.steps) {
            console.log(`  - ${step}`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'import_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
