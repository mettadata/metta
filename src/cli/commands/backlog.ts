import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertOnMainBranch, createCliContext, outputJson, getErrorMessage } from '../helpers.js'
import { toBacklogEntries, sortBacklogEntries } from '../../backlog/backlog-view.js'
import { migrateLegacyBacklog } from '../../backlog/backlog-migrate.js'
import { IssueSlugCollisionError } from '../../issues/issues-store.js'
import { stripControlSequences, stripControlSequencesMultiline } from '../../util/sanitize-text.js'
import { SLUG_RE } from '../../util/slug.js'

const execAsync = promisify(execFile)

const PRIORITIES = ['high', 'medium', 'low'] as const
type Priority = (typeof PRIORITIES)[number]

interface CommitResult {
  committed: boolean
  sha?: string
}

/**
 * Swallow-on-failure auto-commit over one or more pathspecs. Each `git add`
 * is attempted independently (a pathspec that matches nothing — e.g. a
 * removed `spec/backlog/` dir with nothing tracked — must not abort staging
 * of the others); a failed commit (git unavailable, nothing staged) reports
 * `committed: false` without failing the command.
 */
async function commitPaths(projectRoot: string, paths: string[], message: string): Promise<CommitResult> {
  try {
    for (const path of paths) {
      try {
        await execAsync('git', ['add', path], { cwd: projectRoot })
      } catch {
        // pathspec matched nothing — fine, keep staging the rest
      }
    }
    await execAsync('git', ['commit', '-m', message], { cwd: projectRoot })
    const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
    return { committed: true, sha: stdout.trim() }
  } catch {
    // git unavailable or nothing to commit — swallow silently
    return { committed: false }
  }
}

export function registerBacklogCommand(program: Command): void {
  const backlog = program
    .command('backlog')
    .description('Manage the backlog — a view over spec/issues/ frontmatter')

  backlog
    .command('list', { isDefault: true })
    .description('List backlog entries (issues and ideas with backlog: true)')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      // The backlog is computed purely from issue frontmatter — this command
      // never reads spec/backlog/ (legacy items surface via `backlog migrate`).
      const records = await ctx.issuesStore.list()
      const entries = sortBacklogEntries(toBacklogEntries(records))
      if (json) {
        outputJson({
          backlog: entries.map((e) => ({
            slug: e.slug,
            title: e.title,
            type: e.type,
            priority: e.priority ?? null,
            order: e.order ?? null,
            milestone: e.milestone ?? null,
            captured: e.captured,
          })),
        })
      } else {
        if (entries.length === 0) { console.log('Backlog is empty.') } else {
          for (const e of entries) { console.log(`  [${e.priority ?? 'none'}] ${e.slug.padEnd(30)} ${stripControlSequences(e.title)}`) }
        }
      }
    })

  backlog
    .command('show')
    .argument('<slug>', 'Issue slug')
    .description('Show a backlog entry')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const issue = await ctx.issuesStore.show(slug)
        const fm = issue.frontmatter
        if (json) {
          outputJson({
            slug,
            title: issue.title,
            type: fm?.type ?? 'issue',
            backlog: fm?.backlog ?? false,
            priority: fm?.priority ?? null,
            order: fm?.order ?? null,
            milestone: fm?.milestone ?? null,
            captured: issue.captured,
            description: issue.description,
          })
        } else {
          console.log(`# ${stripControlSequences(issue.title)}`)
          console.log(`Type: ${fm?.type ?? 'issue'}`)
          console.log(`Backlog: ${fm?.backlog === true ? 'yes' : 'no'}`)
          console.log(`Priority: ${fm?.priority ?? 'unset'}`)
          if (fm?.order !== undefined) { console.log(`Order: ${fm.order}`) }
          if (fm?.milestone !== undefined) { console.log(`Milestone: ${fm.milestone}`) }
          console.log('')
          console.log(stripControlSequencesMultiline(issue.description))
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Item '${slug}' not found` } }) } else { console.error(`Item '${slug}' not found`) }
        process.exit(4)
      }
    })

  backlog
    .command('add')
    .argument('<slug-or-title>', 'Existing issue slug, or a new idea title with --new')
    .option('--new', 'Mint a new type: idea entry (the positional is the title)')
    .option('--description <text>', 'Description body with --new (defaults to the title)')
    .option('--priority <level>', 'Priority: high, medium, low')
    .option('--order <n>', 'Explicit ordering within a priority bucket')
    .option('--milestone <slug>', 'Milestone slug to associate')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Backlog an existing issue, or mint a new idea with --new')
    .action(async (slugOrTitle, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        if (options.priority !== undefined && !PRIORITIES.includes(options.priority)) {
          const message = `Invalid priority '${options.priority}' — allowed values: high, medium, low`
          if (json) { outputJson({ error: { code: 4, type: 'invalid_priority', message } }) } else { console.error(message) }
          process.exit(4)
        }
        let order: number | undefined
        if (options.order !== undefined) {
          order = Number(options.order)
          if (!Number.isFinite(order)) {
            const message = `Invalid order '${options.order}' — must be a number`
            if (json) { outputJson({ error: { code: 4, type: 'invalid_order', message } }) } else { console.error(message) }
            process.exit(4)
          }
        }
        const config = await ctx.configLoader.load()
        const mainBranch = config.git?.pr_base ?? 'main'
        await assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)

        const fields = {
          priority: options.priority as Priority | undefined,
          order,
          milestone: options.milestone as string | undefined,
        }

        let slug: string
        let status: 'backlogged' | 'already_backlogged' | 'created'
        let type: 'issue' | 'idea'
        if (options.new === true) {
          slug = await ctx.issuesStore.createIdea(slugOrTitle, options.description ?? slugOrTitle, fields)
          status = 'created'
          type = 'idea'
        } else {
          const found = SLUG_RE.test(slugOrTitle) && (await ctx.issuesStore.exists(slugOrTitle))
          if (!found) {
            const message =
              `No issue '${slugOrTitle}' found in spec/issues/. ` +
              `To mint a new idea instead, run: metta backlog add "${slugOrTitle}" --new`
            if (json) { outputJson({ error: { code: 4, type: 'not_found', message } }) } else { console.error(message) }
            process.exit(4)
          }
          slug = slugOrTitle
          const { changed } = await ctx.issuesStore.updateFrontmatter(slug, { backlog: true, ...fields })
          const issue = await ctx.issuesStore.show(slug)
          type = issue.frontmatter?.type ?? 'issue'
          status = changed ? 'backlogged' : 'already_backlogged'
        }

        let commit: CommitResult = { committed: false }
        if (status !== 'already_backlogged') {
          commit = await commitPaths(ctx.projectRoot, [join('spec', 'issues', `${slug}.md`)], `chore: add backlog item ${slug}`)
        }

        if (json) {
          outputJson({ slug, status, type, committed: commit.committed, commit_sha: commit.sha })
        } else {
          if (status === 'already_backlogged') {
            console.log(`Already backlogged: ${slug}`)
          } else {
            console.log(`${status === 'created' ? 'Created idea' : 'Added to backlog'}: ${slug}`)
          }
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
        }
      } catch (err) {
        if (err instanceof IssueSlugCollisionError) {
          // Never overwrite an existing issue file on --new — refuse loudly.
          const message =
            `${err.message}. ` +
            `Pick a different title, or run: metta backlog add ${err.slug} — to backlog the existing issue.`
          if (json) { outputJson({ error: { code: 4, type: 'slug_collision', message } }) } else { console.error(message) }
          process.exit(4)
        }
        const message = getErrorMessage(err)
        const type = message.startsWith('Refusing to write') ? 'branch_guard' : 'backlog_error'
        if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  backlog
    .command('promote')
    .argument('<slug>', 'Issue slug')
    .description('Emit the fix-issues handoff for a backlog entry (no writes)')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      // Promote performs zero writes — it only surfaces the handoff into the
      // fix-issues flow, which owns activation end to end.
      let found = false
      try {
        found = await ctx.issuesStore.exists(slug)
      } catch {
        found = false
      }
      if (!found) {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Item '${slug}' not found` } }) } else { console.error(`Item '${slug}' not found`) }
        process.exit(4)
      }
      if (json) {
        outputJson({ promoted: slug, message: `Run: /metta-fix-issues ${slug}` })
      } else {
        console.log(`Promote '${slug}' by running: /metta-fix-issues ${slug}`)
      }
    })

  backlog
    .command('done')
    .argument('<slug>', 'Issue slug')
    .option('--change <name>', 'Change name to stamp as Shipped-in metadata')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Archive a shipped backlog entry to spec/issues/resolved/')
    .action(async (slug, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      const changeName: string | undefined = options.change

      if (changeName !== undefined && !SLUG_RE.test(changeName)) {
        const message = `Invalid change name '${changeName}' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)`
        if (json) { outputJson({ error: { code: 4, type: 'invalid_change', message } }) } else { console.error(message) }
        process.exit(4)
      }

      try {
        const config = await ctx.configLoader.load()
        const mainBranch = config.git?.pr_base ?? 'main'
        await assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)
        const found = SLUG_RE.test(slug) && (await ctx.issuesStore.exists(slug))
        if (!found) {
          const message = `Backlog item '${slug}' not found`
          if (json) { outputJson({ error: { code: 4, type: 'not_found', message } }) } else { console.error(message) }
          process.exit(4)
        }

        await ctx.issuesStore.archive(slug, changeName)
        await ctx.issuesStore.remove(slug)

        const commit = await commitPaths(
          ctx.projectRoot,
          [join('spec', 'issues', `${slug}.md`), join('spec', 'issues', 'resolved', `${slug}.md`)],
          `chore: archive shipped backlog item ${slug}`,
        )

        if (json) {
          outputJson({ archived: slug, shipped_in: changeName ?? null, committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Archived backlog item: ${slug}`)
          if (changeName) { console.log(`  Shipped-in: ${changeName}`) }
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
        }
      } catch (err) {
        const message = getErrorMessage(err)
        if (json) { outputJson({ error: { code: 4, type: 'done_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  backlog
    .command('migrate')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .description('Migrate legacy spec/backlog/ items into the issue store')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const config = await ctx.configLoader.load()
        const mainBranch = config.git?.pr_base ?? 'main'
        await assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)
        const result = await migrateLegacyBacklog(join(ctx.projectRoot, 'spec'))

        // Only attempt a commit when the migration actually wrote something —
        // a no-op or collisions-only rerun must not sweep unrelated dirt.
        let commit: CommitResult = { committed: false }
        if (result.converted.active + result.converted.done > 0) {
          commit = await commitPaths(
            ctx.projectRoot,
            result.changedPaths,
            'chore: migrate legacy backlog to issue store',
          )
        }

        if (json) {
          outputJson({
            nothing_to_do: result.nothingToDo,
            converted: result.converted,
            collisions: result.collisions,
            archived_to: result.archivedTo,
            committed: commit.committed,
            commit_sha: commit.sha,
          })
        } else {
          if (result.nothingToDo) {
            console.log('No legacy backlog items to migrate.')
          } else {
            console.log(`Migrated ${result.converted.active} active and ${result.converted.done} done backlog item(s).`)
            console.log(`  Originals archived to: ${result.archivedTo}`)
            for (const c of result.collisions) {
              console.log(`  Collision: ${c.slug} — ${c.legacy_path} left in place (${c.existing_path} already exists)`)
            }
            if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          }
        }
        // Exit 0 with or without collisions; non-zero only on I/O failure.
      } catch (err) {
        const message = getErrorMessage(err)
        const type = message.startsWith('Refusing to write') ? 'branch_guard' : 'migrate_error'
        if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
