import { Command } from 'commander'
import { join } from 'node:path'
import { assertOnMainBranch, autoCommitFile, createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { buildPromoteHandoff } from '../promote-handoff.js'
import { RoadmapValidationError } from '../../roadmap/roadmap-store.js'

// Error envelope helper: all roadmap failures exit 4 with
// { error: { code: 4, type, message } } (JSON) or the message on stderr (text).
function exitWithError(json: boolean, type: string, message: string): never {
  if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
  process.exit(4)
}

// Catch-block mapping (normative order): typed RoadmapValidationError first,
// then the branch-guard prefix (consistent with `backlog add`), then unsafe-slug
// `Invalid … slug …` errors (an unsafe slug is by definition not a backlog
// item → not_found), else the defensive roadmap_error fallback.
function mapRoadmapError(err: unknown): { type: string; message: string } {
  if (err instanceof RoadmapValidationError) return { type: err.type, message: err.message }
  const message = getErrorMessage(err)
  if (message.startsWith('Refusing to write')) return { type: 'branch_guard', message }
  if (message.startsWith('Invalid') && message.includes('slug')) return { type: 'not_found', message }
  return { type: 'roadmap_error', message }
}

export function registerRoadmapCommand(program: Command): void {
  const roadmap = program
    .command('roadmap')
    .description('Manage the ordered feature roadmap')
    .action(async () => {
      // Read-only status view — default action fires when no subcommand given.
      // No writes, no assertOnMainBranch; works on any branch. Exit 0 even
      // when entries are dangling.
      const json = program.opts().json
      const ctx = createCliContext()
      const entries = await ctx.roadmapStore.list()
      const view: Array<{
        position: number
        slug: string
        title: string | null
        note: string | null
        dangling?: boolean
      }> = []
      for (const [index, entry] of entries.entries()) {
        const row: (typeof view)[number] = {
          position: index + 1,
          slug: entry.slug,
          title: null,
          note: entry.note ?? null,
        }
        try {
          const item = await ctx.issuesStore.show(entry.slug)
          row.title = item.title
        } catch {
          row.dangling = true
        }
        view.push(row)
      }
      if (json) { outputJson({ roadmap: view }) } else {
        if (view.length === 0) {
          console.log('Roadmap is empty. Add entries with: metta roadmap add <backlog-slug>')
        } else {
          for (const row of view) {
            const label = row.dangling ? '(dangling — backlog item missing)' : row.title
            const noteSuffix = row.note !== null ? ` — ${row.note}` : ''
            console.log(`  ${row.position}. ${row.slug.padEnd(30)} ${label}${noteSuffix}`)
          }
        }
      }
    })

  roadmap
    .command('add')
    .argument('<backlog-slug>', 'Backlog item slug')
    .option('--note <text>', 'Free-text note stored on the entry')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Append an existing backlog item to the end of the roadmap')
    .action(async (slug, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        await assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)
        const found = await ctx.issuesStore.exists(slug)
        if (!found) {
          exitWithError(json, 'not_found', `Backlog item '${slug}' not found`)
        }
        const position = await ctx.roadmapStore.add(slug, options.note)
        const filePath = join(ctx.projectRoot, 'spec', 'roadmap.md')
        const commit = await autoCommitFile(ctx.projectRoot, filePath, `chore: add roadmap entry ${slug}`)
        if (json) {
          outputJson({ slug, position, committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Added to roadmap at position ${position}: ${slug}`)
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const { type, message } = mapRoadmapError(err)
        exitWithError(json, type, message)
      }
    })

  roadmap
    .command('reorder')
    .argument('<slug...>', 'Complete new order — every current roadmap slug exactly once')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Rewrite the roadmap in the given order (full permutation required)')
    .action(async (slugs, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        // Branch guard runs BEFORE reading roadmap state, so off-main
        // rejections are branch_guard even for invalid permutations.
        await assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)
        await ctx.roadmapStore.reorder(slugs)
        const filePath = join(ctx.projectRoot, 'spec', 'roadmap.md')
        const commit = await autoCommitFile(ctx.projectRoot, filePath, 'chore: reorder roadmap')
        if (json) {
          outputJson({ reordered: slugs, committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Roadmap reordered: ${slugs.join(', ')}`)
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const { type, message } = mapRoadmapError(err)
        exitWithError(json, type, message)
      }
    })

  roadmap
    .command('next')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Activate the top roadmap entry via the backlog promote path and pop it')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        await assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)
        const entries = await ctx.roadmapStore.list()
        const top = entries[0]
        if (top === undefined) {
          // Empty roadmap is a no-op, not an error: no write, no commit.
          if (json) { outputJson({ next: null }) } else {
            console.log('Roadmap is empty — nothing to activate.')
          }
          return
        }
        let title: string
        try {
          const item = await ctx.issuesStore.show(top.slug)
          title = item.title
        } catch {
          // Dangling top entry (ADR-4): fail with not_found, no pop, no write,
          // no commit — silently popping would destroy roadmap intent.
          exitWithError(
            json,
            'not_found',
            `Roadmap top entry '${top.slug}' has no backlog item. ` +
              `Restore spec/issues/${top.slug}.md, or move it off the top with: metta roadmap reorder <slug...>`,
          )
        }
        const handoff = buildPromoteHandoff({ title })
        await ctx.roadmapStore.removeTop()
        const filePath = join(ctx.projectRoot, 'spec', 'roadmap.md')
        const commit = await autoCommitFile(ctx.projectRoot, filePath, `chore: pop roadmap entry ${top.slug}`)
        if (json) {
          outputJson({ next: top.slug, message: `Run: ${handoff}`, committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Next up: '${top.slug}' — activate by running: ${handoff}`)
          console.log('  Removed from roadmap.')
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const { type, message } = mapRoadmapError(err)
        exitWithError(json, type, message)
      }
    })
}
