import { Command } from 'commander'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { autoCommitFile, outputJson, type AutoCommitResult } from '../helpers.js'
import { workflowPrimerLong } from '../../delivery/workflow-primer.js'

/** Marker pair definition */
interface MarkerSection {
  startTag: string
  endTag: string
  content: string
}

/** Spec summary row */
export interface SpecRow {
  capability: string
  requirements: number
}

/**
 * Parse spec/project.md and extract named sections by heading.
 * Returns a map of heading name (lowercase) to body text.
 */
export function parseConstitution(text: string): Map<string, string> {
  const sections = new Map<string, string>()
  const lines = text.split('\n')
  let currentKey: string | null = null
  let buf: string[] = []

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/)
    if (headingMatch) {
      if (currentKey !== null) {
        sections.set(currentKey, buf.join('\n').trim())
      }
      currentKey = headingMatch[1].trim().toLowerCase()
      buf = []
    } else if (currentKey !== null) {
      buf.push(line)
    }
  }
  if (currentKey !== null) {
    sections.set(currentKey, buf.join('\n').trim())
  }
  return sections
}

/**
 * Count RFC 2119 MUST/SHALL requirements in a spec file.
 */
export function countRequirements(specText: string): number {
  const matches = specText.match(/\b(MUST|SHALL)\b/g)
  return matches ? matches.length : 0
}

/**
 * Build the project section content from constitution.
 */
export function buildProjectSection(constitution: Map<string, string>): string {
  const project = constitution.get('project') ?? ''
  const stack = constitution.get('stack') ?? ''
  const lines: string[] = []
  lines.push('## Project\n')
  lines.push(`**metta** -- ${project}`)
  if (stack) {
    const stackItems = stack
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.replace(/^-\s*/, '').trim())
    lines.push(`\nStack: ${stackItems.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Build the conventions section from constitution.
 */
export function buildConventionsSection(constitution: Map<string, string>): string {
  const conventions = constitution.get('conventions') ?? ''
  const offLimits = constitution.get('off-limits') ?? ''
  const lines: string[] = []
  lines.push('## Conventions\n')

  if (conventions) {
    for (const line of conventions.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('-')) {
        lines.push(trimmed)
      }
    }
  }

  if (offLimits) {
    for (const line of offLimits.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('-')) {
        lines.push(trimmed)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Build the specs table section.
 */
export function buildSpecsSection(specs: SpecRow[]): string {
  const lines: string[] = []
  lines.push('## Active Specs\n')
  lines.push('| Capability | Requirements |')
  lines.push('|------------|-------------|')
  for (const s of specs) {
    lines.push(`| ${s.capability} | ${s.requirements} |`)
  }
  return lines.join('\n')
}

/**
 * Build the full command reference section.
 */
export function buildWorkflowSection(): string {
  const lines: string[] = []
  lines.push('## Metta Workflow\n')

  lines.push(...workflowPrimerLong())
  lines.push('')

  lines.push('### Lifecycle skills')
  lines.push('- `/metta-propose <description>` — start a new change (standard workflow)')
  lines.push('- `/metta-quick <description>` — quick mode, skip planning')
  lines.push('- `/metta-auto <description>` — full lifecycle loop (discover → build → verify → ship)')
  lines.push('- `/metta-plan` — build planning artifacts for the active change')
  lines.push('- `/metta-execute` — run implementation for the active change')
  lines.push('- `/metta-verify` — verify implementation against spec')
  lines.push('- `/metta-ship` — finalize, merge specs, merge branch to main\n')

  lines.push('### Status skills')
  lines.push('- `/metta-status` — current change status')
  lines.push('- `/metta-progress` — project-level dashboard across all changes')
  lines.push('- `/metta-next` — route to the next logical step in the workflow\n')

  lines.push('### Organization skills')
  lines.push('- `/metta-issue <description>` — log an issue')
  lines.push('- `/metta-fix-issues <slug>` — resolve one or more logged issues')
  lines.push('- `/metta-backlog` — manage backlog items\n')

  lines.push('### Spec management skills')
  lines.push('- `/metta-import` — analyze existing code and generate specs with gap reports')
  lines.push('- `/metta-fix-gap` — resolve reconciliation gaps through the change lifecycle')
  lines.push('- `/metta-check-constitution` — check a change against the project constitution\n')

  lines.push('### Setup skills')
  lines.push('- `/metta-init` — initialize Metta in a project (interactive discovery)')
  lines.push('- `/metta-refresh` — regenerate CLAUDE.md from constitution and specs')

  return lines.join('\n')
}

/**
 * Build the reference section.
 */
export function buildReferenceSection(): string {
  const lines: string[] = []
  lines.push('## Table of Contents\n')
  lines.push('| Resource | Path | Description |')
  lines.push('|----------|------|-------------|')
  lines.push('| [Constitution](spec/project.md) | `spec/project.md` | Project principles, stack, conventions, constraints |')
  lines.push('| [Active Specs](spec/specs/) | `spec/specs/` | Living specifications per capability |')
  lines.push('| [Active Changes](spec/changes/) | `spec/changes/` | Work in flight |')
  lines.push('| [Archive](spec/archive/) | `spec/archive/` | Completed changes with artifacts |')
  lines.push('| [Gaps](spec/gaps/) | `spec/gaps/` | Reconciliation gaps (spec vs code) |')
  lines.push('| [Issues](spec/issues/) | `spec/issues/` | Logged issues |')
  lines.push('| [Backlog](spec/backlog/) | `spec/backlog/` | Prioritized backlog items |')
  lines.push('| [Architecture](docs/architecture.md) | `docs/architecture.md` | System design and components |')
  lines.push('| [API Reference](docs/api.md) | `docs/api.md` | Capabilities and scenarios |')
  lines.push('| [Changelog](docs/changelog.md) | `docs/changelog.md` | What changed and when |')
  lines.push('| [Getting Started](docs/getting-started.md) | `docs/getting-started.md` | Setup and quick start |')
  return lines.join('\n')
}

/**
 * Replace content between marker pairs in a file, or append if missing.
 */
export function replaceMarkerContent(fileContent: string, sections: MarkerSection[]): string {
  let result = fileContent

  for (const section of sections) {
    const startIdx = result.indexOf(section.startTag)
    const endIdx = result.indexOf(section.endTag)

    if (startIdx !== -1 && endIdx !== -1) {
      const before = result.substring(0, startIdx + section.startTag.length)
      const after = result.substring(endIdx)
      result = before + '\n' + section.content + '\n' + after
    } else {
      // Append if markers don't exist
      result = result.trimEnd() + '\n\n' + section.startTag + '\n' + section.content + '\n' + section.endTag + '\n'
    }
  }

  return result
}

/**
 * Scan spec/specs/ directories and count requirements per spec.
 */
async function scanSpecs(projectRoot: string): Promise<SpecRow[]> {
  const specsDir = join(projectRoot, 'spec', 'specs')
  if (!existsSync(specsDir)) return []

  const entries = await readdir(specsDir, { withFileTypes: true })
  const rows: SpecRow[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const specFile = join(specsDir, entry.name, 'spec.md')
    if (!existsSync(specFile)) continue

    const text = await readFile(specFile, 'utf-8')
    const reqs = countRequirements(text)
    rows.push({ capability: entry.name, requirements: reqs })
  }

  return rows.sort((a, b) => a.capability.localeCompare(b.capability))
}

/**
 * Run the full refresh: read constitution, scan specs, generate CLAUDE.md content.
 */
export async function runRefresh(projectRoot: string, dryRun: boolean): Promise<{ diff: string; written: boolean; filePath: string }> {
  const constitutionPath = join(projectRoot, 'spec', 'project.md')
  const claudeMdPath = join(projectRoot, 'CLAUDE.md')

  // 1. Read and parse constitution
  let constitution = new Map<string, string>()
  if (existsSync(constitutionPath)) {
    const text = await readFile(constitutionPath, 'utf-8')
    constitution = parseConstitution(text)
  }

  // 2. Scan specs
  const specs = await scanSpecs(projectRoot)

  // 3. Build marker sections
  const markerSections: MarkerSection[] = [
    {
      startTag: '<!-- metta:project-start source:spec/project.md -->',
      endTag: '<!-- metta:project-end -->',
      content: buildProjectSection(constitution),
    },
    {
      startTag: '<!-- metta:reference-start -->',
      endTag: '<!-- metta:reference-end -->',
      content: buildReferenceSection(),
    },
    {
      startTag: '<!-- metta:conventions-start source:spec/project.md -->',
      endTag: '<!-- metta:conventions-end -->',
      content: buildConventionsSection(constitution),
    },
    {
      startTag: '<!-- metta:specs-start source:spec/specs/ -->',
      endTag: '<!-- metta:specs-end -->',
      content: buildSpecsSection(specs),
    },
    {
      startTag: '<!-- metta:workflow-start -->',
      endTag: '<!-- metta:workflow-end -->',
      content: buildWorkflowSection(),
    },
  ]

  // 4. Read existing CLAUDE.md or start fresh
  let existing = ''
  if (existsSync(claudeMdPath)) {
    existing = await readFile(claudeMdPath, 'utf-8')
  } else {
    existing = '# metta\n'
  }

  // 5. Replace marker content
  const updated = replaceMarkerContent(existing, markerSections)

  // 6. Compute diff summary
  const diff = existing === updated ? 'No changes.' : buildDiffSummary(existing, updated)

  // 7. Write if not dry run
  if (!dryRun && existing !== updated) {
    await writeFile(claudeMdPath, updated, 'utf-8')
  }

  return { diff, written: !dryRun && existing !== updated, filePath: claudeMdPath }
}

function buildDiffSummary(before: string, after: string): string {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const lines: string[] = []
  lines.push(`--- CLAUDE.md (${beforeLines.length} lines)`)
  lines.push(`+++ CLAUDE.md (${afterLines.length} lines)`)

  // Show which marker sections changed
  const markers = ['project', 'conventions', 'specs', 'reference', 'workflow']
  for (const m of markers) {
    const startTag = `<!-- metta:${m}-start`
    const beforeHas = before.includes(startTag)
    const afterHas = after.includes(startTag)
    if (!beforeHas && afterHas) {
      lines.push(`  + added section: ${m}`)
    } else if (beforeHas && afterHas) {
      lines.push(`  ~ updated section: ${m}`)
    }
  }

  return lines.join('\n')
}

export function registerRefreshCommand(program: Command): void {
  program
    .command('refresh')
    .description('Regenerate CLAUDE.md from constitution and specs')
    .option('--dry-run', 'Preview changes without writing')
    .option('--no-commit', 'Skip auto-commit of regenerated CLAUDE.md')
    .action(async (options) => {
      const json = program.opts().json
      const projectRoot = process.cwd()

      try {
        const result = await runRefresh(projectRoot, options.dryRun ?? false)

        let commitResult: AutoCommitResult | undefined
        if (result.written && options.commit !== false) {
          commitResult = await autoCommitFile(
            projectRoot,
            result.filePath,
            'chore(refresh): regenerate CLAUDE.md',
          )
        }

        if (json) {
          outputJson({
            status: options.dryRun ? 'dry_run' : (result.written ? 'refreshed' : 'no_changes'),
            file: result.filePath,
            diff: result.diff,
            committed: commitResult?.committed ?? false,
            commit_sha: commitResult?.sha,
            commit_reason: commitResult?.reason,
          })
        } else {
          if (options.dryRun) {
            console.log('Dry run preview:\n')
            console.log(result.diff)
          } else if (result.written) {
            console.log('Refresh complete. Updated CLAUDE.md')
            if (commitResult?.committed) {
              console.log(`  Committed: ${commitResult.sha?.slice(0, 7)}`)
            } else if (commitResult?.reason) {
              console.log(`  Not committed: ${commitResult.reason}`)
            }
          } else {
            console.log('CLAUDE.md is already up to date.')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) {
          outputJson({ error: { code: 4, type: 'refresh_error', message } })
        } else {
          console.error(`Error: ${message}`)
        }
        process.exit(4)
      }
    })
}
