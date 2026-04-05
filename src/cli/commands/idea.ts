import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerIdeaCommand(program: Command): void {
  program
    .command('idea')
    .description('Capture a feature idea')
    .argument('[description]', 'Idea description')
    .action(async (description) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (!description) {
          if (json) { outputJson({ error: { code: 4, type: 'missing_arg', message: 'Description required' } }) } else { console.error('Usage: metta idea <description>') }
          process.exit(4)
        }
        const slug = await ctx.ideasStore.create(description, description)
        if (json) {
          outputJson({ slug, status: 'captured' })
        } else {
          console.log(`Idea captured: ${slug}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'idea_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  const ideas = program
    .command('ideas')
    .description('Manage ideas')

  ideas
    .command('list')
    .description('List all ideas')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const list = await ctx.ideasStore.list()
      if (json) { outputJson({ ideas: list }) } else {
        if (list.length === 0) { console.log('No ideas captured yet.') } else {
          for (const i of list) { console.log(`  ${i.slug.padEnd(30)} ${i.title}`) }
        }
      }
    })

  ideas
    .command('show')
    .argument('<slug>', 'Idea slug')
    .description('Show a specific idea')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const idea = await ctx.ideasStore.show(slug)
        if (json) { outputJson(idea) } else {
          console.log(`# ${idea.title}`)
          console.log(`Captured: ${idea.captured}`)
          if (idea.captured_during) console.log(`During: ${idea.captured_during}`)
          console.log('')
          console.log(idea.description)
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Idea '${slug}' not found` } }) } else { console.error(`Idea '${slug}' not found`) }
        process.exit(4)
      }
    })
}
