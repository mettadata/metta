import { Command } from 'commander'
import { createCliContext, outputJson, color } from '../helpers.js'
import { renderStatusLine } from '../../complexity/index.js'
import type { ChangeMetadata, ComplexityScore } from '../../schemas/change-metadata.js'

type ChangeStatusJson = Omit<ChangeMetadata, 'complexity_score' | 'actual_complexity_score'> & {
  change: string
  complexity_score: ComplexityScore | null
  actual_complexity_score: ComplexityScore | null
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show current change status')
    .argument('[change]', 'Change name')
    .option('--change <name>', 'Change name (alternative to positional)')
    .action(async (changeName, options) => {
      changeName = changeName ?? options.change
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const changes = await ctx.artifactStore.listChanges()

        if (changes.length === 0) {
          if (json) {
            outputJson({ changes: [], message: 'No active changes' })
          } else {
            console.log('No active changes. Run metta propose to start.')
          }
          return
        }

        if (changeName) {
          const metadata = await ctx.artifactStore.getChange(changeName)
          if (json) {
            outputJson(toChangeJson(changeName, metadata))
          } else {
            printChangeStatus(changeName, metadata)
          }
          return
        }

        if (changes.length === 1) {
          const metadata = await ctx.artifactStore.getChange(changes[0])
          if (json) {
            outputJson(toChangeJson(changes[0], metadata))
          } else {
            printChangeStatus(changes[0], metadata)
          }
          return
        }

        // Multiple changes
        const allMetadata: Array<{ name: string; metadata: ChangeMetadata }> = []
        for (const name of changes) {
          const metadata = await ctx.artifactStore.getChange(name)
          allMetadata.push({ name, metadata })
        }

        if (json) {
          outputJson({
            changes: allMetadata.map(({ name, metadata }) => toChangeJson(name, metadata)),
          })
        } else {
          for (const { name, metadata } of allMetadata) {
            printChangeStatus(name, metadata)
            console.log('')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'status_error', message } })
        } else {
          console.error(`Status failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

function toChangeJson(name: string, metadata: ChangeMetadata): ChangeStatusJson {
  return {
    change: name,
    ...metadata,
    complexity_score: metadata.complexity_score ?? null,
    actual_complexity_score: metadata.actual_complexity_score ?? null,
  }
}

function printChangeStatus(name: string, metadata: ChangeMetadata): void {
  console.log(`Change: ${color(name, 36)} (${color(metadata.workflow + ' workflow', 90)})`)
  console.log(`Status: ${metadata.status}`)
  console.log('')
  console.log('Artifacts:')
  for (const [id, status] of Object.entries(metadata.artifacts)) {
    const marker =
      status === 'complete' ? color('✓', 32) :
      status === 'in_progress' ? color('→', 33) :
      status === 'ready' ? color('▸', 36) :
      status === 'failed' ? color('✗', 31) :
      color('·', 90)
    console.log(`  ${marker} ${id.padEnd(20)} ${status}`)
  }
  const statusLine = renderStatusLine(metadata.complexity_score)
  if (statusLine.length > 0) {
    console.log(statusLine)
  } else {
    console.log(color('Complexity: not yet scored', 90))
  }
}
