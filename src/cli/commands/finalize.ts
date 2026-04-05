import { Command } from 'commander'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'
import { Finalizer } from '../../finalize/finalizer.js'

export function registerFinalizeCommand(program: Command): void {
  program
    .command('finalize')
    .description('Archive, merge specs, generate docs, refresh context')
    .argument('[change]', 'Change name')
    .option('--dry-run', 'Preview what would change')
    .action(async (changeName, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const name = changeName ?? (changes.length === 1 ? changes[0] : null)
        if (!name) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}`)

        const finalizer = new Finalizer(
          join(ctx.projectRoot, 'spec'),
          ctx.artifactStore,
          ctx.specLockManager,
        )

        const result = await finalizer.finalize(name, options.dryRun)

        if (result.specMerge.status === 'conflict') {
          if (json) {
            outputJson({
              status: 'conflict',
              conflicts: result.specMerge.conflicts,
              message: 'Resolve conflicts before finalizing',
            })
          } else {
            console.error('Spec merge conflicts detected:')
            for (const c of result.specMerge.conflicts) {
              console.error(`  ${c.capability}/${c.requirementId}: ${c.reason}`)
            }
            console.error('\nResolve conflicts and retry.')
          }
          process.exit(2)
        }

        if (json) {
          outputJson({
            status: options.dryRun ? 'dry_run' : 'finalized',
            change: name,
            archive: result.archiveName,
            merged: result.specMerge.merged,
          })
        } else {
          if (options.dryRun) {
            console.log('Dry run:')
            console.log(`  Would archive: ${name}`)
            console.log(`  Would merge: ${result.specMerge.merged.join(', ') || 'nothing'}`)
          } else {
            console.log(`Finalized: ${name}`)
            console.log(`  Archived as: ${result.archiveName}`)
            console.log(`  Specs merged: ${result.specMerge.merged.join(', ') || 'none'}`)
            console.log('\nNext: run metta ship to merge to main')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'finalize_error', message } }) } else { console.error(`Finalize failed: ${message}`) }
        process.exit(4)
      }
    })
}
