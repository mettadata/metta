import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerAutoCommand(program: Command): void {
  program
    .command('auto')
    .description('Full lifecycle loop — discover, build, verify, ship')
    .argument('<description>', 'Description of what to build')
    .option('--workflow <name>', 'Workflow to use', 'standard')
    .option('--max-cycles <n>', 'Maximum iteration cycles', '10')
    .option('--resume', 'Resume interrupted auto run')
    .option('--from <phase>', 'Start from a specific phase')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (options.resume) {
          // Check for existing auto state
          const stateExists = await ctx.stateStore.exists('state.yaml')
          if (!stateExists) throw new Error('No auto state to resume. Start a new auto run.')

          if (json) {
            outputJson({ status: 'resuming', message: 'Auto mode resumed' })
          } else {
            console.log('Resuming auto mode...')
          }
          return
        }

        const maxCycles = parseInt(options.maxCycles)

        if (json) {
          outputJson({
            status: 'started',
            description,
            workflow: options.workflow,
            max_cycles: maxCycles,
            message: 'Auto mode started. Discovery phase is interactive.',
          })
        } else {
          console.log(`Auto mode: ${description}`)
          console.log(`  Workflow: ${options.workflow}`)
          console.log(`  Max cycles: ${maxCycles}`)
          console.log('')
          console.log('Phase 0: Discovery (interactive)')
          console.log('  Run metta propose to begin discovery.')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'auto_error', message } }) } else { console.error(`Auto failed: ${message}`) }
        process.exit(4)
      }
    })
}
