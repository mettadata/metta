import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'
import type { Severity } from '../../issues/issues-store.js'

export function registerIssueCommand(program: Command): void {
  program
    .command('issue')
    .description('Log an issue')
    .argument('[description]', 'Issue description')
    .option('--severity <level>', 'Severity: critical, major, minor', 'minor')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        if (!description) {
          if (json) { outputJson({ error: { code: 4, type: 'missing_arg', message: 'Description required' } }) } else { console.error('Usage: metta issue <description>') }
          process.exit(4)
        }
        const slug = await ctx.issuesStore.create(description, description, options.severity as Severity)
        if (json) {
          outputJson({ slug, severity: options.severity, status: 'logged' })
        } else {
          console.log(`Issue logged: ${slug} (${options.severity})`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) { outputJson({ error: { code: 4, type: 'issue_error', message } }) } else { console.error(message) }
        process.exit(4)
      }
    })

  const issues = program
    .command('issues')
    .description('Manage issues')

  issues
    .command('list')
    .description('List all issues')
    .action(async () => {
      const json = program.opts().json
      const ctx = createCliContext()
      const list = await ctx.issuesStore.list()
      if (json) { outputJson({ issues: list }) } else {
        if (list.length === 0) { console.log('No issues logged.') } else {
          for (const i of list) { console.log(`  [${i.severity}] ${i.slug.padEnd(30)} ${i.title}`) }
        }
      }
    })

  issues
    .command('show')
    .argument('<slug>', 'Issue slug')
    .description('Show a specific issue')
    .action(async (slug) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        const issue = await ctx.issuesStore.show(slug)
        if (json) { outputJson(issue) } else {
          console.log(`# ${issue.title}`)
          console.log(`Severity: ${issue.severity}`)
          console.log(`Status: ${issue.status}`)
          console.log('')
          console.log(issue.description)
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Issue '${slug}' not found` } }) } else { console.error(`Issue '${slug}' not found`) }
        process.exit(4)
      }
    })
}
