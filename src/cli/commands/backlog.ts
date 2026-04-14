import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { autoCommitFile, createCliContext, outputJson } from '../helpers.js'

const execAsync = promisify(execFile)
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

export function registerBacklogCommand(program: Command): void {
  const backlog = program
    .command('backlog')
    .description('Manage backlog')

  backlog
    .command('list')
    .description('List backlog items')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const list = await ctx.backlogStore.list()
      if (json) { outputJson({ backlog: list }) } else {
        if (list.length === 0) { console.log('Backlog is empty.') } else {
          for (const i of list) { console.log(`  [${i.priority ?? 'none'}] ${i.slug.padEnd(30)} ${i.title}`) }
        }
      }
    })

  backlog
    .command('show')
    .argument('<slug>', 'Item slug')
    .description('Show backlog item')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const item = await ctx.backlogStore.show(slug)
        if (json) { outputJson(item) } else {
          console.log(`# ${item.title}`)
          console.log(`Priority: ${item.priority ?? 'unset'}`)
          console.log(`Source: ${item.source ?? 'manual'}`)
          console.log('')
          console.log(item.description)
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Item '${slug}' not found` } }) } else { console.error(`Item '${slug}' not found`) }
        process.exit(4)
      }
    })

  backlog
    .command('add')
    .argument('<title>', 'Item title')
    .option('--priority <level>', 'Priority: high, medium, low')
    .option('--source <source>', 'Source (e.g. idea/dark-mode)')
    .description('Add item to backlog')
    .action(async (title, options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const slug = await ctx.backlogStore.add(title, title, options.source, options.priority)
        const filePath = join(ctx.projectRoot, 'spec', 'backlog', `${slug}.md`)
        const commit = await autoCommitFile(ctx.projectRoot, filePath, `chore: add backlog item ${slug}`)
        if (json) {
          outputJson({ slug, status: 'added', committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Added to backlog: ${slug}`)
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'backlog_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  backlog
    .command('promote')
    .argument('<slug>', 'Item slug')
    .description('Promote backlog item to active change')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const item = await ctx.backlogStore.show(slug)
        // Create a change from this backlog item
        if (json) {
          outputJson({ promoted: slug, message: `Run: metta propose "${item.title}"` })
        } else {
          console.log(`Promote '${slug}' by running: metta propose "${item.title}"`)
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Item '${slug}' not found` } }) } else { console.error(`Item '${slug}' not found`) }
        process.exit(4)
      }
    })

  backlog
    .command('done')
    .argument('<slug>', 'Item slug')
    .option('--change <name>', 'Change name to stamp as Shipped-in metadata')
    .description('Archive a shipped backlog item')
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
        const found = await ctx.backlogStore.exists(slug)
        if (!found) {
          const message = `Backlog item '${slug}' not found`
          if (json) { outputJson({ error: { code: 4, type: 'not_found', message } }) } else { console.error(message) }
          process.exit(4)
        }

        await ctx.backlogStore.archive(slug, changeName)
        await ctx.backlogStore.remove(slug)

        let committed = false
        let commitSha: string | undefined
        try {
          await execAsync('git', ['add', join('spec', 'backlog'), join('spec', 'backlog', 'done')], { cwd: ctx.projectRoot })
          await execAsync('git', ['commit', '-m', `chore: archive shipped backlog item ${slug}`], { cwd: ctx.projectRoot })
          const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: ctx.projectRoot })
          committed = true
          commitSha = stdout.trim()
        } catch {
          // git unavailable or nothing to commit — swallow silently
        }

        if (json) {
          outputJson({ archived: slug, shipped_in: changeName ?? null, committed, commit_sha: commitSha })
        } else {
          console.log(`Archived backlog item: ${slug}`)
          if (changeName) { console.log(`  Shipped-in: ${changeName}`) }
          if (committed) { console.log(`  Committed: ${commitSha?.slice(0, 7)}`) }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'done_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })
}
