import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'

export type Severity = 'critical' | 'major' | 'minor'

export interface Issue {
  title: string
  captured: string
  context?: string
  status: 'logged'
  severity: Severity
  description: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function formatIssue(issue: Issue): string {
  const lines = [
    `# ${issue.title}`,
    '',
    `**Captured**: ${issue.captured}`,
  ]
  if (issue.context) {
    lines.push(`**Context**: ${issue.context}`)
  }
  lines.push(`**Status**: ${issue.status}`)
  lines.push(`**Severity**: ${issue.severity}`)
  lines.push('')
  lines.push(issue.description)
  lines.push('')
  return lines.join('\n')
}

function parseIssue(content: string, filename: string): Issue {
  const lines = content.split('\n')
  const title = (lines[0] ?? '').replace(/^#\s*/, '').trim()
  const captured = lines.find(l => l.startsWith('**Captured**:'))?.replace('**Captured**:', '').trim() ?? ''
  const context = lines.find(l => l.startsWith('**Context**:'))?.replace('**Context**:', '').trim()
  const severityLine = lines.find(l => l.startsWith('**Severity**:'))?.replace('**Severity**:', '').trim()
  const severity = (['critical', 'major', 'minor'].includes(severityLine ?? '') ? severityLine : 'minor') as Severity

  const descStart = lines.findIndex((l, i) => i > 0 && l.startsWith('**Severity**:'))
  const description = lines.slice(descStart + 1).join('\n').trim()

  return { title: title || filename.replace('.md', ''), captured, context, status: 'logged', severity, description }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

function assertSafeSlug(slug: string): void {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid issue slug '${slug}' — must match ${SLUG_RE}`)
  }
}

export class IssuesStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async create(title: string, description: string, severity: Severity = 'minor', context?: string): Promise<string> {
    const slug = slugify(title)
    const issue: Issue = {
      title,
      captured: new Date().toISOString().slice(0, 10),
      context,
      status: 'logged',
      severity,
      description: description || title,
    }

    await mkdir(join(this.specDir, 'issues'), { recursive: true })
    await this.state.writeRaw(join('issues', `${slug}.md`), formatIssue(issue))
    return slug
  }

  async list(): Promise<Array<{ slug: string; title: string; severity: Severity }>> {
    const issuesDir = join(this.specDir, 'issues')
    try {
      const entries = await readdir(issuesDir)
      const results: Array<{ slug: string; title: string; severity: Severity }> = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await this.state.readRaw(join('issues', entry))
        const issue = parseIssue(content, entry)
        results.push({
          slug: entry.replace('.md', ''),
          title: issue.title,
          severity: issue.severity,
        })
      }
      return results
    } catch {
      return []
    }
  }

  async show(slug: string): Promise<Issue> {
    assertSafeSlug(slug)
    const content = await this.state.readRaw(join('issues', `${slug}.md`))
    return parseIssue(content, slug)
  }

  async exists(slug: string): Promise<boolean> {
    assertSafeSlug(slug)
    return this.state.exists(join('issues', `${slug}.md`))
  }

  async archive(slug: string): Promise<void> {
    assertSafeSlug(slug)
    if (!(await this.exists(slug))) {
      throw new Error(`Issue '${slug}' not found`)
    }
    const content = await this.state.readRaw(join('issues', `${slug}.md`))
    await mkdir(join(this.specDir, 'issues', 'resolved'), { recursive: true })
    await this.state.writeRaw(join('issues', 'resolved', `${slug}.md`), content)
  }

  async remove(slug: string): Promise<void> {
    assertSafeSlug(slug)
    await this.state.delete(join('issues', `${slug}.md`))
  }
}
