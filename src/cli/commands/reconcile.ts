import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'
import { join } from 'node:path'

export function registerReconcileCommand(program: Command): void {
  program
    .command('reconcile')
    .description('Re-run reconciliation and update gap files')
    .option('--dry-run', 'Preview without writing gap files')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const specsDir = join('spec', 'specs')
        const gapsDir = join('spec', 'gaps')

        const result = {
          specs_dir: specsDir,
          gaps_dir: gapsDir,
          dry_run: !!options.dryRun,
          instructions: {
            agent_type: 'metta-researcher',
            steps: [
              `Read all specs from ${specsDir}`,
              'For each requirement in each spec:',
              '  - Search codebase for implementing code (functions, routes, tests)',
              '  - Check if implementation matches spec requirements',
              '  - Mark as: verified, partial, missing, or diverged',
              `Write/update gap files in ${gapsDir}/ for any issues found`,
              'Remove gap files for issues that are now resolved',
              'Report reconciliation summary',
            ],
          },
        }

        if (json) {
          outputJson(result)
        } else {
          console.log('Reconciliation')
          console.log(`Specs: ${specsDir}`)
          console.log(`Gaps:  ${gapsDir}`)
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
        if (json) { outputJson({ error: { code: 4, type: 'reconcile_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
