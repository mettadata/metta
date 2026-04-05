import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Run verification against spec')
    .argument('[change]', 'Change name')
    .action(async (changeName) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const name = changeName ?? (changes.length === 1 ? changes[0] : null)
        if (!name) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}`)

        const metadata = await ctx.artifactStore.getChange(name)

        // Run all configured gates
        const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
        await ctx.gateRegistry.loadFromDirectory(builtinGates)
        const gateNames = ctx.gateRegistry.list().map(g => g.name)
        const results = await ctx.gateRegistry.runAll(gateNames, ctx.projectRoot)

        const allPassed = results.every(r => r.status === 'pass' || r.status === 'skip')

        if (json) {
          outputJson({
            change: name,
            gates: results,
            passed: allPassed,
          })
        } else {
          console.log(`Verify: ${name}`)
          for (const r of results) {
            const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '–' : '✗'
            console.log(`  ${icon} ${r.gate}: ${r.status} (${r.duration_ms}ms)`)
          }
          console.log('')
          console.log(allPassed ? 'All gates passed.' : 'Some gates failed.')
        }

        if (!allPassed) process.exit(1)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'verify_error', message } })
        } else {
          console.error(`Verify failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
