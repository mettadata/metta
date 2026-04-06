import { Command } from 'commander'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { outputJson } from '../helpers.js'

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

  lines.push('### Lifecycle')
  lines.push('- `metta propose <description>` -- start a new change (standard workflow)')
  lines.push('- `metta quick <description>` -- quick mode (skip planning)')
  lines.push('- `metta auto <description>` -- full lifecycle loop')
  lines.push('- `metta plan` -- build planning artifacts')
  lines.push('- `metta execute` -- run implementation')
  lines.push('- `metta verify` -- check against spec')
  lines.push('- `metta finalize` -- archive, merge specs, run gates')
  lines.push('- `metta ship` -- merge branch to main\n')

  lines.push('### Status')
  lines.push('- `metta status` -- current change status')
  lines.push('- `metta progress` -- project-level dashboard')
  lines.push('- `metta next` -- what to do next')
  lines.push('- `metta complete <artifact>` -- mark artifact done\n')

  lines.push('### Specs & Docs')
  lines.push('- `metta specs list` -- list specifications')
  lines.push('- `metta docs generate` -- generate project documentation')
  lines.push('- `metta import .` -- import existing code into specs')
  lines.push('- `metta gaps list` -- show reconciliation gaps')
  lines.push('- `metta fix-gap --all` -- fix gaps automatically\n')

  lines.push('### Organization')
  lines.push('- `metta idea <description>` -- capture an idea')
  lines.push('- `metta issue <description>` -- log an issue')
  lines.push('- `metta changes list` -- list active changes')
  lines.push('- `metta backlog list` -- list backlog items\n')

  lines.push('### System')
  lines.push('- `metta doctor` -- diagnose environment')
  lines.push('- `metta config get <key>` -- read configuration')
  lines.push('- `metta gate run <name>` -- run a quality gate')
  lines.push('- `metta refresh` -- regenerate CLAUDE.md and derived files')
  lines.push('- `metta update` -- update framework')

  return lines.join('\n')
}

/**
 * Build the reference section.
 */
export function buildReferenceSection(): string {
  const lines: string[] = []
  lines.push('## Reference\n')
  lines.push('- [Project Constitution](spec/project.md)')
  lines.push('- [Active Specs](spec/specs/)')
  lines.push('- [Archive](spec/archive/)')
  lines.push('- [Docs](docs/)')
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
      startTag: '<!-- metta:reference-start -->',
      endTag: '<!-- metta:reference-end -->',
      content: buildReferenceSection(),
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
    .action(async (options) => {
      const json = program.opts().json
      const projectRoot = process.cwd()

      try {
        const result = await runRefresh(projectRoot, options.dryRun ?? false)

        if (json) {
          outputJson({
            status: options.dryRun ? 'dry_run' : (result.written ? 'refreshed' : 'no_changes'),
            file: result.filePath,
            diff: result.diff,
          })
        } else {
          if (options.dryRun) {
            console.log('Dry run preview:\n')
            console.log(result.diff)
          } else if (result.written) {
            console.log('Refresh complete. Updated CLAUDE.md')
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
