import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'
import { MergeSafetyPipeline } from '../../ship/merge-safety.js'

export function registerShipCommand(program: Command): void {
  program
    .command('ship')
    .description('Merge worktree branch to main')
    .option('--dry-run', 'Preview merge without applying')
    .option('--branch <name>', 'Source branch to merge')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const config = await ctx.configLoader.load()
        const targetBranch = config.git?.pr_base ?? 'main'
        const sourceBranch = options.branch

        if (!sourceBranch) {
          if (json) {
            outputJson({
              status: 'info',
              message: 'Specify --branch <name> to merge a worktree branch to main',
              target: targetBranch,
            })
          } else {
            console.log('Ship: specify --branch <name> to merge to main')
            console.log(`  Target: ${targetBranch}`)
          }
          return
        }

        const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
        await ctx.gateRegistry.loadFromDirectory(builtinGates)

        const pipeline = new MergeSafetyPipeline(ctx.projectRoot, ctx.gateRegistry)
        const result = await pipeline.run(sourceBranch, targetBranch, options.dryRun)

        if (json) {
          outputJson(result)
        } else {
          for (const step of result.steps) {
            const icon = step.status === 'pass' ? '✓' : step.status === 'skip' ? '–' : '✗'
            const detail = step.detail ? ` (${step.detail})` : ''
            console.log(`  ${icon} ${step.step}${detail}`)
          }
          console.log('')
          console.log(`Ship: ${result.status}`)
        }

        if (result.status === 'failure') process.exit(1)
        if (result.status === 'conflict') process.exit(2)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'ship_error', message } }) } else { console.error(`Ship failed: ${message}`) }
        process.exit(4)
      }
    })
}
