import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Build next planning artifacts')
    .argument('[change]', 'Change name (required if multiple active)')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const name = changeName ?? await resolveActiveChange(ctx)
        const metadata = await ctx.artifactStore.getChange(name)

        if (json) {
          outputJson({
            change: name,
            workflow: metadata.workflow,
            artifacts: metadata.artifacts,
            current: metadata.current_artifact,
          })
        } else {
          console.log(`Plan for: ${name}`)
          console.log(`  Workflow: ${metadata.workflow}`)
          console.log(`  Current: ${metadata.current_artifact}`)
          for (const [id, status] of Object.entries(metadata.artifacts)) {
            const marker = status === 'complete' ? '✓' : status === 'in_progress' ? '→' : '·'
            console.log(`  ${marker} ${id}: ${status}`)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'plan_error', message } })
        } else {
          console.error(`Plan failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

async function resolveActiveChange(ctx: ReturnType<typeof createCliContext>): Promise<string> {
  const changes = await ctx.artifactStore.listChanges()
  if (changes.length === 0) throw new Error('No active changes. Run metta propose first.')
  if (changes.length === 1) return changes[0]
  throw new Error(`Multiple active changes: ${changes.join(', ')}. Specify which one.`)
}
