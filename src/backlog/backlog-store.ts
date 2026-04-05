import { readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'

export interface BacklogItem {
  title: string
  added: string
  source?: string
  status: 'backlog'
  priority?: 'high' | 'medium' | 'low'
  description: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function formatItem(item: BacklogItem): string {
  const lines = [
    `# ${item.title}`,
    '',
    `**Added**: ${item.added}`,
  ]
  if (item.source) {
    lines.push(`**Source**: ${item.source}`)
  }
  lines.push(`**Status**: ${item.status}`)
  if (item.priority) {
    lines.push(`**Priority**: ${item.priority}`)
  }
  lines.push('')
  lines.push(item.description)
  lines.push('')
  return lines.join('\n')
}

function parseItem(content: string, filename: string): BacklogItem {
  const lines = content.split('\n')
  const title = (lines[0] ?? '').replace(/^#\s*/, '').trim()
  const added = lines.find(l => l.startsWith('**Added**:'))?.replace('**Added**:', '').trim() ?? ''
  const source = lines.find(l => l.startsWith('**Source**:'))?.replace('**Source**:', '').trim()
  const priorityLine = lines.find(l => l.startsWith('**Priority**:'))?.replace('**Priority**:', '').trim()
  const priority = (['high', 'medium', 'low'].includes(priorityLine ?? '') ? priorityLine : undefined) as BacklogItem['priority']

  const descStart = lines.findIndex((l, i) => i > 0 && (l.startsWith('**Priority**:') || l.startsWith('**Status**:')))
  const description = lines.slice(descStart + 1).join('\n').trim()

  return { title: title || filename.replace('.md', ''), added, source, status: 'backlog', priority, description }
}

export class BacklogStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async add(title: string, description: string, source?: string, priority?: BacklogItem['priority']): Promise<string> {
    const slug = slugify(title)
    const item: BacklogItem = {
      title,
      added: new Date().toISOString().slice(0, 10),
      source,
      status: 'backlog',
      priority,
      description: description || title,
    }

    await mkdir(join(this.specDir, 'backlog'), { recursive: true })
    await this.state.writeRaw(join('backlog', `${slug}.md`), formatItem(item))
    return slug
  }

  async list(): Promise<Array<{ slug: string; title: string; priority?: BacklogItem['priority'] }>> {
    const backlogDir = join(this.specDir, 'backlog')
    try {
      const entries = await readdir(backlogDir)
      const results: Array<{ slug: string; title: string; priority?: BacklogItem['priority'] }> = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await this.state.readRaw(join('backlog', entry))
        const item = parseItem(content, entry)
        results.push({
          slug: entry.replace('.md', ''),
          title: item.title,
          priority: item.priority,
        })
      }
      return results
    } catch {
      return []
    }
  }

  async show(slug: string): Promise<BacklogItem> {
    const content = await this.state.readRaw(join('backlog', `${slug}.md`))
    return parseItem(content, slug)
  }

  async remove(slug: string): Promise<void> {
    await this.state.delete(join('backlog', `${slug}.md`))
  }

  async exists(slug: string): Promise<boolean> {
    return this.state.exists(join('backlog', `${slug}.md`))
  }
}
