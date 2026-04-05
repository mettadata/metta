import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerChangesCommand(program: Command): void {
  const changes = program
    .command('changes')
    .description('Manage active changes')

  changes
    .command('list')
    .description('List active changes')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const list = await ctx.artifactStore.listChanges()
      if (json) { outputJson({ changes: list }) } else {
        if (list.length === 0) { console.log('No active changes.') } else {
          for (const name of list) {
            const metadata = await ctx.artifactStore.getChange(name)
            console.log(`  ${name.padEnd(30)} ${metadata.workflow.padEnd(12)} ${metadata.status}`)
          }
        }
      }
    })

  changes
    .command('show')
    .argument('<name>', 'Change name')
    .description('Show change details')
    .action(async (name) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const metadata = await ctx.artifactStore.getChange(name)
        if (json) {
          outputJson({ change: name, ...metadata })
        } else {
          console.log(`Change: ${name}`)
          console.log(`  Workflow: ${metadata.workflow}`)
          console.log(`  Status: ${metadata.status}`)
          console.log(`  Created: ${metadata.created}`)
          for (const [id, status] of Object.entries(metadata.artifacts)) {
            console.log(`  ${id}: ${status}`)
          }
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Change '${name}' not found` } }) } else { console.error(`Change '${name}' not found`) }
        process.exit(4)
      }
    })

  changes
    .command('abandon')
    .argument('<name>', 'Change name')
    .option('--force', 'Skip confirmation')
    .description('Abandon a change')
    .action(async (name, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const archiveName = await ctx.artifactStore.abandon(name)
        if (json) {
          outputJson({ abandoned: name, archived_as: archiveName })
        } else {
          console.log(`Change '${name}' abandoned. Archived as: ${archiveName}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'abandon_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
