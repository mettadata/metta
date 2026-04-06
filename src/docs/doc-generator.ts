import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { DocsConfig } from '../schemas/project-config.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DocType = 'architecture' | 'api' | 'changelog' | 'getting-started'

export const VALID_DOC_TYPES: readonly DocType[] = [
  'architecture',
  'api',
  'changelog',
  'getting-started',
] as const

export interface DocGenerateResult {
  generated: string[]
  skipped: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RequirementEntry {
  heading: string
  scenarios: string[]
}

interface CapabilityEntry {
  name: string
  label: string
  specPath: string
  requirements: RequirementEntry[]
}

interface AdrEntry {
  title: string
  content: string
}

interface ArchiveEntry {
  dirName: string
  date: string
  changeName: string
  designPath: string
  summaryPath: string
  adrs: AdrEntry[]
  summaryContent: string | null
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class DocGeneratorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocGeneratorError'
  }
}

// ---------------------------------------------------------------------------
// DocGenerator
// ---------------------------------------------------------------------------

const ALL_DOC_TYPES: DocType[] = ['architecture', 'api', 'changelog', 'getting-started']

export class DocGenerator {
  private readonly resolvedTemplateDir: string
  private currentWarnings: string[] = []

  constructor(
    private specDir: string,
    private projectRoot: string,
    private config: DocsConfig,
    templateDir?: string,
  ) {
    this.resolvedTemplateDir = templateDir
      ?? new URL('../../templates/docs', import.meta.url).pathname
  }

  // -----------------------------------------------------------------------
  // Public
  // -----------------------------------------------------------------------

  async generate(types?: DocType[], dryRun: boolean = false): Promise<DocGenerateResult> {
    const requested = types ?? (this.config.types as DocType[])
    const result: DocGenerateResult = { generated: [], skipped: [], warnings: [] }

    for (const t of ALL_DOC_TYPES) {
      if (!requested.includes(t)) {
        result.skipped.push(t)
      }
    }

    const outputDir = join(this.projectRoot, this.config.output)
    if (!dryRun) {
      await mkdir(outputDir, { recursive: true })
    }

    const generators: Record<DocType, (sources: string[]) => Promise<string>> = {
      'architecture': (s) => this.generateArchitecture(s),
      'api': (s) => this.generateApi(s),
      'changelog': (s) => this.generateChangelog(s),
      'getting-started': (s) => this.generateGettingStarted(s),
    }

    for (const docType of requested) {
      const sources: string[] = []
      const content = await generators[docType](sources)
      const header = this.buildHeader(sources)
      const fullContent = header + '\n' + content
      const outPath = join(outputDir, `${docType}.md`)

      if (!dryRun) {
        await writeFile(outPath, fullContent, 'utf-8')
      }
      result.generated.push(outPath)
    }

    result.warnings.push(...this.currentWarnings)
    this.currentWarnings = []

    return result
  }

  // -----------------------------------------------------------------------
  // Warning accumulator
  // -----------------------------------------------------------------------

  private warn(msg: string): void {
    this.currentWarnings.push(msg)
  }

  // -----------------------------------------------------------------------
  // Private generators
  // -----------------------------------------------------------------------

  private async generateArchitecture(sources: string[]): Promise<string> {
    const capabilities = await this.loadCapabilities()
    const archiveEntries = await this.loadArchiveEntries()

    for (const cap of capabilities) sources.push(cap.specPath)
    for (const entry of archiveEntries) {
      if (entry.adrs.length > 0) sources.push(entry.designPath)
    }

    const adrs: Array<{ title: string; content: string; source: string }> = []
    for (const entry of archiveEntries) {
      for (const adr of entry.adrs) {
        adrs.push({ title: adr.title, content: adr.content, source: entry.dirName })
      }
    }

    const lines: string[] = ['# Architecture\n']

    lines.push('## Components\n')
    for (const cap of capabilities) {
      lines.push(`### ${cap.label}`)
      lines.push(`${cap.requirements.length} requirements\n`)
    }

    if (adrs.length > 0) {
      lines.push('\n## Architectural Decision Records\n')
      for (const adr of adrs) {
        lines.push(`### ${adr.title}`)
        lines.push(`${adr.content}\n`)
      }
    }

    return lines.join('\n')
  }

  private async generateApi(sources: string[]): Promise<string> {
    const capabilities = await this.loadCapabilities()
    capabilities.sort((a, b) => a.name.localeCompare(b.name))

    for (const cap of capabilities) sources.push(cap.specPath)

    const lines: string[] = ['# API Reference\n']

    for (const cap of capabilities) {
      lines.push(`## ${cap.label}\n`)
      for (const req of cap.requirements) {
        lines.push(`### ${req.heading}`)
        if (req.scenarios.length > 0) {
          lines.push('\nScenarios:')
          for (const s of req.scenarios) {
            lines.push(`- ${s}`)
          }
        }
        lines.push('')
      }
    }

    return lines.join('\n')
  }

  private async generateChangelog(sources: string[]): Promise<string> {
    const archiveEntries = await this.loadArchiveEntries()

    const entries: Array<{ date: string; changeName: string; summaryContent: string }> = []
    for (const entry of archiveEntries) {
      if (entry.summaryContent === null) {
        this.warn(`Archive entry '${entry.dirName}' is missing summary.md — skipped in changelog`)
        continue
      }
      sources.push(entry.summaryPath)
      entries.push({
        date: entry.date,
        changeName: entry.changeName,
        summaryContent: entry.summaryContent,
      })
    }

    const lines: string[] = ['# Changelog\n']

    for (const entry of entries) {
      lines.push(`## ${entry.date} — ${entry.changeName}\n`)
      lines.push(entry.summaryContent)
      lines.push('')
    }

    if (entries.length === 0) {
      lines.push('No archived changes with summaries found.\n')
    }

    return lines.join('\n')
  }

  private async generateGettingStarted(sources: string[]): Promise<string> {
    const projectPath = join(this.specDir, 'project.md')
    sources.push(projectPath)

    let projectContent = ''
    try {
      projectContent = await readFile(projectPath, 'utf-8')
    } catch {
      this.warn('spec/project.md not found — getting-started will have limited content')
    }

    const expectedSections = ['Project', 'Stack', 'Conventions', 'Architectural Constraints']
    const sections: Record<string, string | null> = {}

    for (const heading of expectedSections) {
      const extracted = this.extractSection(projectContent, heading)
      if (extracted === null) {
        this.warn(`Missing section '## ${heading}' in spec/project.md`)
      }
      sections[heading] = extracted
    }

    const lines: string[] = ['# Getting Started\n']

    if (sections['Project']) {
      lines.push('## Project\n')
      lines.push(sections['Project'])
      lines.push('')
    }

    if (sections['Stack']) {
      lines.push('## Stack\n')
      lines.push(sections['Stack'])
      lines.push('')
    }

    if (sections['Conventions']) {
      lines.push('## Conventions\n')
      lines.push(sections['Conventions'])
      lines.push('')
    }

    if (sections['Architectural Constraints']) {
      lines.push('## Architectural Constraints\n')
      lines.push(sections['Architectural Constraints'])
      lines.push('')
    }

    lines.push('## Quick Start\n')
    lines.push('```bash')
    lines.push('metta install')
    lines.push('metta propose <description>')
    lines.push('metta plan')
    lines.push('metta execute')
    lines.push('metta verify')
    lines.push('metta ship')
    lines.push('```')
    lines.push('')

    return lines.join('\n')
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async loadCapabilities(): Promise<CapabilityEntry[]> {
    const specsDir = join(this.specDir, 'specs')
    let dirs: string[] = []
    try {
      const entries = await readdir(specsDir, { withFileTypes: true })
      dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      this.warn('Could not read spec/specs/ directory')
      return []
    }

    dirs.sort()
    const capabilities: CapabilityEntry[] = []

    for (const dir of dirs) {
      const specPath = join(specsDir, dir, 'spec.md')
      try {
        const content = await readFile(specPath, 'utf-8')
        const label = this.extractFirstHeading(content) ?? dir
        const requirements = this.parseRequirements(content)
        capabilities.push({ name: dir, label, specPath, requirements })
      } catch {
        this.warn(`Could not read spec file: spec/specs/${dir}/spec.md`)
      }
    }

    return capabilities
  }

  private async loadArchiveEntries(): Promise<ArchiveEntry[]> {
    const archiveDir = join(this.specDir, 'archive')
    let dirs: string[] = []
    try {
      const entries = await readdir(archiveDir, { withFileTypes: true })
      dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }

    const datePattern = /^(\d{4}-\d{2}-\d{2})-(.+)$/
    const results: ArchiveEntry[] = []

    for (const dir of dirs) {
      const match = datePattern.exec(dir)
      if (!match) {
        this.warn(`Archive directory '${dir}' does not have YYYY-MM-DD prefix — skipped`)
        continue
      }

      const date = match[1]
      const changeName = match[2]
      const designPath = join(archiveDir, dir, 'design.md')
      const summaryPath = join(archiveDir, dir, 'summary.md')

      let adrs: AdrEntry[] = []
      try {
        const designContent = await readFile(designPath, 'utf-8')
        adrs = this.parseAdrs(designContent)
      } catch {
        // design.md missing — no ADRs from this entry
      }

      let summaryContent: string | null = null
      try {
        summaryContent = await readFile(summaryPath, 'utf-8')
      } catch {
        // summary.md missing — handled by caller
      }

      results.push({ dirName: dir, date, changeName, designPath, summaryPath, adrs, summaryContent })
    }

    // Reverse-chrono: date desc, then full dir name desc for ties
    results.sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date)
      if (dateCmp !== 0) return dateCmp
      return b.dirName.localeCompare(a.dirName)
    })

    return results
  }

  private async loadTemplate(type: DocType): Promise<string> {
    const templatePath = join(this.resolvedTemplateDir, `${type}.md.hbs`)
    try {
      return await readFile(templatePath, 'utf-8')
    } catch {
      throw new DocGeneratorError(
        `Template file not found: ${templatePath}. ` +
        `Ensure the project has been built (npm run build) so templates are copied to dist/.`,
      )
    }
  }

  renderTemplate(template: string, vars: Record<string, unknown>): string {
    let result = template

    // Process {{#each <key>}}...{{/each}} blocks
    result = result.replace(
      /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_match, key: string, body: string) => {
        const items = vars[key]
        if (!Array.isArray(items) || items.length === 0) return ''
        return items.map(item => {
          let rendered = body
          // Handle nested {{#each}} blocks within items
          rendered = rendered.replace(
            /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
            (_m2, nestedKey: string, nestedBody: string) => {
              const nestedItems = (item as Record<string, unknown>)[nestedKey]
              if (!Array.isArray(nestedItems) || nestedItems.length === 0) return ''
              return nestedItems.map(nestedItem => {
                if (typeof nestedItem === 'string') {
                  return nestedBody.replace(/\{\{this\}\}/g, nestedItem)
                }
                return nestedBody.replace(/\{\{(\w+)\}\}/g, (_m3, prop: string) => {
                  return String((nestedItem as Record<string, unknown>)[prop] ?? '')
                })
              }).join('')
            },
          )
          // Replace {{property}} within the block
          rendered = rendered.replace(/\{\{(\w+)\}\}/g, (_m, prop: string) => {
            if (prop in (item as Record<string, unknown>)) {
              return String((item as Record<string, unknown>)[prop] ?? '')
            }
            if (prop in vars) {
              return String(vars[prop] ?? '')
            }
            return ''
          })
          return rendered
        }).join('')
      },
    )

    // Process {{#if <key>}}...{{/if}} blocks
    result = result.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_match, key: string, body: string) => {
        const val = vars[key]
        if (!val) return ''
        return body.replace(/\{\{(\w+)\}\}/g, (_m, prop: string) => {
          return String(vars[prop] ?? '')
        })
      },
    )

    // Process {{#unless <key>}}...{{/unless}} blocks
    result = result.replace(
      /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
      (_match, key: string, body: string) => {
        const val = vars[key]
        if (val) return ''
        return body
      },
    )

    // Replace remaining simple {{variable}} tokens
    result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      return String(vars[key] ?? '')
    })

    return result
  }

  buildHeader(sourcePaths: string[]): string {
    const line1 = '<!-- Generated by Metta — do not edit directly -->'
    const paths = sourcePaths.map(p => relative(this.projectRoot, p))
    const fullList = paths.join(', ')

    let sourceLine: string
    if (fullList.length > 120) {
      let accumulated = ''
      let count = 0
      for (const p of paths) {
        const candidate = count === 0 ? p : accumulated + ', ' + p
        if (candidate.length > 110) break
        accumulated = candidate
        count++
      }
      const remaining = paths.length - count
      sourceLine = `<!-- Sources: ${accumulated}...and ${remaining} more -->`
    } else {
      sourceLine = `<!-- Sources: ${fullList} -->`
    }

    const line3 = '<!-- Run `metta docs generate` to regenerate -->'
    return `${line1}\n${sourceLine}\n${line3}`
  }

  // -----------------------------------------------------------------------
  // Markdown parsing helpers
  // -----------------------------------------------------------------------

  private extractFirstHeading(content: string): string | null {
    const match = /^#\s+(.+)$/m.exec(content)
    return match ? match[1].trim() : null
  }

  private extractSection(content: string, heading: string): string | null {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
      'm',
    )
    const match = pattern.exec(content)
    if (!match) return null
    return match[1].trim()
  }

  private parseRequirements(content: string): RequirementEntry[] {
    const requirements: RequirementEntry[] = []
    const lines = content.split('\n')
    let currentReq: RequirementEntry | null = null

    for (const line of lines) {
      const reqMatch = /^## Requirement:\s*(.+)$/.exec(line)
      if (reqMatch) {
        if (currentReq) requirements.push(currentReq)
        currentReq = { heading: reqMatch[1].trim(), scenarios: [] }
        continue
      }

      const scenarioMatch = /^### Scenario:\s*(.+)$/.exec(line)
      if (scenarioMatch && currentReq) {
        currentReq.scenarios.push(scenarioMatch[1].trim())
      }
    }

    if (currentReq) requirements.push(currentReq)
    return requirements
  }

  private parseAdrs(content: string): AdrEntry[] {
    const adrs: AdrEntry[] = []
    const sections = content.split(/^### ADR-/m)

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i]
      const firstNewline = section.indexOf('\n')
      const titleLine = firstNewline >= 0 ? section.slice(0, firstNewline) : section
      const body = firstNewline >= 0 ? section.slice(firstNewline + 1) : ''

      const contentEnd = body.search(/^#{1,3}\s/m)
      const adrContent = contentEnd >= 0 ? body.slice(0, contentEnd) : body

      adrs.push({
        title: `ADR-${titleLine.trim()}`,
        content: adrContent.trim(),
      })
    }

    return adrs
  }
}
