import { Command } from 'commander'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson, color, agentBanner } from '../helpers.js'

export function registerProgressCommand(program: Command): void {
  program
    .command('progress')
    .description('Show project-level progress across all changes')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        // Active changes
        const activeNames = await ctx.artifactStore.listChanges()
        const active: Array<{
          name: string
          workflow: string
          total: number
          completed: number
          current: string
          artifacts: Record<string, string>
        }> = []

        for (const name of activeNames) {
          const meta = await ctx.artifactStore.getChange(name)
          const entries = Object.entries(meta.artifacts)
          const completed = entries.filter(([_, s]) => s === 'complete' || s === 'skipped').length
          active.push({
            name,
            workflow: meta.workflow,
            total: entries.length,
            completed,
            current: meta.current_artifact,
            artifacts: meta.artifacts,
          })
        }

        // Archived changes
        const archiveDir = join(ctx.projectRoot, 'spec', 'archive')
        let archived: string[] = []
        try {
          const entries = await readdir(archiveDir, { withFileTypes: true })
          archived = entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse()
        } catch {
          // No archive dir
        }

        if (json) {
          outputJson({
            active: active.map(a => ({
              name: a.name,
              workflow: a.workflow,
              progress: `${a.completed}/${a.total}`,
              percent: Math.round((a.completed / a.total) * 100),
              current: a.current,
              artifacts: a.artifacts,
            })),
            completed: archived,
            summary: {
              active: active.length,
              shipped: archived.length,
              total: active.length + archived.length,
            },
          })
          return
        }

        // Human output
        console.log(color('Metta Project Progress', 36))
        console.log('')

        // Active changes
        if (active.length > 0) {
          console.log(color('  Active:', 33))
          for (const a of active) {
            const pct = Math.round((a.completed / a.total) * 100)
            const bar = progressBar(a.completed, a.total, 20)
            const artifactAgentMap: Record<string, string> = {
              intent: 'proposer', stories: 'product', spec: 'specifier', research: 'researcher',
              design: 'architect', tasks: 'planner', implementation: 'executor', verification: 'verifier',
            }

            // Find current step
            const currentAgent = artifactAgentMap[a.current] ?? 'executor'
            console.log(`    ${bar} ${color(String(pct) + '%', pct === 100 ? 32 : 33)}  ${color(a.name, 36)}`)

            // Show artifact pipeline
            const pipeline = Object.entries(a.artifacts).map(([id, status]) => {
              if (status === 'complete') return color('✓', 32)
              if (status === 'in_progress') return color('→', 33)
              if (status === 'ready') return color('▸', 36)
              return color('·', 90)
            }).join(' ')
            console.log(`         ${pipeline}  ${color(a.current + '...', 90)}`)
          }
          console.log('')
        }

        // Completed changes
        if (archived.length > 0) {
          console.log(color(`  Completed (${archived.length}):`, 32))
          for (const name of archived.slice(0, 10)) {
            const date = name.slice(0, 10)
            const changeName = name.slice(11)
            console.log(`    ${color('✓', 32)} ${changeName.padEnd(35)} ${color(date, 90)}`)
          }
          if (archived.length > 10) {
            console.log(color(`    ... and ${archived.length - 10} more`, 90))
          }
          console.log('')
        }

        if (active.length === 0 && archived.length === 0) {
          console.log('  No changes yet. Run /metta:propose or /metta:quick to start.')
          console.log('')
        }

        // Summary
        const total = active.length + archived.length
        console.log(`  ${color(String(archived.length), 32)} shipped  ${color(String(active.length), 33)} active  ${color(String(total), 36)} total`)

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'progress_error', message } }) } else { console.error(`Progress failed: ${message}`) }
        process.exit(4)
      }
    })
}

function progressBar(completed: number, total: number, width: number): string {
  const filled = Math.round((completed / total) * width)
  const empty = width - filled
  const filledColor = completed === total ? 32 : 34  // green if done, blue if in progress
  return color('█'.repeat(filled), filledColor) + color('░'.repeat(empty), 90)
}
