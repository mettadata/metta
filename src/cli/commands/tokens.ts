import { realpathSync } from 'node:fs'
import { Command } from 'commander'
import { createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { TokenUsageRecordSchema } from '../../schemas/change-metadata.js'
import { detectWorktreeChangeName } from '../../util/git-worktree.js'

/**
 * `metta tokens record --task <id> --agent <name> --model <alias>
 *   --tokens <count> [--change <name>] [--source <origin>]`
 *
 * Appends a token-usage record to a change's `.metta.yaml` (`token_usage`
 * array). Recording is hook-driven: a PostToolUse hook invokes this after
 * each subagent run (records carry `source: hook`), with skill-prose
 * invocations remaining as the fallback path (no `source` field, reported
 * as 'prose'). The finalize report aggregates token spend per task / agent /
 * model. Report-data-only: nothing reads these records to make routing
 * decisions.
 *
 * Change resolution follows a strict four-rule ordering with no fall-through:
 * 1. Explicit `--change` wins verbatim.
 * 2. Else, a cwd inside a change worktree (`.metta/worktrees/<name>/...`)
 *    binds unconditionally to that change — if the derived name is not an
 *    active change, that is a hard error (never silently reattributed).
 * 3. Else, auto-select when exactly one active change exists.
 * 4. Else, error naming the candidate changes.
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
    .option('--source <origin>', "Origin of the record: 'hook' or 'prose'")
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()
        let changeName: string
        if (options.change) {
          // Rule 1: explicit --change wins verbatim.
          changeName = options.change
        } else {
          // Rule 2: a cwd inside a change worktree binds unconditionally —
          // no fall-through to auto-selection, so a stale/inactive worktree
          // can never misattribute usage to an unrelated change.
          let cwd = process.cwd()
          try {
            cwd = realpathSync(cwd)
          } catch {
            // Best-effort: fall back to the raw cwd when realpath fails.
          }
          const candidate = detectWorktreeChangeName(cwd)
          if (candidate !== null) {
            if (!changes.includes(candidate)) {
              throw new Error(
                `worktree cwd names change '${candidate}' but it is not an active change`,
              )
            }
            changeName = candidate
          } else if (changes.length === 1) {
            // Rule 3: auto-select the single active change.
            changeName = changes[0]
          } else {
            // Rule 4: ambiguous or empty — error naming the candidates.
            throw new Error(
              changes.length === 0
                ? 'No active changes.'
                : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`,
            )
          }
        }

        const meta = await ctx.artifactStore.getChange(changeName)
        // Zod-validate the record shape here for a clear, field-naming error;
        // ArtifactStore.updateChange re-validates the whole metadata on write.
        // `source` is only included when the flag was passed: an omitted flag
        // persists NO source field (legacy prose records stay shape-stable),
        // while an invalid value fails validation before any write.
        const record = TokenUsageRecordSchema.parse({
          task: options.task,
          agent: options.agent,
          model: options.model,
          tokens: Number(options.tokens),
          timestamp: new Date().toISOString(),
          ...(options.source !== undefined ? { source: options.source } : {}),
        })
        await ctx.artifactStore.updateChange(changeName, {
          token_usage: [...(meta.token_usage ?? []), record],
        })

        const effectiveSource = record.source ?? 'prose'
        if (json) {
          outputJson({
            change: changeName,
            task: options.task,
            agent: options.agent,
            model: options.model,
            tokens: record.tokens,
            source: effectiveSource,
          })
        } else {
          console.log(
            `Recorded ${record.tokens} tokens (${options.model}) for agent '${options.agent}' on task '${options.task}' in ${changeName} (source: ${effectiveSource})`,
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
