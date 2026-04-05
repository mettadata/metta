import { Command } from 'commander'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'

export function registerQuickCommand(program: Command): void {
  program
    .command('quick')
    .description('Quick mode — skip planning, small changes')
    .argument('<description>', 'Description of the change')
    .action(async (description) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const graph = await ctx.workflowEngine.loadWorkflow('quick', [builtinWorkflows])

        const artifactIds = graph.buildOrder
        const result = await ctx.artifactStore.createChange(description, 'quick', artifactIds)

        if (json) {
          outputJson({
            change: result.name,
            workflow: 'quick',
            path: result.path,
            artifacts: artifactIds,
          })
        } else {
          console.log(`Quick change created: ${result.name}`)
          console.log(`  Artifacts: ${artifactIds.join(' → ')}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'quick_error', message } })
        } else {
          console.error(`Quick failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
