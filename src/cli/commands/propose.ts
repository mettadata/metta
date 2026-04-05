import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson } from '../helpers.js'

const execAsync = promisify(execFile)

export function registerProposeCommand(program: Command): void {
  program
    .command('propose')
    .description('Start a new change (standard workflow)')
    .argument('<description>', 'Description of the change')
    .option('--workflow <name>', 'Workflow to use', 'standard')
    .option('--from-gap <gap>', 'Create from a gap')
    .option('--from-idea <idea>', 'Create from an idea')
    .option('--from-issue <issue>', 'Create from an issue')
    .option('--discovery <mode>', 'Discovery mode: interactive, batch, review', 'interactive')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const config = await ctx.configLoader.load()
        const workflowName = options.workflow ?? config.defaults?.workflow ?? 'standard'

        // Load workflow
        const builtinWorkflows = new URL('../../templates/workflows', import.meta.url).pathname
        const projectWorkflows = join(ctx.projectRoot, '.metta', 'workflows')
        const graph = await ctx.workflowEngine.loadWorkflow(workflowName, [projectWorkflows, builtinWorkflows])

        // Create the change
        const artifactIds = graph.buildOrder
        const result = await ctx.artifactStore.createChange(description, workflowName, artifactIds)

        // Create worktree branch (all work happens off main)
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
            workflow: workflowName,
            path: result.path,
            artifacts: artifactIds,
            branch: branchCreated ? branchName : null,
            next: `Run \`metta instructions intent --json --change ${result.name}\` to get guidance`,
          })
        } else {
          console.log(`Change created: ${result.name}`)
          console.log(`  Workflow: ${workflowName}`)
          if (branchCreated) console.log(`  Branch: ${branchName}`)
          console.log(`  Artifacts: ${artifactIds.join(' → ')}`)
          console.log('')
          console.log(`Next: metta instructions intent --change ${result.name}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'propose_error', message } })
        } else {
          console.error(`Propose failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
