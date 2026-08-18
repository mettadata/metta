import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage, resolveMainCheckoutRoot } from '../helpers.js'
import { loadGatesWithOverrides } from '../../gates/gate-registry.js'
import { MergeSafetyPipeline, type MainCheckoutCleanInput } from '../../ship/merge-safety.js'
import { StateStore } from '../../state/state-store.js'
import { MainTreeBaselineSchema } from '../../schemas/tree-baseline.js'
import { baselineRelPath, deleteMainTreeBaseline } from '../../util/git-tree-baseline.js'

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
        await loadGatesWithOverrides(ctx.gateRegistry, ctx.projectRoot, builtinGates)

        // Worktree-hosted ships feed the pipeline a caller-fed
        // main-checkout-clean input (design D7: the pipeline itself stays
        // StateStore-free). All resolution is best-effort — any failure omits
        // the input, reproducing non-worktree behavior (no step emitted).
        let mainCheckout: MainCheckoutCleanInput | undefined
        let cleanupTarget: { mainRoot: string; change: string } | undefined
        const metaMatch = (sourceBranch as string).match(/^metta\/(.+)$/)
        if (metaMatch) {
          const changeName = metaMatch[1]
          try {
            const metadata = await ctx.artifactStore.getChange(changeName)
            const mainRoot = await resolveMainCheckoutRoot(ctx.projectRoot, changeName, metadata)
            if (mainRoot !== null) {
              let baselineEntries: MainCheckoutCleanInput['baselineEntries'] = null
              try {
                const store = new StateStore(join(mainRoot, '.metta'))
                const baseline = await store.read(baselineRelPath(changeName), MainTreeBaselineSchema)
                // A moved checkout makes the snapshot incomparable — treat a
                // main_root mismatch as an absent baseline (the step skips).
                if (resolve(baseline.main_root) === resolve(mainRoot)) {
                  baselineEntries = baseline.entries
                }
              } catch {
                // Missing/unreadable baseline: keep null so the step skips
                // instead of comparing falsely.
              }
              mainCheckout = { root: mainRoot, baselineEntries }
              cleanupTarget = { mainRoot, change: changeName }
            }
          } catch {
            // Change unknown or topology unresolvable — not worktree-hosted
            // for our purposes; ship exactly as before.
          }
        }

        const pipeline = new MergeSafetyPipeline(
          ctx.projectRoot,
          ctx.gateRegistry,
          mainCheckout !== undefined ? { mainCheckout } : undefined,
        )
        const result = await pipeline.run(sourceBranch, targetBranch, options.dryRun)

        // Baseline lifecycle: a successfully shipped change no longer needs
        // its snapshot. Best-effort — stale files are harmless (keyed by
        // change name) and deleteMainTreeBaseline never throws.
        if (!options.dryRun && result.status === 'success' && cleanupTarget !== undefined) {
          await deleteMainTreeBaseline(cleanupTarget.mainRoot, cleanupTarget.change)
        }

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

          const rebuildStep = result.steps.find(s => s.step === 'rebuild-dist')
          if (rebuildStep?.status === 'fail') {
            console.error('')
            console.error('WARNING: the merge completed, but rebuilding dist in the target checkout failed.')
            console.error(`  ${rebuildStep.detail ?? 'unknown build error'}`)
            console.error('  The globally-linked metta CLI (hooks, statusline) is stale until you run: npm run build')
          }
        }

        if (result.status === 'failure') process.exit(1)
        if (result.status === 'conflict') process.exit(2)
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'ship_error', message } }) } else { console.error(`Ship failed: ${message}`) }
        process.exit(4)
      }
    })
}
