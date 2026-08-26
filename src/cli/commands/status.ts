import { Command } from 'commander'
import { createCliContext, outputJson, color, getErrorMessage } from '../helpers.js'
import { renderStatusLine } from '../../complexity/index.js'
import { checkFinalizeLockStale } from '../../finalize/finalize-lock.js'
import { loadMilestoneRollups, toMilestoneCountsRow } from './milestone.js'
import { MILESTONE_MARKERS } from '../../milestones/milestone-rollup.js'
import type { ChangeMetadata, ComplexityScore } from '../../schemas/change-metadata.js'

type MilestoneSection = Awaited<ReturnType<typeof loadMilestoneRollups>>

/**
 * Optional top-level JSON keys appended to whichever status envelope is
 * emitted. `null` (no milestone files) yields `{}` so the envelope stays
 * structurally identical to the pre-milestone shape; `milestone_warnings`
 * is present only when non-empty (conditional-key pattern).
 */
function milestoneJsonKeys(section: MilestoneSection): Record<string, unknown> {
  if (section === null) return {}
  const keys: Record<string, unknown> = {
    milestones: section.rollups.map(toMilestoneCountsRow),
  }
  if (section.warnings.length > 0) {
    keys.milestone_warnings = section.warnings
  }
  return keys
}

/** ANSI color per milestone status — local to this render site by design. */
const MILESTONE_MARKER_COLORS = { open: 36, closed: 32, abandoned: 31 } as const

/** Text `Milestones:` section — omitted entirely when no milestones exist. */
function printMilestoneSection(section: MilestoneSection): void {
  if (section === null) return
  console.log('')
  console.log('Milestones:')
  for (const r of section.rollups) {
    const marker = color(MILESTONE_MARKERS[r.status], MILESTONE_MARKER_COLORS[r.status])
    const target = r.target !== undefined ? `  target ${r.target}` : ''
    console.log(`  ${r.slug.padEnd(30)} ${marker} ${r.resolved}/${r.total} resolved (${r.percent}%)${target}`)
  }
}

type ChangeStatusJson = Omit<ChangeMetadata, 'complexity_score' | 'actual_complexity_score'> & {
  change: string
  complexity_score: ComplexityScore | null
  actual_complexity_score: ComplexityScore | null
  finalize_lock_stale: boolean
  finalize_lock_reason?: 'dead-pid' | 'mtime-expired'
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
        // Loaded once per invocation; null when spec/milestones/ has no
        // milestone files — the signal to omit the section/keys entirely.
        const milestoneSection = await loadMilestoneRollups(ctx)

        if (changes.length === 0) {
          if (json) {
            outputJson({ changes: [], message: 'No active changes', ...milestoneJsonKeys(milestoneSection) })
          } else {
            console.log('No active changes. Run metta propose to start.')
            printMilestoneSection(milestoneSection)
          }
          return
        }

        if (changeName) {
          const metadata = await ctx.artifactStore.getChange(changeName)
          if (json) {
            outputJson({
              ...(await toChangeJson(changeName, metadata, ctx.projectRoot)),
              ...milestoneJsonKeys(milestoneSection),
            })
          } else {
            await printChangeStatus(changeName, metadata, ctx.projectRoot)
            printMilestoneSection(milestoneSection)
          }
          return
        }

        if (changes.length === 1) {
          const metadata = await ctx.artifactStore.getChange(changes[0])
          if (json) {
            outputJson({
              ...(await toChangeJson(changes[0], metadata, ctx.projectRoot)),
              ...milestoneJsonKeys(milestoneSection),
            })
          } else {
            await printChangeStatus(changes[0], metadata, ctx.projectRoot)
            printMilestoneSection(milestoneSection)
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
            changes: await Promise.all(
              allMetadata.map(({ name, metadata }) => toChangeJson(name, metadata, ctx.projectRoot)),
            ),
            ...milestoneJsonKeys(milestoneSection),
          })
        } else {
          for (const { name, metadata } of allMetadata) {
            await printChangeStatus(name, metadata, ctx.projectRoot)
            console.log('')
          }
          printMilestoneSection(milestoneSection)
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'status_error', message } })
        } else {
          console.error(`Status failed: ${message}`)
        }
        process.exit(4)
      }
    })
}

async function toChangeJson(
  name: string,
  metadata: ChangeMetadata,
  projectRoot: string,
): Promise<ChangeStatusJson> {
  const lockStatus = await checkFinalizeLockStale(projectRoot, name)
  const result: ChangeStatusJson = {
    change: name,
    ...metadata,
    complexity_score: metadata.complexity_score ?? null,
    actual_complexity_score: metadata.actual_complexity_score ?? null,
    finalize_lock_stale: lockStatus.stale,
  }
  if (lockStatus.reason !== undefined) {
    result.finalize_lock_reason = lockStatus.reason
  }
  return result
}

async function printChangeStatus(
  name: string,
  metadata: ChangeMetadata,
  projectRoot: string,
): Promise<void> {
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

  // Token totals — rounded to nearest 1k, suppressed when no data.
  const tokens = metadata.artifact_tokens
  if (tokens && Object.keys(tokens).length > 0) {
    let contextSum = 0
    let budgetSum = 0
    for (const [, v] of Object.entries(tokens)) {
      contextSum += v.context
      budgetSum += v.budget
    }
    const ctxK = Math.round(contextSum / 1000)
    const budK = Math.round(budgetSum / 1000)
    console.log(`Tokens: ${ctxK}k / ${budK}k`)
  }

  // Escalation — only printed when the change was kept above its scored
  // recommendation; no placeholder line when absent.
  if (metadata.escalation !== undefined) {
    const e = metadata.escalation
    console.log(`Escalation: ${e.from_tier} -> ${e.to_tier} (${e.justification})`)
  }

  // Iteration counters — suppress each half when zero/absent.
  const iterHalves: string[] = []
  if ((metadata.review_iterations ?? 0) > 0) {
    iterHalves.push(`review ×${metadata.review_iterations}`)
  }
  if ((metadata.verify_iterations ?? 0) > 0) {
    iterHalves.push(`verify ×${metadata.verify_iterations}`)
  }
  if (iterHalves.length > 0) {
    console.log(`Iterations: ${iterHalves.join(', ')}`)
  }

  // Stale finalize lock — only printed when detected; no line otherwise.
  const lockStatus = await checkFinalizeLockStale(projectRoot, name)
  if (lockStatus.stale) {
    console.log('Finalize lock: stale finalize lock detected, safe to retry')
  }
}
