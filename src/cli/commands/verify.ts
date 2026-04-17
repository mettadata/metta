import { Command } from 'commander'
import { createCliContext, outputJson, color } from '../helpers.js'

export function registerVerifyCommand(program: Command): void {
  program
    .command('verify')
    .description('Run verification against spec')
    .argument('[change]', 'Change name')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
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

        for (const g of results.filter(r => r.status === 'warn')) {
          process.stderr.write(`⚠ ${g.gate}: ${g.output ?? 'warning'}\n`)
        }

        const allPassed = results.every(r => r.status === 'pass' || r.status === 'skip' || r.status === 'warn')

        if (json) {
          outputJson({
            change: name,
            gates: results,
            passed: allPassed,
          })
        } else {
          console.log(`Verify: ${name}`)
          for (const r of results) {
            const icon = r.status === 'pass' ? color('✓', 32) : r.status === 'skip' ? color('–', 90) : color('✗', 31)
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
