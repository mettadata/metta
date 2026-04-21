import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

/**
 * `metta iteration record --phase <review|verify> --change <name>`
 *
 * Increments the persisted `review_iterations` or `verify_iterations`
 * counter on a change's `.metta.yaml`. The review-fix and verify-fix
 * loops in the metta-* skill templates call this at the top of each
 * iteration so the count survives session resets and shows up in
 * `metta progress` / `metta status`.
 *
 * Missing counters are treated as `0` (first record sets them to `1`).
 */
export function registerIterationCommand(program: Command): void {
  const iteration = program
    .command('iteration')
    .description('Record iteration counters (review / verify)')

  iteration
    .command('record')
    .description('Increment the review or verify iteration counter for a change')
    .requiredOption('--phase <phase>', 'Phase: review or verify')
    .option('--change <name>', 'Change name (auto-selects when exactly one active change exists)')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (options.phase !== 'review' && options.phase !== 'verify') {
          throw new Error(
            `--phase must be 'review' or 'verify' (got '${options.phase}')`,
          )
        }

        const changes = await ctx.artifactStore.listChanges()
        const changeName =
          options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) {
          throw new Error(
            changes.length === 0
              ? 'No active changes.'
              : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`,
          )
        }

        const meta = await ctx.artifactStore.getChange(changeName)
        const key =
          options.phase === 'review' ? 'review_iterations' : 'verify_iterations'
        const next = (meta[key] ?? 0) + 1
        await ctx.artifactStore.updateChange(changeName, { [key]: next })

        if (json) {
          outputJson({ change: changeName, phase: options.phase, count: next })
        } else {
          console.log(
            `Recorded ${options.phase} iteration #${next} for ${changeName}`,
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({
            error: { code: 4, type: 'iteration_error', message },
          })
        } else {
          console.error(`Iteration record failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
