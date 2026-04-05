import { Command } from 'commander'
import { createCliContext, outputJson, color } from '../helpers.js'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current change status')
    .argument('[change]', 'Change name')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()

        if (changes.length === 0) {
          if (json) {
            outputJson({ changes: [], message: 'No active changes' })
          } else {
            console.log('No active changes. Run metta propose to start.')
          }
          return
        }

        if (changeName) {
          const metadata = await ctx.artifactStore.getChange(changeName)
          if (json) {
            outputJson({ change: changeName, ...metadata })
          } else {
            printChangeStatus(changeName, metadata)
          }
          return
        }

        if (changes.length === 1) {
          const metadata = await ctx.artifactStore.getChange(changes[0])
          if (json) {
            outputJson({ change: changes[0], ...metadata })
          } else {
            printChangeStatus(changes[0], metadata)
          }
          return
        }

        // Multiple changes
        const allStatuses = []
        for (const name of changes) {
          const metadata = await ctx.artifactStore.getChange(name)
          allStatuses.push({ change: name, ...metadata })
        }

        if (json) {
          outputJson({ changes: allStatuses })
        } else {
          for (const s of allStatuses) {
            printChangeStatus(s.change, s)
            console.log('')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'status_error', message } })
        } else {
          console.error(`Status failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

function printChangeStatus(name: string, metadata: { workflow: string; status: string; current_artifact: string; artifacts: Record<string, string> }): void {
  console.log(`Change: ${color(name, 36)} (${color(metadata.workflow + ' workflow', 90)})`)
  console.log(`Status: ${metadata.status}`)
  console.log('')
  console.log('Artifacts:')
  for (const [id, status] of Object.entries(metadata.artifacts)) {
    const marker =
      status === 'complete' ? color('✓', 32) :
      status === 'in_progress' ? color('→', 33) :
      status === 'ready' ? color('▸', 36) :
      status === 'failed' ? color('✗', 31) :
      color('·', 90)
    console.log(`  ${marker} ${id.padEnd(20)} ${status}`)
  }
}
