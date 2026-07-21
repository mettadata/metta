import { Command } from 'commander'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createCliContext, outputJson, color, getErrorMessage } from '../helpers.js'
import { Finalizer } from '../../finalize/finalizer.js'
import { loadGatesWithOverrides } from '../../gates/gate-registry.js'
import { WorkflowEngine } from '../../workflow/workflow-engine.js'
import { acquireFinalizeLock, FinalizeLockError } from '../../finalize/finalize-lock.js'

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

        // Guard against concurrent finalize runs for this change. The lock's
        // exit handler releases it even when finalize calls process.exit(),
        // so the returned release fn can be safely ignored here.
        await acquireFinalizeLock(ctx.projectRoot, name)

        // Load gates — built-ins first, then project-local overrides.
        const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
        await loadGatesWithOverrides(ctx.gateRegistry, ctx.projectRoot, builtinGates)

        // Resolve workflow templates using the same relative-depth pattern as gates.
        const workflowEngine = new WorkflowEngine()
        const workflowPaths = [new URL('../../templates/workflows', import.meta.url).pathname]

        const finalizer = new Finalizer(
          join(ctx.projectRoot, 'spec'),
          ctx.artifactStore,
          ctx.specLockManager,
          ctx.gateRegistry,
          ctx.projectRoot,
          workflowEngine,
          workflowPaths,
        )

        const result = await finalizer.finalize(name, options.dryRun)

        // Post-run checks in pipeline order: incomplete artifacts (exit 3) →
        // spec conflict (exit 2) → gate failure (exit 1). Conflict is checked
        // before gates because a conflict abort forces gatesPassed: false with
        // an empty gate list — checking gates first misreported conflicts as
        // "Quality gates failed".

        // Incomplete artifacts
        if (result.incompleteArtifacts && result.incompleteArtifacts.length > 0) {
          if (json) {
            outputJson({
              status: 'incomplete_artifacts',
              change: name,
              incomplete: result.incompleteArtifacts,
              message: 'Complete all required artifacts before finalizing',
            })
          } else {
            console.error(color('Cannot finalize: required artifacts are not complete:', 31))
            for (const a of result.incompleteArtifacts) {
              console.error(`  ${a.id}: ${a.status}`)
            }
            console.error('\nComplete each artifact and retry.')
          }
          process.exit(3)
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
            const failed = result.gates.filter((g) => g.status === 'fail')
            if (failed.length > 0) {
              console.error('')
              for (const g of failed) {
                console.error(color(`✗ ${g.gate}`, 31))
                if (g.failures && g.failures.length > 0) {
                  for (const f of g.failures) {
                    const loc = f.line ? `${f.file}:${f.line}` : f.file
                    const prefix = loc ? `    ${loc} — ` : '    '
                    console.error(`${prefix}${f.message}`)
                  }
                } else if (g.output) {
                  const trimmed = g.output.trim()
                  if (trimmed) {
                    for (const line of trimmed.split('\n')) {
                      console.error(`    ${line}`)
                    }
                  }
                }
              }
            }
            console.error('\nFix failures and retry.')
          }
          process.exit(1)
        }

        if (json) {
          outputJson({
            status: options.dryRun ? 'dry_run' : 'finalized',
            change: name,
            archive: result.archiveName,
            gates: result.gates,
            merged: result.specMerge.merged,
            uatPath: result.uatPath,
            ...(result.uatError ? { uatWarning: result.uatError } : {}),
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
            if (result.uatPath) console.log(`  UAT script: ${result.uatPath}`)
            if (result.uatError) console.error(color(`Warning: UAT generation failed: ${result.uatError}`, 33))
            console.log(`\nNext: merge branch to main or run metta ship`)
          }
        }

        // Auto-commit archive (rename already moved changes → archive)
        // Scope the add to paths touched by this finalize only — never `-A spec/` which
        // would sweep in unrelated untracked backlog/issue/idea files into this commit.
        if (!options.dryRun && result.archiveName) {
          try {
            const paths: string[] = [
              `spec/archive/${result.archiveName}`,
              `spec/changes/${name}`,
            ]
            for (const cap of result.specMerge.merged) {
              paths.push(`spec/specs/${cap.split('/')[0]}`)
            }
            await execAsync('git', ['add', '--', ...paths], { cwd: ctx.projectRoot })
            await execAsync('git', ['diff', '--cached', '--quiet'], { cwd: ctx.projectRoot }).catch(async () => {
              await execAsync('git', ['commit', '-m', `chore(${name}): archive and finalize`], { cwd: ctx.projectRoot })
            })
          } catch {
            // Nothing to commit or git not available
          }
        }
      } catch (err) {
        if (err instanceof FinalizeLockError) {
          if (json) { outputJson({ error: { code: 5, type: 'finalize_locked', message: err.message } }) } else { console.error(color(err.message, 31)) }
          process.exit(5)
        }
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'finalize_error', message } }) } else { console.error(`Finalize failed: ${message}`) }
        process.exit(4)
      }
    })
}
