import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { TokenUsageRecordSchema } from '../../schemas/change-metadata.js'

/**
 * `metta tokens record --task <id> --agent <name> --model <alias>
 *   --tokens <count> [--change <name>]`
 *
 * Appends a token-usage record to a change's `.metta.yaml` (`token_usage`
 * array). Skills call this after each agent run so the finalize report can
 * aggregate token spend per task / agent / model. Report-data-only: nothing
 * reads these records to make routing decisions.
 *
 * Not to be confused with `artifact_tokens`, which tracks context size vs
 * budget per artifact.
 */
export function registerTokensCommand(program: Command): void {
  const tokens = program
    .command('tokens')
    .description('Record per-run token usage for reporting')

  tokens
    .command('record')
    .description('Record token usage for an agent run on a task in a change')
    .requiredOption('--task <id>', 'Task / artifact id the usage applies to')
    .requiredOption('--agent <name>', 'Agent that performed the run')
    .requiredOption('--model <alias>', 'Model alias the run used')
    .requiredOption('--tokens <count>', 'Total tokens consumed by the run')
    .option('--change <name>', 'Change name (auto-selects when exactly one active change exists)')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
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
        const record = TokenUsageRecordSchema.parse({
          task: options.task,
          agent: options.agent,
          model: options.model,
          tokens: Number(options.tokens),
          timestamp: new Date().toISOString(),
        })
        await ctx.artifactStore.updateChange(changeName, {
          token_usage: [...(meta.token_usage ?? []), record],
        })

        if (json) {
          outputJson({
            change: changeName,
            task: options.task,
            agent: options.agent,
            model: options.model,
            tokens: record.tokens,
          })
        } else {
          console.log(
            `Recorded ${record.tokens} tokens (${options.model}) for agent '${options.agent}' on task '${options.task}' in ${changeName}`,
          )
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({
            error: { code: 4, type: 'tokens_record_error', message },
          })
        } else {
          console.error(`Token usage record failed: ${message}`)
        }
        process.exit(4)
      }
    })
}
