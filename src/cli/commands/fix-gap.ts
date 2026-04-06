import { Command } from 'commander'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createCliContext, outputJson } from '../helpers.js'

const execAsync = promisify(execFile)

export type Severity = 'critical' | 'medium' | 'low'

const severityWeight: Record<Severity, number> = {
  critical: 0,
  medium: 1,
  low: 2,
}

export function parseSeverity(rawContent: string): Severity {
  const text = rawContent.toLowerCase()
  if (/\b(p1|high|critical|bug)\b/.test(text)) return 'critical'
  if (/\b(p2|medium)\b/.test(text)) return 'medium'
  return 'low'
}

export function sortBySeverity<T extends { severity: Severity }>(gaps: T[]): T[] {
  return [...gaps].sort((a, b) => severityWeight[a.severity] - severityWeight[b.severity])
}

export function registerFixGapCommand(program: Command): void {
  program
    .command('fix-gap [gap-name]')
    .description('Fix one or more reconciliation gaps')
    .option('--all', 'Fix all gaps, sorted by severity')
    .option('--severity <level>', 'Filter by severity: critical, medium, low')
    .option('--remove-gap <slug>', 'Remove a resolved gap')
    .action(async (gapName: string | undefined, options: { all?: boolean; severity?: string; removeGap?: string }) => {
      const json = program.opts().json
      const ctx = createCliContext()

      // Branch 1: --remove-gap
      if (options.removeGap) {
        const slug = options.removeGap
        try {
          const exists = await ctx.gapsStore.exists(slug)
          if (!exists) {
            if (json) {
              outputJson({ error: { code: 4, type: 'not_found', message: `Gap '${slug}' not found` } })
            } else {
              console.error(`Gap '${slug}' not found`)
            }
            process.exit(4)
          }
          await ctx.gapsStore.archive(slug)
          await ctx.gapsStore.remove(slug)
          try {
            await execAsync('git', ['add', join('spec', 'gaps'), join('spec', 'archive')], { cwd: ctx.projectRoot })
            await execAsync('git', ['commit', '-m', `fix(gaps): remove resolved gap ${slug}`], { cwd: ctx.projectRoot })
          } catch {
            // git not available or nothing to commit
          }
          if (json) {
            outputJson({ removed: slug })
          } else {
            console.log(`Removed gap: ${slug}`)
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'remove_error', message: `Failed to remove gap '${slug}'` } })
          } else {
            console.error(`Failed to remove gap '${slug}'`)
          }
          process.exit(4)
        }
        return
      }

      // Branch 2: single gap by name
      if (gapName) {
        try {
          const exists = await ctx.gapsStore.exists(gapName)
          if (!exists) {
            if (json) {
              outputJson({ error: { code: 4, type: 'not_found', message: `Gap '${gapName}' not found` } })
            } else {
              console.error(`Gap '${gapName}' not found`)
            }
            process.exit(4)
          }
          const gap = await ctx.gapsStore.show(gapName)
          if (json) {
            outputJson({ gap: { slug: gapName, ...gap } })
          } else {
            console.log(`# Gap: ${gap.title}`)
            console.log(`Status: ${gap.status}`)
            if (gap.source) console.log(`Source: ${gap.source}`)
            if (gap.claim) console.log(`Claim: ${gap.claim}`)
            if (gap.evidence) console.log(`Evidence: ${gap.evidence}`)
            if (gap.impact) console.log(`Impact: ${gap.impact}`)
            if (gap.relatedSpec) console.log(`Related Spec: ${gap.relatedSpec}`)
            console.log('')
            console.log(`Delegate to skill: metta execute --skill fix-gap --target ${gapName}`)
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'show_error', message: `Failed to show gap '${gapName}'` } })
          } else {
            console.error(`Failed to show gap '${gapName}'`)
          }
          process.exit(4)
        }
        return
      }

      // Branch 3: --all
      if (options.all) {
        try {
          const list = await ctx.gapsStore.list()
          if (list.length === 0) {
            if (json) {
              outputJson({ gaps: [] })
            } else {
              console.log('No gaps found.')
            }
            return
          }

          const specDir = join(ctx.projectRoot, 'spec')
          const enriched = await Promise.all(
            list.map(async (g) => {
              const rawContent = await readFile(join(specDir, 'gaps', `${g.slug}.md`), 'utf-8')
              const severity = parseSeverity(rawContent)
              return { ...g, severity }
            }),
          )

          const sorted = sortBySeverity(enriched)

          // Filter by severity if --severity provided
          const filtered = options.severity
            ? sorted.filter(g => g.severity === options.severity)
            : sorted

          if (filtered.length === 0 && options.severity) {
            if (json) {
              outputJson({ gaps: [], severity_filter: options.severity })
            } else {
              console.log(`No gaps with severity '${options.severity}' found.`)
            }
            return
          }

          if (json) {
            outputJson({ gaps: filtered, severity_filter: options.severity ?? null })
          } else {
            if (options.severity) {
              console.log(`Showing ${options.severity} gaps only:\n`)
            }
            for (const g of filtered) {
              console.log(`  [${g.severity.toUpperCase().padEnd(8)}] [${g.status}] ${g.slug.padEnd(30)} ${g.title}`)
            }
          }
        } catch {
          if (json) {
            outputJson({ error: { code: 4, type: 'list_error', message: 'Failed to list gaps' } })
          } else {
            console.error('Failed to list gaps')
          }
          process.exit(4)
        }
        return
      }

      // Branch 4: no args, show help
      if (json) {
        outputJson({
          usage: 'metta fix-gap [gap-name] [--all] [--remove-gap <slug>]',
          commands: {
            'fix-gap <name>': 'Show gap details and delegate to skill',
            'fix-gap --all': 'List all gaps sorted by severity',
            'fix-gap --remove-gap <slug>': 'Remove a resolved gap',
          },
        })
      } else {
        console.log('Usage: metta fix-gap [gap-name] [--all] [--remove-gap <slug>]')
        console.log('')
        console.log('  fix-gap <name>              Show gap details and delegate to skill')
        console.log('  fix-gap --all               List all gaps sorted by severity')
        console.log('  fix-gap --remove-gap <slug> Remove a resolved gap')
      }
    })
}
