import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { createCliContext, outputJson } from '../helpers.js'

const execAsync = promisify(execFile)

export type IssueSeverity = 'critical' | 'major' | 'minor'

const severityWeight: Record<IssueSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
}

export function sortBySeverityForIssues<T extends { severity: IssueSeverity }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity])
}

export function registerFixIssueCommand(program: Command): void {
  program
    .command('fix-issue [issue-slug]')
    .description('Fix one or more logged issues')
    .option('--all', 'Fix all issues, sorted by severity')
    .option('--severity <level>', 'Filter by severity: critical, major, minor')
    .option('--remove-issue <slug>', 'Remove a resolved issue')
    .action(async (issueSlug: string | undefined, options: { all?: boolean; severity?: string; removeIssue?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()

      // Branch 1: --remove-issue
      if (options.removeIssue) {
        const slug = options.removeIssue
        try {
          const exists = await ctx.issuesStore.exists(slug)
          if (!exists) {
            if (json) {
              outputJson({ error: { code: 4, type: 'not_found', message: `Issue '${slug}' not found` } })
            } else {
              console.error(`Issue '${slug}' not found`)
            }
            process.exit(4)
          }
          await ctx.issuesStore.archive(slug)
          await ctx.issuesStore.remove(slug)
          try {
            await execAsync('git', ['add', join('spec', 'issues'), join('spec', 'issues', 'resolved')], { cwd: ctx.projectRoot })
            await execAsync('git', ['commit', '-m', `fix(issues): remove resolved issue ${slug}`], { cwd: ctx.projectRoot })
          } catch {
            // git not available or nothing to commit
          }
          if (json) {
            outputJson({ removed: slug })
          } else {
            console.log(`Removed issue: ${slug}`)
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'remove_error', message: `Failed to remove issue '${slug}'` } })
          } else {
            console.error(`Failed to remove issue '${slug}'`)
          }
          process.exit(4)
        }
        return
      }

      // Branch 2: single issue by slug
      if (issueSlug) {
        try {
          const exists = await ctx.issuesStore.exists(issueSlug)
          if (!exists) {
            if (json) {
              outputJson({ error: { code: 4, type: 'not_found', message: `Issue '${issueSlug}' not found` } })
            } else {
              console.error(`Issue '${issueSlug}' not found`)
            }
            process.exit(4)
          }
          const issue = await ctx.issuesStore.show(issueSlug)
          if (json) {
            outputJson({ issue: { slug: issueSlug, ...issue } })
          } else {
            console.log(`# Issue: ${issue.title}`)
            console.log(`Severity: ${issue.severity}`)
            console.log(`Status: logged`)
            if (issue.captured) console.log(`Captured: ${issue.captured}`)
            if (issue.context) console.log(`Context: ${issue.context}`)
            console.log('')
            console.log(issue.description)
            console.log('')
            console.log(`Delegate to skill: metta execute --skill fix-issues --target ${issueSlug}`)
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'show_error', message: `Failed to show issue '${issueSlug}'` } })
          } else {
            console.error(`Failed to show issue '${issueSlug}'`)
          }
          process.exit(4)
        }
        return
      }

      // Branch 3: --all
      if (options.all) {
        try {
          const list = await ctx.issuesStore.list()
          if (list.length === 0) {
            if (json) {
              outputJson({ issues: [] })
            } else {
              console.log('No issues found.')
            }
            return
          }

          const sorted = sortBySeverityForIssues(list)

          const filtered = options.severity
            ? sorted.filter(i => i.severity === options.severity)
            : sorted

          if (filtered.length === 0 && options.severity) {
            if (json) {
              outputJson({ issues: [], severity_filter: options.severity })
            } else {
              console.log(`No issues with severity '${options.severity}' found.`)
            }
            return
          }

          if (json) {
            outputJson({ issues: filtered, severity_filter: options.severity ?? null })
          } else {
            if (options.severity) {
              console.log(`Showing ${options.severity} issues only:\n`)
            }
            for (const i of filtered) {
              console.log(`  [${i.severity.toUpperCase().padEnd(8)}] [logged] ${i.slug.padEnd(30)} ${i.title}`)
            }
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'list_error', message: 'Failed to list issues' } })
          } else {
            console.error('Failed to list issues')
          }
          process.exit(4)
        }
        return
      }

      // Branch 4: no args, show usage
      if (json) {
        outputJson({
          usage: 'metta fix-issue [issue-slug] [--all] [--remove-issue <slug>]',
          commands: {
            'fix-issue <slug>': 'Show issue details and delegate to skill',
            'fix-issue --all': 'List all issues sorted by severity',
            'fix-issue --remove-issue <slug>': 'Remove a resolved issue',
          },
        })
      } else {
        console.log('Usage: metta fix-issue [issue-slug] [--all] [--remove-issue <slug>]')
        console.log('')
        console.log('  fix-issue <slug>                Show issue details and delegate to skill')
        console.log('  fix-issue --all                 List all issues sorted by severity')
        console.log('  fix-issue --remove-issue <slug> Remove a resolved issue')
        console.log('')
        console.log('For interactive selection, use the /metta-fix-issues skill.')
      }
    })
}
