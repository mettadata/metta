import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson } from '../helpers.js'

const execAsync = promisify(execFile)

export function registerQuickCommand(program: Command): void {
  program
    .command('quick')
    .description('Quick mode — skip planning, small changes')
    .argument('<description>', 'Description of the change')
    .option('--auto, --accept-recommended', 'auto-accept adaptive routing recommendations')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const autoAccept = options.acceptRecommended === true

      try {
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const graph = await ctx.workflowEngine.loadWorkflow('quick', [builtinWorkflows])

        const artifactIds = graph.buildOrder
        const result = await ctx.artifactStore.createChange(
          description,
          'quick',
          artifactIds,
          {},
          autoAccept,
        )

        // Create worktree branch
        const branchName = `metta/${result.name}`
        let branchCreated = false
        try {
          const config = await ctx.configLoader.load()
          if (config.git?.enabled !== false) {
            await execAsync('git', ['checkout', '-b', branchName], { cwd: ctx.projectRoot })
            branchCreated = true
          }
        } catch {
          // Branch may already exist or git not available
        }

        if (json) {
          outputJson({
            change: result.name,
            workflow: 'quick',
            path: result.path,
            artifacts: artifactIds,
            branch: branchCreated ? branchName : null,
          })
        } else {
          console.log(`Quick change created: ${result.name}`)
          if (branchCreated) console.log(`  Branch: ${branchName}`)
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
