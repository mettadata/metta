import { Command } from 'commander'
import { outputJson, getErrorMessage } from '../helpers.js'

const autoDescription = [
  'Prints guidance for starting a change with `metta propose`. This command',
  'does not run an automated propose→plan→execute→verify→ship loop; use the',
  'individual lifecycle skills (`metta-propose`, `metta-plan`, `metta-execute`,',
  '`metta-verify`, `metta-ship`) or `/metta-auto` for the full loop, in an',
  'AI-orchestrated session.',
].join('\n')

export function registerAutoCommand(program: Command): void {
  program
    .command('auto')
    .description(autoDescription)
    .argument('<description>', 'Description of what to build')
    .option('--workflow <name>', 'workflow tier to mention in guidance', 'standard')
    .option('--max-cycles <n>', 'unused by this command; retained for output compatibility', '10')
    .action(async (description, options) => {
      const json = program.opts().json

      try {
        const maxCycles = parseInt(options.maxCycles)

        if (json) {
          outputJson({
            status: 'guidance',
            description,
            workflow: options.workflow,
            max_cycles: maxCycles,
            message: 'This command does not run the lifecycle loop. Run metta propose to start the change.',
          })
        } else {
          console.log(`Auto: ${description}`)
          console.log(`  Workflow: ${options.workflow}`)
          console.log('')
          console.log('This command does not run an automated propose→plan→execute→verify→ship loop.')
          console.log(`Run metta propose "${description}" to start this change, then use the`)
          console.log('individual lifecycle skills (metta-propose, metta-plan, metta-execute,')
          console.log('metta-verify, metta-ship) or /metta-auto for the full loop, in an')
          console.log('AI-orchestrated session.')
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'auto_error', message } }) } else { console.error(`Auto failed: ${message}`) }
        process.exit(4)
      }
    })
}
