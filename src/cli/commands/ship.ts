import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage, resolveMainCheckoutRoot } from '../helpers.js'
import { loadGatesWithOverrides } from '../../gates/gate-registry.js'
import { MergeSafetyPipeline, type MainCheckoutCleanInput } from '../../ship/merge-safety.js'
import { assertSafeSlug } from '../../util/slug.js'
import { DEFAULT_WORKTREE_DIR } from '../../util/git-worktree.js'
import { deleteMainTreeBaseline, readBaselineEntries } from '../../util/git-tree-baseline.js'
import type { TreeEntry } from '../../schemas/tree-baseline.js'

interface ShipCommandOptions {
  dryRun?: boolean
  branch?: string
}

/**
 * Branch-derived change names feed filesystem paths below (the worktree-dir
 * probe and the baseline file). An unsafe segment silently disengages the
 * main-checkout wiring (fail-open — ship behaves exactly as for a non-metta
 * branch) rather than erroring the ship.
 */
function isSafeChangeName(name: string): boolean {
  try {
    assertSafeSlug(name, 'change name')
    return true
  } catch {
    return false
  }
}

export function registerShipCommand(program: Command): void {
  program
    .command('ship')
    .description('Merge worktree branch to main')
    .option('--dry-run', 'Preview merge without applying')
    .option('--branch <name>', 'Source branch to merge')
    .action(async (options: ShipCommandOptions) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const config = await ctx.configLoader.load()
        const targetBranch = config.git?.pr_base ?? 'main'
        const sourceBranch = options.branch

        // Treat an empty --branch "" the same as a missing flag: show the
        // friendly usage message instead of failing deep in the pipeline.
        if (sourceBranch === undefined || sourceBranch === '') {
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
        const metaMatch = sourceBranch.match(/^metta\/(.+)$/)
        if (metaMatch !== null && isSafeChangeName(metaMatch[1])) {
          const changeName = metaMatch[1]
          let mainRoot: string | null = null
          // Populated only when the baseline-only-evidence fallback already
          // read the file — avoids a second identical read below.
          let cachedBaseline: TreeEntry[] | null | undefined
          try {
            const metadata = await ctx.artifactStore.getChange(changeName)
            mainRoot = await resolveMainCheckoutRoot(ctx.projectRoot, changeName, metadata)
          } catch {
            // In the real finalize->ship flow the change is already archived
            // (`metta finalize` moves spec/changes/<name> to spec/archive/),
            // so getChange throws for every legitimate ship. Fall back to
            // durable evidence that this projectRoot hosts the change's
            // worktree: (a) the worktree checkout still on disk under this
            // root, or (b) a Zod-validated baseline naming this root as its
            // main_root. Anything else keeps null — ship exactly as before.
            if (existsSync(join(ctx.projectRoot, DEFAULT_WORKTREE_DIR, changeName))) {
              mainRoot = ctx.projectRoot
            } else {
              const entries = await readBaselineEntries(ctx.projectRoot, changeName)
              if (entries !== null) {
                mainRoot = ctx.projectRoot
                cachedBaseline = entries
              }
            }
          }
          if (mainRoot !== null) {
            // readBaselineEntries yields null for a missing/unreadable
            // baseline or a moved checkout (main_root mismatch) — the step
            // then skips instead of comparing falsely.
            const baselineEntries =
              cachedBaseline !== undefined
                ? cachedBaseline
                : await readBaselineEntries(mainRoot, changeName)
            mainCheckout = { root: mainRoot, baselineEntries }
            cleanupTarget = { mainRoot, change: changeName }
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
