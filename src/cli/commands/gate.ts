import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerGateCommand(program: Command): void {
  const gate = program
    .command('gate')
    .description('Manage gates')

  gate
    .command('run')
    .argument('<name>', 'Gate name')
    .description('Run a specific gate')
    .action(async (name) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
      await ctx.gateRegistry.loadFromDirectory(builtinGates)

      const result = await ctx.gateRegistry.run(name, ctx.projectRoot)
      if (json) {
        outputJson(result)
      } else {
        const icon = result.status === 'pass' ? '✓' : result.status === 'skip' ? '–' : '✗'
        console.log(`${icon} ${result.gate}: ${result.status} (${result.duration_ms}ms)`)
        if (result.output) console.log(result.output)
      }
      if (result.status === 'fail') process.exit(1)
    })

  gate
    .command('list')
    .description('List configured gates')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
      await ctx.gateRegistry.loadFromDirectory(builtinGates)
      const gates = ctx.gateRegistry.list()
      if (json) {
        outputJson({ gates })
      } else {
        for (const g of gates) {
          console.log(`  ${g.name.padEnd(15)} ${g.command.padEnd(30)} ${g.required ? 'required' : 'optional'}`)
        }
      }
    })

  gate
    .command('show')
    .argument('<name>', 'Gate name')
    .description('Show gate config')
    .action(async (name) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
      await ctx.gateRegistry.loadFromDirectory(builtinGates)
      const g = ctx.gateRegistry.get(name)
      if (!g) {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Gate '${name}' not found` } }) } else { console.error(`Gate '${name}' not found`) }
        process.exit(4)
      }
      if (json) { outputJson(g) } else {
        console.log(`Gate: ${g.name}`)
        console.log(`  Command: ${g.command}`)
        console.log(`  Timeout: ${g.timeout}ms`)
        console.log(`  Required: ${g.required}`)
        console.log(`  On failure: ${g.on_failure}`)
      }
    })
}
