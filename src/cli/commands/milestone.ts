import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertOnMainBranch, createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import type { CliContext } from '../helpers.js'
import { computeMilestoneRollups } from '../../milestones/milestone-rollup.js'
import { stripControlSequences } from '../../util/sanitize-text.js'
import type { MilestoneRollup } from '../../milestones/milestone-rollup.js'

const execAsync = promisify(execFile)

/**
 * Shared wiring helper for milestone rollups, reused by `status`/`progress`.
 * Composes `MilestonesStore` + `IssuesStore` + the pure
 * `computeMilestoneRollups` at the CLI edge (no store-to-store dependency).
 *
 * Returns `null` when `spec/milestones/` has no milestone files — the signal
 * for status/progress to omit the section entirely (back-compat: their output
 * stays byte-compatible with the pre-milestone structure).
 */
export async function loadMilestoneRollups(
  ctx: CliContext,
): Promise<{ rollups: MilestoneRollup[]; warnings: string[] } | null> {
  const milestones = await ctx.milestonesStore.list()
  if (milestones.length === 0) return null
  const [openIssues, resolvedIssues] = await Promise.all([
    ctx.issuesStore.list(),
    ctx.issuesStore.listResolved(),
  ])
  return computeMilestoneRollups(milestones, openIssues, resolvedIssues)
}

/**
 * Counts-only row for `milestone list` JSON — per-issue detail is `show`-only.
 * Exported for `status`/`progress`, whose optional `milestones` JSON key
 * carries the exact same element shape as `milestone list`.
 */
export function toMilestoneCountsRow(rollup: MilestoneRollup): Omit<MilestoneRollup, 'openIssues' | 'resolvedIssues'> {
  const { openIssues: _openIssues, resolvedIssues: _resolvedIssues, ...counts } = rollup
  return counts
}

export function registerMilestoneCommand(program: Command): void {
  const milestone = program
    .command('milestone')
    .description('Manage milestones')

  milestone
    .command('create')
    .argument('<slug>', 'Milestone slug')
    .requiredOption('--name <name>', 'Milestone display name')
    .option('--target <date>', 'Target date (YYYY-MM-DD)')
    .option('--description <text>', 'Free-form description body')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Create a milestone')
    .action(async (slug, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        const mainBranch = config.git?.pr_base ?? 'main'
        await assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)

        if (await ctx.milestonesStore.exists(slug)) {
          const message = `Milestone '${slug}' already exists at spec/milestones/${slug}.md`
          if (json) { outputJson({ error: { code: 4, type: 'milestone_exists', message } }) } else { console.error(message) }
          process.exit(4)
        }

        await ctx.milestonesStore.create(slug, {
          name: options.name,
          target: options.target,
          description: options.description,
        })

        let committed = false
        let commitSha: string | undefined
        try {
          await execAsync('git', ['add', join('spec', 'milestones')], { cwd: ctx.projectRoot })
          await execAsync('git', ['commit', '-m', `chore: create milestone ${slug}`], { cwd: ctx.projectRoot })
          const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: ctx.projectRoot })
          committed = true
          commitSha = stdout.trim()
        } catch {
          // git unavailable or nothing to commit — swallow silently
        }

        if (json) {
          outputJson({ slug, created: true, committed, commit_sha: commitSha })
        } else {
          console.log(`Created milestone: ${slug}`)
          if (committed) { console.log(`  Committed: ${commitSha?.slice(0, 7)}`) }
        }
      } catch (err) {
        const message = getErrorMessage(err)
        const type = message.startsWith('Refusing to write') ? 'branch_guard' : 'milestone_error'
        if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  milestone
    .command('list')
    .description('List milestones with rollup counts')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const loaded = await loadMilestoneRollups(ctx)
      const rollups = loaded?.rollups ?? []
      const warnings = loaded?.warnings ?? []
      if (json) {
        const payload: Record<string, unknown> = { milestones: rollups.map(toMilestoneCountsRow) }
        // Present only when non-empty — consumers key off absence, not [].
        if (warnings.length > 0) { payload.milestone_warnings = warnings }
        outputJson(payload)
      } else {
        for (const warning of warnings) { process.stderr.write(`Warning: ${warning}\n`) }
        if (rollups.length === 0) { console.log('No milestones.') } else {
          for (const r of rollups) {
            const marker = r.status === 'closed' ? '✓' : '▸'
            const target = r.target !== undefined ? `  target ${r.target}` : ''
            console.log(`  ${marker} ${r.slug.padEnd(30)} ${r.resolved}/${r.total} resolved (${r.percent}%)${target}`)
          }
        }
      }
    })

  milestone
    .command('show')
    .argument('<slug>', 'Milestone slug')
    .description('Show a milestone with per-issue detail')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const item = await ctx.milestonesStore.show(slug)
        const [openIssues, resolvedIssues] = await Promise.all([
          ctx.issuesStore.list(),
          ctx.issuesStore.listResolved(),
        ])
        // Single-milestone bucketing; warnings are intentionally dropped here —
        // issues pointing at *other* milestone slugs are `list`'s concern.
        const { rollups } = computeMilestoneRollups([item], openIssues, resolvedIssues)
        const rollup = rollups[0]
        const issues = [
          ...rollup.openIssues.map((i) => ({ slug: i.slug, title: i.title, state: 'open' })),
          ...rollup.resolvedIssues.map((i) => ({ slug: i.slug, title: i.title, state: 'resolved' })),
        ]
        if (json) {
          outputJson({
            slug: rollup.slug,
            name: rollup.name,
            status: rollup.status,
            ...(rollup.target !== undefined ? { target: rollup.target } : {}),
            description: item.description,
            open: rollup.open,
            resolved: rollup.resolved,
            total: rollup.total,
            percent: rollup.percent,
            issues,
          })
        } else {
          console.log(`# ${item.name}`)
          console.log(`Slug: ${slug}`)
          console.log(`Status: ${item.status}`)
          if (item.target !== undefined) { console.log(`Target: ${item.target}`) }
          console.log(`Progress: ${rollup.resolved}/${rollup.total} resolved (${rollup.percent}%)`)
          if (item.description.length > 0) {
            console.log('')
            console.log(item.description)
          }
          if (issues.length > 0) {
            console.log('')
            console.log('Issues:')
            for (const issue of issues) {
              console.log(`  [${issue.state}] ${issue.slug.padEnd(30)} ${stripControlSequences(issue.title)}`)
            }
          }
        }
      } catch (err) {
        const message = getErrorMessage(err)
        const type = message.includes('not found') ? 'not_found' : 'milestone_error'
        if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
