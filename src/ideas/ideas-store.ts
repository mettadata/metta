import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'

export interface Idea {
  title: string
  captured: string
  captured_during?: string
  status: 'idea'
  description: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function formatIdea(idea: Idea): string {
  const lines = [
    `# ${idea.title}`,
    '',
    `**Captured**: ${idea.captured}`,
  ]
  if (idea.captured_during) {
    lines.push(`**Captured during**: ${idea.captured_during}`)
  }
  lines.push(`**Status**: ${idea.status}`)
  lines.push('')
  lines.push(idea.description)
  lines.push('')
  return lines.join('\n')
}

function parseIdea(content: string, filename: string): Idea {
  const lines = content.split('\n')
  const title = (lines[0] ?? '').replace(/^#\s*/, '').trim()
  const captured = lines.find(l => l.startsWith('**Captured**:'))?.replace('**Captured**:', '').trim() ?? ''
  const capturedDuring = lines.find(l => l.startsWith('**Captured during**:'))?.replace('**Captured during**:', '').trim()
  const status = 'idea' as const

  const descStart = lines.findIndex((l, i) => i > 0 && l.startsWith('**Status**:'))
  const description = lines.slice(descStart + 1).join('\n').trim()

  return { title: title || filename.replace('.md', ''), captured, captured_during: capturedDuring, status, description }
}

export class IdeasStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async create(title: string, description: string, capturedDuring?: string): Promise<string> {
    const slug = slugify(title)
    const idea: Idea = {
      title,
      captured: new Date().toISOString().slice(0, 10),
      captured_during: capturedDuring,
      status: 'idea',
      description: description || title,
    }

    await mkdir(join(this.specDir, 'ideas'), { recursive: true })
    await this.state.writeRaw(join('ideas', `${slug}.md`), formatIdea(idea))
    return slug
  }

  async list(): Promise<Array<{ slug: string; title: string }>> {
    const ideasDir = join(this.specDir, 'ideas')
    try {
      const entries = await readdir(ideasDir)
      const results: Array<{ slug: string; title: string }> = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await this.state.readRaw(join('ideas', entry))
        const firstLine = content.split('\n')[0] ?? ''
        results.push({
          slug: entry.replace('.md', ''),
          title: firstLine.replace(/^#\s*/, '').trim(),
        })
      }
      return results
    } catch {
      return []
    }
  }

  async show(slug: string): Promise<Idea> {
    const content = await this.state.readRaw(join('ideas', `${slug}.md`))
    return parseIdea(content, slug)
  }

  async exists(slug: string): Promise<boolean> {
    return this.state.exists(join('ideas', `${slug}.md`))
  }
}
