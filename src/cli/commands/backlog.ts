import { Command } from 'commander'
import { join } from 'node:path'
import { autoCommitFile, createCliContext, outputJson } from '../helpers.js'

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
}
