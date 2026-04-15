import { Command } from 'commander'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createCliContext, outputJson, type CliContext } from '../helpers.js'
import { ARTIFACT_KINDS } from '../../context/context-engine.js'
import { assertSafeSlug } from '../../util/slug.js'

async function resolveChangeName(ctx: CliContext, flagName?: string): Promise<string> {
  if (flagName) return flagName
  const changes = await ctx.artifactStore.listChanges()
  if (changes.length === 0) {
    throw new Error('No active changes found.')
  }
  if (changes.length > 1) {
    throw new Error(`Multiple active changes: ${changes.join(', ')}. Specify --change <name>.`)
  }
  return changes[0]
}

function recommend(kind: string, utilization: number): 'ok' | 'smart-zone' | 'fan-out' | 'split-phase' {
  if (utilization < 0.8) return 'ok'
  if (utilization < 1.0) return 'smart-zone'
  return kind === 'execution' ? 'fan-out' : 'split-phase'
}

interface Row {
  artifact: string
  tokens: number
  budget: number
  utilization: number
  recommendation: string
  droppedOptionals: string[]
}

export function registerContextCommand(program: Command): void {
  const context = program
    .command('context')
    .description('Context budget management')

  context
    .command('stats')
    .description('Report token utilization per artifact for a change')
    .option('--change <name>', 'Change name')
    .option('--artifact <kind>', 'Limit output to a single artifact kind')
    .action(async (options: { change?: string; artifact?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const changeName = await resolveChangeName(ctx, options.change)
        assertSafeSlug(changeName, 'change name')

        const changePath = join(ctx.projectRoot, 'spec', 'changes', changeName)
        if (!existsSync(changePath)) {
          const msg = `change directory not found: ${changePath}`
          if (json) outputJson({ error: { code: 4, type: 'not_found', message: msg } })
          else console.error(`context stats failed: ${msg}`)
          process.exit(4)
          return
        }

        const kinds = options.artifact ? [options.artifact] : ARTIFACT_KINDS
        const specDir = join(ctx.projectRoot, 'spec')
        const rows: Row[] = []
        for (const kind of kinds) {
          const loaded = await ctx.contextEngine.resolve(kind, changePath, specDir)
          const utilization = loaded.budget === 0 ? 0 : loaded.totalTokens / loaded.budget
          rows.push({
            artifact: kind,
            tokens: loaded.totalTokens,
            budget: loaded.budget,
            utilization,
            recommendation: recommend(kind, utilization),
            droppedOptionals: loaded.droppedOptionals,
          })
        }

        if (json) {
          outputJson({ change: changeName, artifacts: rows })
        } else {
          console.log(`Context stats for change: ${changeName}`)
          console.log('')
          const header = `${'artifact'.padEnd(14)} ${'tokens'.padStart(8)} ${'budget'.padStart(8)} ${'util%'.padStart(7)}  recommendation`
          console.log(header)
          console.log('-'.repeat(header.length))
          for (const r of rows) {
            const pct = `${Math.round(r.utilization * 100)}%`
            console.log(
              `${r.artifact.padEnd(14)} ${String(r.tokens).padStart(8)} ${String(r.budget).padStart(8)} ${pct.padStart(7)}  ${r.recommendation}`,
            )
          }
        }
        process.exit(0)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) outputJson({ error: { code: 4, type: 'context_stats_error', message } })
        else console.error(`context stats failed: ${message}`)
        process.exit(4)
      }
    })

  context
    .command('check')
    .description('Check for stale context')
    .action(async () => {
      const json = program.opts().json
      if (json) {
        outputJson({ stale: [] })
      } else {
        console.log('No stale context detected.')
      }
    })
}
