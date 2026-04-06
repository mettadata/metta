import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, color } from '../helpers.js'
import { Finalizer } from '../../finalize/finalizer.js'

const execAsync = promisify(execFile)

export function registerFinalizeCommand(program: Command): void {
  program
    .command('finalize')
    .description('Archive, merge specs, generate docs, refresh context')
    .argument('[change]', 'Change name')
    .option('--dry-run', 'Preview what would change')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        const name = changeName ?? (changes.length === 1 ? changes[0] : null)
        if (!name) throw new Error(changes.length === 0 ? 'No active changes.' : `Multiple changes: ${changes.join(', ')}`)

        // Load gates
        const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
        await ctx.gateRegistry.loadFromDirectory(builtinGates)

        const finalizer = new Finalizer(
          join(ctx.projectRoot, 'spec'),
          ctx.artifactStore,
          ctx.specLockManager,
          ctx.gateRegistry,
          ctx.projectRoot,
        )

        const result = await finalizer.finalize(name, options.dryRun)

        // Gate failure
        if (!result.gatesPassed) {
          if (json) {
            outputJson({
              status: 'gates_failed',
              change: name,
              gates: result.gates,
              message: 'Fix gate failures before finalizing',
            })
          } else {
            console.error(color('Quality gates failed:', 31))
            for (const g of result.gates) {
              const icon = g.status === 'pass' ? color('✓', 32) : g.status === 'skip' ? color('–', 90) : color('✗', 31)
              console.error(`  ${icon} ${g.gate}: ${g.status} (${g.duration_ms}ms)`)
            }
            console.error('\nFix failures and retry.')
          }
          process.exit(1)
        }

        // Spec conflict
        if (result.specMerge.status === 'conflict') {
          if (json) {
            outputJson({
              status: 'conflict',
              conflicts: result.specMerge.conflicts,
              message: 'Resolve conflicts before finalizing',
            })
          } else {
            console.error(color('Spec merge conflicts detected:', 31))
            for (const c of result.specMerge.conflicts) {
              console.error(`  ${c.capability}/${c.requirementId}: ${c.reason}`)
            }
            console.error('\nResolve conflicts and retry.')
          }
          process.exit(2)
        }

        if (json) {
          outputJson({
            status: options.dryRun ? 'dry_run' : 'finalized',
            change: name,
            archive: result.archiveName,
            gates: result.gates,
            merged: result.specMerge.merged,
          })
        } else {
          if (options.dryRun) {
            console.log('Dry run:')
            if (result.gates.length > 0) {
              console.log('  Gates:')
              for (const g of result.gates) {
                const icon = g.status === 'pass' ? color('✓', 32) : g.status === 'skip' ? color('–', 90) : color('✗', 31)
                console.log(`    ${icon} ${g.gate}: ${g.status}`)
              }
            }
            console.log(`  Would archive: ${name}`)
            console.log(`  Would merge: ${result.specMerge.merged.join(', ') || 'nothing'}`)
          } else {
            if (result.gates.length > 0) {
              console.log(color('Gates:', 32))
              for (const g of result.gates) {
                const icon = g.status === 'pass' ? color('✓', 32) : color('–', 90)
                console.log(`  ${icon} ${g.gate}: ${g.status} (${g.duration_ms}ms)`)
              }
            }
            console.log(`\n${color('Finalized:', 32)} ${name}`)
            console.log(`  Archived as: ${result.archiveName}`)
            console.log(`  Specs merged: ${result.specMerge.merged.join(', ') || 'none'}`)
            console.log(`\nNext: merge branch to main or run metta ship`)
          }
        }

        // Auto-commit archive + cleanup changes directory
        if (!options.dryRun && result.archiveName) {
          try {
            const { rm } = await import('node:fs/promises')
            // Clean up any leftover changes dir (rename should have moved it)
            await rm(join(ctx.projectRoot, 'spec', 'changes', name), { recursive: true, force: true })
            // Stage everything: archive (new), changes removal, spec merges
            await execAsync('git', ['add', '-A', 'spec/'], { cwd: ctx.projectRoot })
            await execAsync('git', ['diff', '--cached', '--quiet'], { cwd: ctx.projectRoot }).catch(async () => {
              await execAsync('git', ['commit', '-m', `chore(${name}): archive and finalize`], { cwd: ctx.projectRoot })
            })
          } catch {
            // Nothing to commit or git not available
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'finalize_error', message } }) } else { console.error(`Finalize failed: ${message}`) }
        process.exit(4)
      }
    })
}
