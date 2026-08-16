import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'
import { assertSafeSlug as assertSlug, toSlug } from '../util/slug.js'
import { applyFrontmatterPatch, parseIssueFrontmatter } from './issue-frontmatter.js'
import type { IssueFrontmatter, IssueFrontmatterPatch } from '../schemas/issue-frontmatter.js'

export type Severity = 'critical' | 'major' | 'minor'

export interface Issue {
  title: string
  captured: string
  context?: string
  status: 'logged'
  severity: Severity
  /** Body BELOW the frontmatter — the frontmatter block is stripped. */
  description: string
  /** Defaults applied; `undefined` for legacy (frontmatter-less) files. */
  frontmatter?: IssueFrontmatter
}

/** Enriched list row — superset of the previous `{ slug, title, severity }` shape. */
export interface IssueRecord {
  slug: string
  title: string
  severity: Severity
  /** `**Captured**` date, falling back to `**Added**` (migrated ideas). */
  captured: string
  type: 'issue' | 'idea'
  backlog: boolean
  priority?: 'high' | 'medium' | 'low'
  milestone?: string
  order?: number
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
  // Body is returned verbatim — may be a freeform paragraph or structured H2 sections.
  // H2 headings (##) in the body are safe: no metadata startsWith predicate matches '##'.
  const description = lines.slice(descStart + 1).join('\n').trim()

  return { title: title || filename.replace('.md', ''), captured, context, status: 'logged', severity, description }
}

/** `**Captured**` date, falling back to `**Added**` for migrated backlog ideas. */
function parseCaptured(body: string): string {
  const lines = body.split('\n')
  const captured = lines.find(l => l.startsWith('**Captured**:'))?.replace('**Captured**:', '').trim()
  if (captured) return captured
  return lines.find(l => l.startsWith('**Added**:'))?.replace('**Added**:', '').trim() ?? ''
}

/**
 * Parsing pipeline shared by list/listResolved/show: prefix check (files not
 * starting with `---` skip YAML entirely via `splitFrontmatter`'s offset-0
 * check) → split → strict validation when a block is present → legacy
 * bold-label `parseIssue` on the body slice.
 */
function parseIssueFile(content: string, filePath: string, filename: string): Issue {
  const { frontmatter, body } = parseIssueFrontmatter(content, filePath)
  const issue = parseIssue(body, filename)
  if (frontmatter !== undefined) issue.frontmatter = frontmatter
  return issue
}

function toRecord(slug: string, content: string, filePath: string): IssueRecord {
  const { frontmatter, body } = parseIssueFrontmatter(content, filePath)
  const issue = parseIssue(body, `${slug}.md`)
  return {
    slug,
    title: issue.title,
    severity: issue.severity,
    captured: parseCaptured(body),
    type: frontmatter?.type ?? 'issue',
    backlog: frontmatter?.backlog ?? false,
    priority: frontmatter?.priority,
    milestone: frontmatter?.milestone,
    order: frontmatter?.order,
  }
}

function assertSafeSlug(slug: string): void {
  assertSlug(slug, 'issue slug')
}

/**
 * Thrown when minting a new issue/idea whose title slugs to a file that
 * already exists (open or resolved) — the store never overwrites on create.
 */
export class IssueSlugCollisionError extends Error {
  constructor(
    readonly slug: string,
    readonly existingPath: string,
  ) {
    super(`Slug '${slug}' collides with existing ${existingPath} — refusing to overwrite`)
    this.name = 'IssueSlugCollisionError'
  }
}

export class IssuesStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  /**
   * Never-overwrite guard shared by `create`/`createIdea`: refuses when the
   * slug already names an open (`spec/issues/`) or resolved
   * (`spec/issues/resolved/`) issue file. No write happens on collision.
   */
  private async assertNoSlugCollision(slug: string): Promise<void> {
    const candidates = [
      join('issues', `${slug}.md`),
      join('issues', 'resolved', `${slug}.md`),
    ]
    for (const relPath of candidates) {
      if (await this.state.exists(relPath)) {
        throw new IssueSlugCollisionError(slug, join('spec', relPath))
      }
    }
  }

  async create(
    title: string,
    description: string,
    severity: Severity = 'minor',
    context?: string,
    frontmatter?: Pick<IssueFrontmatterPatch, 'priority' | 'milestone'>,
  ): Promise<string> {
    const slug = toSlug(title)
    await this.assertNoSlugCollision(slug)
    const issue: Issue = {
      title,
      captured: new Date().toISOString().slice(0, 10),
      context,
      status: 'logged',
      severity,
      description: description || title,
    }

    const relPath = join('issues', `${slug}.md`)
    let content = formatIssue(issue)
    if (frontmatter !== undefined) {
      content = applyFrontmatterPatch(
        content,
        { priority: frontmatter.priority, milestone: frontmatter.milestone },
        relPath,
      )
    }
    await mkdir(join(this.specDir, 'issues'), { recursive: true })
    await this.state.writeRaw(relPath, content)
    return slug
  }

  /**
   * Mints a `type: idea` entry: a frontmatter block (`type: idea`,
   * `backlog: true`, plus optional fields) above a standard `formatIssue`
   * body (Captured / Status / Severity: minor), so captured-date sorting and
   * legacy listing work uniformly for ideas.
   */
  async createIdea(
    title: string,
    description: string,
    fields?: Pick<IssueFrontmatterPatch, 'priority' | 'order' | 'milestone'>,
  ): Promise<string> {
    const slug = toSlug(title)
    await this.assertNoSlugCollision(slug)
    const issue: Issue = {
      title,
      captured: new Date().toISOString().slice(0, 10),
      status: 'logged',
      severity: 'minor',
      description: description || title,
    }

    const relPath = join('issues', `${slug}.md`)
    const content = applyFrontmatterPatch(
      formatIssue(issue),
      {
        type: 'idea',
        backlog: true,
        priority: fields?.priority,
        milestone: fields?.milestone,
        order: fields?.order,
      },
      relPath,
    )
    await mkdir(join(this.specDir, 'issues'), { recursive: true })
    await this.state.writeRaw(relPath, content)
    return slug
  }

  /**
   * Applies `applyFrontmatterPatch` to `spec/issues/<slug>.md`. Returns
   * `changed: false` when the patched output is byte-identical to the input
   * (idempotent backlog re-add) — no write happens in that case.
   */
  async updateFrontmatter(slug: string, patch: IssueFrontmatterPatch): Promise<{ changed: boolean }> {
    assertSafeSlug(slug)
    if (!(await this.exists(slug))) {
      throw new Error(`Issue '${slug}' not found`)
    }
    const relPath = join('issues', `${slug}.md`)
    const content = await this.state.readRaw(relPath)
    const patched = applyFrontmatterPatch(content, patch, relPath)
    if (patched === content) return { changed: false }
    await this.state.writeRaw(relPath, patched)
    return { changed: true }
  }

  async list(): Promise<IssueRecord[]> {
    return this.listDir('issues')
  }

  /** Same record shape over `spec/issues/resolved/` (feeds milestone rollups). */
  async listResolved(): Promise<IssueRecord[]> {
    return this.listDir(join('issues', 'resolved'))
  }

  private async listDir(relDir: string): Promise<IssueRecord[]> {
    const dir = join(this.specDir, relDir)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    const results: IssueRecord[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const relPath = join(relDir, entry)
      const content = await this.state.readRaw(relPath)
      results.push(toRecord(entry.replace('.md', ''), content, relPath))
    }
    return results
  }

  async show(slug: string): Promise<Issue> {
    assertSafeSlug(slug)
    const relPath = join('issues', `${slug}.md`)
    const content = await this.state.readRaw(relPath)
    return parseIssueFile(content, relPath, slug)
  }

  async exists(slug: string): Promise<boolean> {
    assertSafeSlug(slug)
    return this.state.exists(join('issues', `${slug}.md`))
  }

  /**
   * Copies the raw file content verbatim into `spec/issues/resolved/` —
   * frontmatter is carried through unchanged. When `changeName` is given, a
   * `**Shipped-in**` stamp is appended AFTER the body (absorbs the former
   * `BacklogStore.archive` semantics).
   */
  async archive(slug: string, changeName?: string): Promise<void> {
    assertSafeSlug(slug)
    if (changeName !== undefined) assertSlug(changeName, 'change name')
    if (!(await this.exists(slug))) {
      throw new Error(`Issue '${slug}' not found`)
    }
    let content = await this.state.readRaw(join('issues', `${slug}.md`))
    if (changeName) {
      if (!content.endsWith('\n')) content += '\n'
      content += `\n**Shipped-in**: ${changeName}\n`
    }
    await mkdir(join(this.specDir, 'issues', 'resolved'), { recursive: true })
    await this.state.writeRaw(join('issues', 'resolved', `${slug}.md`), content)
  }

  async remove(slug: string): Promise<void> {
    assertSafeSlug(slug)
    await this.state.delete(join('issues', `${slug}.md`))
  }
}
