import { Command } from 'commander'
import { join } from 'node:path'
import { assertOnMainBranch, autoCommitFile, createCliContext, outputJson, readPipedStdin, getErrorMessage } from '../helpers.js'
import { SLUG_RE } from '../../util/slug.js'
import { stripControlSequences, stripControlSequencesMultiline } from '../../util/sanitize-text.js'
import type { Severity } from '../../issues/issues-store.js'

const PRIORITIES = ['high', 'medium', 'low'] as const
type Priority = (typeof PRIORITIES)[number]

export function registerIssueCommand(program: Command): void {
  program
    .command('issue')
    .description('Log an issue')
    .argument('[description]', 'Issue description')
    .option('--severity <level>', 'Severity: critical, major, minor', 'minor')
    .option('--priority <level>', 'Priority: high, medium, low (written as frontmatter)')
    .option('--milestone <slug>', 'Milestone slug to associate (written as frontmatter)')
    .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
    .action(async (description, options) => {
      const json = program.opts().json
      const ctx = createCliContext()

      try {
        const stdinPayload = await readPipedStdin()
        const body = stdinPayload.trim() !== '' ? stdinPayload : description
        if (!description) {
          if (json) { outputJson({ error: { code: 4, type: 'missing_arg', message: 'Description required' } }) } else { console.error('Usage: metta issue <description>') }
          process.exit(4)
        }
        // Enum-validate priority BEFORE any write — invalid values must not
        // create a file.
        if (options.priority !== undefined && !PRIORITIES.includes(options.priority)) {
          const message = `Invalid priority '${options.priority}' — allowed values: high, medium, low`
          if (json) { outputJson({ error: { code: 4, type: 'invalid_priority', message } }) } else { console.error(message) }
          process.exit(4)
        }
        if (options.milestone !== undefined && !SLUG_RE.test(options.milestone)) {
          const message = `Invalid milestone '${options.milestone}' — must be a slug (lowercase letters, digits, hyphens, max 60 chars)`
          if (json) { outputJson({ error: { code: 4, type: 'invalid_milestone', message } }) } else { console.error(message) }
          process.exit(4)
        }
        const config = await ctx.configLoader.load()
        const mainBranch = config.git?.pr_base ?? 'main'
        await assertOnMainBranch(ctx.projectRoot, mainBranch, options.onBranch)
        // Dangling milestone reference: warn on stderr, never fail — the
        // issue is still created (the rollup surfaces the same warning).
        if (options.milestone !== undefined && !(await ctx.milestonesStore.exists(options.milestone))) {
          process.stderr.write(
            `Warning: milestone '${options.milestone}' has no spec/milestones/${options.milestone}.md — issue is created with a dangling reference\n`,
          )
        }
        const frontmatter =
          options.priority !== undefined || options.milestone !== undefined
            ? { priority: options.priority as Priority | undefined, milestone: options.milestone as string | undefined }
            : undefined
        const slug = await ctx.issuesStore.create(description, body, options.severity as Severity, undefined, frontmatter)
        const filePath = join(ctx.projectRoot, 'spec', 'issues', `${slug}.md`)
        const commit = await autoCommitFile(ctx.projectRoot, filePath, `chore: log issue ${slug}`)
        if (json) {
          outputJson({ slug, severity: options.severity, status: 'logged', committed: commit.committed, commit_sha: commit.sha })
        } else {
          console.log(`Issue logged: ${slug} (${options.severity})`)
          if (commit.committed) { console.log(`  Committed: ${commit.sha?.slice(0, 7)}`) }
          else if (commit.reason) { console.log(`  Not committed: ${commit.reason}`) }
        }
      } catch (err) {
        const message = getErrorMessage(err)
        const type = message.startsWith('Refusing to write') ? 'branch_guard' : 'issue_error'
        if (json) { outputJson({ error: { code: 4, type, message } }) } else { console.error(message) }
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
          for (const i of list) {
            const ideaMarker = i.type === 'idea' ? '[idea] ' : ''
            console.log(`  ${ideaMarker}[${i.severity}] ${i.slug.padEnd(30)} ${stripControlSequences(i.title)}`)
          }
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
          console.log(`# ${stripControlSequences(issue.title)}`)
          console.log(`Severity: ${issue.severity}`)
          console.log(`Status: ${issue.status}`)
          console.log('')
          console.log(stripControlSequencesMultiline(issue.description))
        }
      } catch {
        if (json) { outputJson({ error: { code: 4, type: 'not_found', message: `Issue '${slug}' not found` } }) } else { console.error(`Issue '${slug}' not found`) }
        process.exit(4)
      }
    })
}
