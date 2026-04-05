import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerExecuteCommand(program: Command): void {
  program
    .command('execute')
    .description('Run implementation')
    .argument('[change]', 'Change name')
    .option('--resume', 'Resume from last checkpoint')
    .action(async (changeName, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const name = changeName ?? await resolveActiveChange(ctx)
        const metadata = await ctx.artifactStore.getChange(name)

        if (json) {
          outputJson({
            change: name,
            workflow: metadata.workflow,
            status: metadata.status,
            resume: options.resume ?? false,
            message: 'Execution state tracked. Use metta instructions to get task guidance.',
          })
        } else {
          console.log(`Execute: ${name}`)
          console.log(`  Status: ${metadata.status}`)
          if (options.resume) {
            console.log('  Resuming from last checkpoint...')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'execute_error', message } })
        } else {
          console.error(`Execute failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

async function resolveActiveChange(ctx: ReturnType<typeof createCliContext>): Promise<string> {
  const changes = await ctx.artifactStore.listChanges()
  if (changes.length === 0) throw new Error('No active changes.')
  if (changes.length === 1) return changes[0]
  throw new Error(`Multiple active changes: ${changes.join(', ')}. Specify which one.`)
}
