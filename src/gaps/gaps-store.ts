import { readdir, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'

export type GapStatus = 'claimed-not-built' | 'partial' | 'built-not-documented' | 'diverged'

export interface Gap {
  title: string
  status: GapStatus
  source?: string
  claim?: string
  evidence?: string
  impact?: string
  relatedSpec?: string
  action?: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

function formatGap(gap: Gap): string {
  const lines = [
    `# Gap: ${gap.title}`,
    '',
    '## Status',
    gap.status,
    '',
    '## Source',
    gap.source ?? '',
    '',
    '## Claim',
    gap.claim ?? '',
    '',
    '## Evidence',
    gap.evidence ?? '',
    '',
    '## Impact',
    gap.impact ?? '',
    '',
    '## Related Spec',
    gap.relatedSpec ?? '',
    '',
    '## Action',
    gap.action ?? `Promote to spec: \`metta propose --from-gap ${slugify(gap.title)}\``,
    '',
  ]
  return lines.join('\n')
}

function parseGap(content: string, filename: string): Gap {
  const lines = content.split('\n')
  const title = (lines[0] ?? '').replace(/^#\s*Gap:\s*/, '').trim()

  function sectionContent(heading: string): string {
    const idx = lines.findIndex(l => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`)
    if (idx === -1) return ''
    const nextIdx = lines.findIndex((l, i) => i > idx && l.startsWith('## '))
    const end = nextIdx === -1 ? lines.length : nextIdx
    return lines.slice(idx + 1, end).join('\n').trim()
  }

  const statusRaw = sectionContent('Status')
  const validStatuses: GapStatus[] = ['claimed-not-built', 'partial', 'built-not-documented', 'diverged']
  const status = validStatuses.includes(statusRaw as GapStatus) ? (statusRaw as GapStatus) : 'claimed-not-built'

  return {
    title: title || filename.replace('.md', ''),
    status,
    source: sectionContent('Source') || undefined,
    claim: sectionContent('Claim') || undefined,
    evidence: sectionContent('Evidence') || undefined,
    impact: sectionContent('Impact') || undefined,
    relatedSpec: sectionContent('Related Spec') || undefined,
    action: sectionContent('Action') || undefined,
  }
}

export class GapsStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async create(title: string, status: GapStatus, details?: Partial<Gap>): Promise<string> {
    const slug = slugify(title)
    const gap: Gap = {
      title,
      status,
      source: details?.source,
      claim: details?.claim,
      evidence: details?.evidence,
      impact: details?.impact,
      relatedSpec: details?.relatedSpec,
      action: details?.action,
    }

    await mkdir(join(this.specDir, 'gaps'), { recursive: true })
    await this.state.writeRaw(join('gaps', `${slug}.md`), formatGap(gap))
    return slug
  }

  async list(): Promise<Array<{ slug: string; title: string; status: GapStatus }>> {
    const gapsDir = join(this.specDir, 'gaps')
    try {
      const entries = await readdir(gapsDir)
      const results: Array<{ slug: string; title: string; status: GapStatus }> = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await this.state.readRaw(join('gaps', entry))
        const gap = parseGap(content, entry)
        results.push({
          slug: entry.replace('.md', ''),
          title: gap.title,
          status: gap.status,
        })
      }
      return results
    } catch {
      return []
    }
  }

  async show(slug: string): Promise<Gap> {
    const content = await this.state.readRaw(join('gaps', `${slug}.md`))
    return parseGap(content, slug)
  }

  async remove(slug: string): Promise<void> {
    await this.state.delete(join('gaps', `${slug}.md`))
  }

  async exists(slug: string): Promise<boolean> {
    return this.state.exists(join('gaps', `${slug}.md`))
  }

  async archive(slug: string): Promise<string> {
    const content = await this.state.readRaw(join('gaps', `${slug}.md`))
    const date = new Date().toISOString().slice(0, 10)
    const archiveName = `${date}-${slug}-gap-resolved.md`
    const archivePath = join('archive', archiveName)
    await mkdir(join(this.specDir, 'archive'), { recursive: true })
    await this.state.writeRaw(archivePath, content)
    return archivePath
  }
}
