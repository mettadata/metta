import { Command } from 'commander'
import { join } from 'node:path'
import { assertOnMainBranch, autoCommitFile, createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { buildPromoteHandoff } from '../promote-handoff.js'
import { RoadmapValidationError } from '../../roadmap/roadmap-store.js'
import { stripControlSequences } from '../../util/sanitize-text.js'

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
            const label = row.dangling ? '(dangling — backlog item missing)' : stripControlSequences(row.title ?? '')
            const noteSuffix = row.note !== null ? ` — ${stripControlSequences(row.note)}` : ''
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
    .command('remove')
    .argument('<target>', '1-based position or entry slug (all-digit input is always treated as a position)')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Remove a roadmap entry by position or slug')
    .action(async (target, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        // Branch guard runs BEFORE reading roadmap state, mirroring add/reorder.
        await assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)
        // All-digit input is ALWAYS a position (ADR-1): `remove 0` flows as an
        // out-of-range position, never a literal slug "0".
        const parsed: string | number = /^\d+$/.test(target) ? Number(target) : target
        const { entry, position } = await ctx.roadmapStore.remove(parsed)
        const filePath = join(ctx.projectRoot, 'spec', 'roadmap.md')
        const commit = await autoCommitFile(
          ctx.projectRoot,
          filePath,
          `chore: remove roadmap entry ${entry.slug}`,
        )
        if (json) {
          outputJson({ removed: entry.slug, position, committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Removed from roadmap (was position ${position}): ${entry.slug}`)
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
    .option('--prune', 'Also remove the skipped dangling entries in the same write and commit')
    .description(
      'Activate the first healthy roadmap entry via the backlog promote path and pop it, ' +
        'skipping (and warning on) any dangling entries ahead of it. Use --prune to remove ' +
        'the skipped dangling entries in the same write and commit.',
    )
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        await assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)

        // Phase 1 — plan (read-only, no store mutation, no output): walk the
        // roadmap from the top, classifying each entry healthy/dangling via
        // issuesStore.show. The first healthy entry is the activation
        // candidate; dangling entries ahead of it are collected, never
        // fail-stopped (ADR-3 supersedes roadmap-feature ADR-4).
        const entries = await ctx.roadmapStore.list()
        const skipped: string[] = []
        let candidate: { slug: string; title: string } | null = null
        for (const entry of entries) {
          // Dangling classification is by CONFIRMED ABSENCE only (issuesStore.exists,
          // the same file-presence primitive `roadmap add` uses), not by catching any
          // failure out of `show`. An entry whose file genuinely does not exist is the
          // only state that is dangling / prune-eligible. If the file DOES exist but
          // `show` still throws (malformed frontmatter, EACCES, a transient fs error),
          // that is an ambiguous, non-dangling state — fail toward preserving the
          // entry: let the error propagate to the outer catch (mapped + exit 4),
          // mirroring the pre-ADR-3 conservative fail-stop posture for this one case,
          // rather than silently classifying it dangling and risking deletion under
          // `--prune`.
          const found = await ctx.issuesStore.exists(entry.slug)
          if (!found) {
            skipped.push(entry.slug)
            continue
          }
          const item = await ctx.issuesStore.show(entry.slug)
          candidate = { slug: entry.slug, title: item.title }
          break
        }

        // Phase 2 — report + mutate. One stderr warning per skipped slug, in
        // BOTH output modes (ADR-5) — stdout stays a single JSON document.
        for (const slug of skipped) {
          process.stderr.write(
            `Warning: skipping dangling roadmap entry '${slug}' — spec/issues/${slug}.md not found. ` +
              `Remedy: metta roadmap remove ${slug}, or restore spec/issues/${slug}.md\n`,
          )
        }

        if (entries.length === 0) {
          // Empty roadmap is a no-op, not an error: no write, no commit.
          if (json) { outputJson({ next: null, skipped: [], pruned: [] }) } else {
            console.log('Roadmap is empty — nothing to activate.')
          }
          return
        }

        if (candidate === null) {
          // All entries dangling: guidance, not an error. No store call at
          // all — --prune is structurally inert here.
          const message =
            `All ${entries.length} roadmap entries are dangling — nothing to activate. ` +
            'Remove them (metta roadmap remove <slug>) or restore the issue files under spec/issues/.'
          if (json) {
            process.stderr.write(`${message}\n`)
            outputJson({ next: null, message, skipped, pruned: [] })
          } else {
            console.log(message)
          }
          return
        }

        const handoff = buildPromoteHandoff({ title: candidate.title })
        const toRemove = options.prune ? [...skipped, candidate.slug] : [candidate.slug]
        await ctx.roadmapStore.removeSlugs(toRemove)
        const pruned = options.prune ? skipped : []
        const filePath = join(ctx.projectRoot, 'spec', 'roadmap.md')
        // Base prefix preserved verbatim for log-grep automation; suffix only
        // appended when pruning actually removed entries. The pruned slugs
        // themselves go in the commit body (not the subject) so `git log`
        // (and `git show`) give a full audit trail of exactly which dangling
        // entries this commit deleted, without disturbing subject-line greps.
        let commitMessage = `chore: pop roadmap entry ${candidate.slug}`
        if (pruned.length > 0) {
          commitMessage += ` (pruned ${pruned.length} dangling)`
          commitMessage += `\n\nPruned dangling entries:\n${pruned.map((slug) => `- ${slug}`).join('\n')}`
        }
        const commit = await autoCommitFile(ctx.projectRoot, filePath, commitMessage)
        if (json) {
          outputJson({
            next: candidate.slug,
            message: `Run: ${handoff}`,
            skipped,
            pruned,
            committed: commit.committed,
            commit_sha: commit.sha,
          })
        } else {
          // The handoff embeds the raw backlog item title; sanitize at the
          // render edge only — the JSON branch above stays byte-faithful.
          console.log(stripControlSequences(`Next up: '${candidate.slug}' — activate by running: ${handoff}`))
          console.log('  Removed from roadmap.')
          if (pruned.length > 0) { console.log(`  Pruned ${pruned.length} dangling entries.`) }
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const { type, message } = mapRoadmapError(err)
        exitWithError(json, type, message)
      }
    })
}
