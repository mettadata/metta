import { Command } from 'commander'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createCliContext, outputJson, color, agentBanner } from '../helpers.js'
import { formatDuration } from '../../util/duration.js'
import { getGitLogTimings } from '../../util/git-log-timings.js'
import type { ArtifactTiming, ArtifactTokens } from '../../schemas/change-metadata.js'

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
          artifact_timings?: Record<string, ArtifactTiming>
          artifact_tokens?: Record<string, ArtifactTokens>
          review_iterations?: number
          verify_iterations?: number
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
            artifact_timings: meta.artifact_timings,
            artifact_tokens: meta.artifact_tokens,
            review_iterations: meta.review_iterations,
            verify_iterations: meta.verify_iterations,
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
            active: active.map(a => {
              const entry: Record<string, unknown> = {
                name: a.name,
                workflow: a.workflow,
                progress: `${a.completed}/${a.total}`,
                percent: Math.round((a.completed / a.total) * 100),
                current: a.current,
                artifacts: a.artifacts,
              }
              if (a.artifact_timings !== undefined) entry.artifact_timings = a.artifact_timings
              if (a.artifact_tokens !== undefined) entry.artifact_tokens = a.artifact_tokens
              if (a.review_iterations !== undefined) entry.review_iterations = a.review_iterations
              if (a.verify_iterations !== undefined) entry.verify_iterations = a.verify_iterations
              return entry
            }),
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

            // Secondary metrics line: ⏱ <per-artifact durations>   📊 <tokens>   ↻ <iterations>
            const secondary = await buildSecondaryLine(
              ctx.projectRoot,
              a.name,
              a.artifact_timings,
              a.artifact_tokens,
              a.review_iterations,
              a.verify_iterations,
            )
            if (secondary.length > 0) {
              console.log(`         ${secondary}`)
            }
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

// Map each artifact id to the file name progress should inspect when
// falling back to git-log wall-clock for legacy changes. Keep this in
// sync with the per-artifact filenames emitted by instructions/complete.
const ARTIFACT_FILENAMES: Record<string, string> = {
  intent: 'intent.md',
  stories: 'stories.md',
  spec: 'spec.md',
  research: 'research.md',
  design: 'design.md',
  tasks: 'tasks.md',
  implementation: 'summary.md',
  verification: 'summary.md',
}

function formatThousandsK(n: number): string {
  return `${Math.round(n / 1000)}k`
}

export async function buildSecondaryLine(
  projectRoot: string,
  changeName: string,
  timings: Record<string, ArtifactTiming> | undefined,
  tokens: Record<string, ArtifactTokens> | undefined,
  reviewIters: number | undefined,
  verifyIters: number | undefined,
): Promise<string> {
  const segments: string[] = []

  // Time segment — prefer metadata timings; fall back to git log per
  // artifact when a change lacks them (legacy changes).
  const timeParts: string[] = []
  const artifactIds = Object.keys(ARTIFACT_FILENAMES)
  for (const id of artifactIds) {
    const t = timings?.[id]
    if (t?.started && t?.completed) {
      const ms = Date.parse(t.completed) - Date.parse(t.started)
      timeParts.push(`${id} ${formatDuration(ms)}`)
      continue
    }
    // Fallback: only attempt git log when both metadata fields are absent
    // (not when only one is set — that indicates the change is mid-flight
    // and the duration is not yet meaningful).
    if (!t?.started && !t?.completed) {
      const fileName = ARTIFACT_FILENAMES[id]
      const rel = `spec/changes/${changeName}/${fileName}`
      const git = await getGitLogTimings(projectRoot, rel)
      if (git && git.first.getTime() !== git.last.getTime()) {
        timeParts.push(
          `${id} ${formatDuration(git.last.getTime() - git.first.getTime())}`,
        )
      }
    }
  }
  if (timeParts.length > 0) {
    segments.push(`${color('⏱', 36)} ${timeParts.join(' · ')}`)
  }

  // Token segment — sum across all tracked artifacts, round to nearest 1k.
  if (tokens && Object.keys(tokens).length > 0) {
    let contextSum = 0
    let budgetSum = 0
    for (const [, v] of Object.entries(tokens)) {
      contextSum += v.context
      budgetSum += v.budget
    }
    segments.push(
      `${color('📊', 36)} ${formatThousandsK(contextSum)} / ${formatThousandsK(budgetSum)} tokens`,
    )
  }

  // Iteration segment — omit each half when zero/absent; omit whole when both.
  const iterHalves: string[] = []
  if ((reviewIters ?? 0) > 0) iterHalves.push(`review ×${reviewIters}`)
  if ((verifyIters ?? 0) > 0) iterHalves.push(`verify ×${verifyIters}`)
  if (iterHalves.length > 0) {
    segments.push(`${color('↻', 36)} ${iterHalves.join(', ')}`)
  }

  return segments.join('  ')
}
