import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import { StateStore } from '../state/state-store.js'
import { assertSafeSlug as assertSlug } from '../util/slug.js'
import { formatZodError } from '../util/format-zod-error.js'
import { MilestoneFrontmatterSchema } from '../schemas/milestone-frontmatter.js'
import type { MilestoneFrontmatter } from '../schemas/milestone-frontmatter.js'

export interface Milestone {
  slug: string
  name: string
  target?: string
  status: MilestoneFrontmatter['status']
  description: string
}

export interface MilestonePatch {
  name?: string
  target?: string
  clearTarget?: boolean
  status?: Milestone['status']
  description?: string
}

// Frontmatter block at offset 0: opening fence, YAML lines, closing fence on
// its own line (file may end right at the closing fence). CRLF tolerated.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function assertSafeSlug(slug: string): void {
  assertSlug(slug, 'milestone slug')
}

function validateFrontmatter(data: unknown, filePath: string): MilestoneFrontmatter {
  const result = MilestoneFrontmatterSchema.safeParse(data)
  if (!result.success) {
    throw new Error(
      `Invalid milestone frontmatter in ${filePath}:\n${formatZodError(result.error, { prefix: '  - ' })}`,
    )
  }
  return result.data
}

function parseMilestone(content: string, slug: string, filePath: string): Milestone {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) {
    throw new Error(`Invalid milestone file ${filePath}: missing YAML frontmatter block`)
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(match[1])
  } catch (err) {
    throw new Error(
      `Invalid milestone file ${filePath}: frontmatter is not valid YAML (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid milestone file ${filePath}: frontmatter must be a YAML mapping`)
  }

  const frontmatter = validateFrontmatter(parsed, filePath)
  const description = content.slice(match[0].length).trim()

  return {
    slug,
    name: frontmatter.name,
    target: frontmatter.target,
    status: frontmatter.status,
    description,
  }
}

function formatMilestone(frontmatter: MilestoneFrontmatter, description: string): string {
  // keepUndefined stays false (the yaml default), so an absent target is
  // omitted from the block rather than serialized as `target: null`.
  const block = YAML.stringify(frontmatter)
  const body = description.trim()
  return body.length > 0 ? `---\n${block}---\n${body}\n` : `---\n${block}---\n`
}

/**
 * CRUD over `spec/milestones/<slug>.md` — one file per milestone, Zod-validated
 * YAML frontmatter (name/target/status) above a free-form description body.
 * Sibling of `IssuesStore`: wraps `StateStore` for raw I/O, never overwrites
 * an existing milestone file.
 */
export class MilestonesStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async create(slug: string, fields: { name: string; target?: string; description?: string }): Promise<void> {
    assertSafeSlug(slug)

    const relPath = join('milestones', `${slug}.md`)
    if (await this.state.exists(relPath)) {
      throw new Error(`Milestone '${slug}' already exists at spec/milestones/${slug}.md`)
    }

    // Validate before write (defaults applied: status → 'open') — no
    // unvalidated state writes.
    const frontmatter = validateFrontmatter(
      {
        name: fields.name,
        ...(fields.target !== undefined ? { target: fields.target } : {}),
      },
      relPath,
    )

    await mkdir(join(this.specDir, 'milestones'), { recursive: true })
    await this.state.writeRaw(relPath, formatMilestone(frontmatter, fields.description ?? ''))
  }

  async list(): Promise<Milestone[]> {
    const milestonesDir = join(this.specDir, 'milestones')
    let entries: string[]
    try {
      entries = await readdir(milestonesDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }

    const results: Milestone[] = []
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.md')) continue
      const relPath = join('milestones', entry)
      const content = await this.state.readRaw(relPath)
      results.push(parseMilestone(content, entry.replace(/\.md$/, ''), relPath))
    }
    return results
  }

  async show(slug: string): Promise<Milestone> {
    assertSafeSlug(slug)
    const relPath = join('milestones', `${slug}.md`)
    if (!(await this.state.exists(relPath))) {
      throw new Error(`Milestone '${slug}' not found`)
    }
    const content = await this.state.readRaw(relPath)
    return parseMilestone(content, slug, relPath)
  }

  async update(slug: string, patch: MilestonePatch): Promise<Milestone> {
    assertSafeSlug(slug)

    if (patch.target !== undefined && patch.clearTarget) {
      throw new Error('clearTarget and target are mutually exclusive')
    }

    const relPath = join('milestones', `${slug}.md`)
    if (!(await this.state.exists(relPath))) {
      throw new Error(`Milestone '${slug}' not found`)
    }

    const content = await this.state.readRaw(relPath)
    const current = parseMilestone(content, slug, relPath)

    const nextTarget = patch.clearTarget ? undefined : (patch.target ?? current.target)
    const next = {
      name: patch.name ?? current.name,
      ...(nextTarget !== undefined ? { target: nextTarget } : {}),
      status: patch.status ?? current.status,
    }

    // Full resulting frontmatter re-validated before any I/O — a failing
    // patch throws here and the file stays byte-identical by construction.
    const validated = validateFrontmatter(next, relPath)

    const description = patch.description ?? current.description
    await this.state.writeRaw(relPath, formatMilestone(validated, description))

    return {
      slug,
      name: validated.name,
      target: validated.target,
      status: validated.status,
      description: description.trim(),
    }
  }

  async exists(slug: string): Promise<boolean> {
    assertSafeSlug(slug)
    return this.state.exists(join('milestones', `${slug}.md`))
  }
}
