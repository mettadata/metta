import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { ModelEscalationSchema } from '../../schemas/change-metadata.js'

/**
 * `metta model-escalation record --task <id> --from <model> --to <model>
 *   --trigger <stop_deviation|verify_fail> [--change <name>]`
 *
 * Appends a Rung-1 model-escalation record to a change's `.metta.yaml`
 * (`model_escalations` array). The metta-execute and metta-verify skills
 * call this before re-invoking an executor at top tier after a STOP
 * deviation report or a verify FAIL against downgraded-model output.
 *
 * Rung 1 is model-only: this command never touches the change's
 * `workflow`, `complexity_score`, or `actual_complexity_score` — workflow
 * escalation (Rung 2) is a separate, pre-existing mechanism.
 */
export function registerModelEscalationCommand(program: Command): void {
  const modelEscalation = program
    .command('model-escalation')
    .description('Record model-tier escalations (Rung 1)')

  modelEscalation
    .command('record')
    .description('Record a model escalation for a task in a change')
    .requiredOption('--task <id>', 'Task / artifact id the escalation applies to')
    .requiredOption('--from <model>', 'Model the task was running at before escalation')
    .requiredOption('--to <model>', 'Model the task escalates to')
    .requiredOption('--trigger <trigger>', 'Trigger: stop_deviation or verify_fail')
    .option('--change <name>', 'Change name (auto-selects when exactly one active change exists)')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (
          options.trigger !== 'stop_deviation' &&
          options.trigger !== 'verify_fail'
        ) {
          throw new Error(
            `--trigger must be 'stop_deviation' or 'verify_fail' (got '${options.trigger}')`,
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
        // Zod-validate the record shape here for a clear, field-naming error;
        // ArtifactStore.updateChange re-validates the whole metadata on write.
        const record = ModelEscalationSchema.parse({
          task: options.task,
          from_model: options.from,
          to_model: options.to,
          trigger: options.trigger,
          timestamp: new Date().toISOString(),
        })
        const next = [...(meta.model_escalations ?? []), record]
        await ctx.artifactStore.updateChange(changeName, {
          model_escalations: next,
        })

        if (json) {
          outputJson({
            change: changeName,
            task: options.task,
            from_model: options.from,
            to_model: options.to,
            trigger: options.trigger,
          })
        } else {
          console.log(
            `Recorded model escalation ${options.from} -> ${options.to} (${options.trigger}) for task '${options.task}' in ${changeName}`,
          )
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({
            error: { code: 4, type: 'model_escalation_error', message },
          })
        } else {
          console.error(`Model escalation record failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
