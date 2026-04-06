import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { countTokens } from './token-counter.js'

export interface ContextManifest {
  required: string[]
  optional: string[]
  budget: number
}

export interface LoadedFile {
  path: string
  content: string
  tokens: number
  hash: string
  loadedAt: string
  truncated: boolean
  strategy: 'full' | 'section' | 'skeleton' | 'delta'
}

export interface LoadedContext {
  files: LoadedFile[]
  totalTokens: number
  budget: number
  truncations: string[]
}

export interface SectionExtractionOptions {
  sections?: string[]
  exclude?: string[]
}

const CONTEXT_MANIFESTS: Record<string, ContextManifest> = {
  intent: { required: [], optional: ['project_context', 'existing_specs'], budget: 20000 },
  spec: { required: ['intent'], optional: ['project_context', 'existing_specs', 'research'], budget: 40000 },
  research: { required: ['spec'], optional: ['project_context', 'existing_specs', 'architecture'], budget: 50000 },
  design: { required: ['research', 'spec'], optional: ['architecture', 'project_context'], budget: 60000 },
  tasks: { required: ['design', 'spec'], optional: ['research_contracts', 'research_schemas', 'architecture'], budget: 40000 },
  execution: { required: ['tasks'], optional: ['research_contracts', 'research_schemas'], budget: 10000 },
  verification: { required: ['spec', 'tasks', 'summary'], optional: ['research_contracts', 'research_schemas', 'design'], budget: 50000 },
}

function contentHash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`
}

export interface ContextEngineOptions {
  /** Maximum number of entries in the file cache. Oldest entries are evicted when exceeded. Default: 100. */
  maxCacheSize?: number
}

export class ContextEngine {
  private cache = new Map<string, { hash: string; tokens: number; content: string }>()
  private readonly maxCacheSize: number

  constructor(options?: ContextEngineOptions) {
    this.maxCacheSize = options?.maxCacheSize ?? 100
  }

  getManifest(artifactType: string): ContextManifest {
    return CONTEXT_MANIFESTS[artifactType] ?? { required: [], optional: [], budget: 20000 }
  }

  async resolve(
    artifactType: string,
    changePath: string,
    specDir: string,
    agentBudget?: number,
  ): Promise<LoadedContext> {
    const manifest = this.getManifest(artifactType)
    const budget = agentBudget ?? manifest.budget
    const files: LoadedFile[] = []
    let totalTokens = 0
    const truncations: string[] = []

    // Load required files
    for (const source of manifest.required) {
      const filePath = this.resolveSourcePath(source, changePath, specDir)
      try {
        const loaded = await this.loadFile(filePath, budget - totalTokens)
        files.push(loaded)
        totalTokens += loaded.tokens
        if (loaded.truncated) {
          truncations.push(filePath)
        }
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          // Required files that don't exist yet are skipped (they may not be created yet in the workflow)
          continue
        }
        // Surface non-ENOENT I/O errors (permission denied, disk errors, etc.)
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[metta] warning: failed to read required context file ${filePath}: ${msg}`)
        truncations.push(`${filePath} (read error: ${code ?? 'unknown'})`)
      }
    }

    // Load optional files in order until budget is reached
    for (const source of manifest.optional) {
      if (totalTokens >= budget) break

      const filePath = this.resolveSourcePath(source, changePath, specDir)
      try {
        const remaining = budget - totalTokens
        if (remaining < 100) break

        const loaded = await this.loadFile(filePath, remaining)
        files.push(loaded)
        totalTokens += loaded.tokens
        if (loaded.truncated) {
          truncations.push(filePath)
        }
      } catch {
        // Optional files that don't exist are silently skipped
      }
    }

    return { files, totalTokens, budget, truncations }
  }

  async loadFile(filePath: string, budgetRemaining: number): Promise<LoadedFile> {
    const content = await readFile(filePath, 'utf-8')
    const hash = contentHash(content)

    // Check cache — avoids token re-counting but not file I/O (content is always
    // read from disk so the hash can be compared for change detection).
    const cached = this.cache.get(filePath)
    if (cached && cached.hash === hash) {
      const strategy = this.selectStrategy(cached.tokens)
      const transformed = this.applyStrategy(cached.content, strategy)
      const transformedTokens = transformed !== cached.content ? countTokens(transformed) : cached.tokens
      const truncated = transformedTokens > budgetRemaining
      const tokens = Math.min(transformedTokens, budgetRemaining)
      return {
        path: filePath,
        content: truncated ? this.truncateToTokens(transformed, budgetRemaining) : transformed,
        tokens,
        hash,
        loadedAt: new Date().toISOString(),
        truncated,
        strategy,
      }
    }

    const tokens = countTokens(content)
    this.cache.set(filePath, { hash, tokens, content })
    this.evictIfNeeded()

    const strategy = this.selectStrategy(tokens)
    const transformed = this.applyStrategy(content, strategy)
    const transformedTokens = transformed !== content ? countTokens(transformed) : tokens

    const truncated = transformedTokens > budgetRemaining
    const finalContent = truncated ? this.truncateToTokens(transformed, budgetRemaining) : transformed
    const finalTokens = truncated ? budgetRemaining : transformedTokens

    return {
      path: filePath,
      content: finalContent,
      tokens: finalTokens,
      hash,
      loadedAt: new Date().toISOString(),
      truncated,
      strategy,
    }
  }

  extractSections(content: string, options: SectionExtractionOptions): string {
    const lines = content.split('\n')
    const result: string[] = []
    let inSection = false
    let currentHeading = ''

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
      if (headingMatch) {
        currentHeading = headingMatch[2]

        if (options.exclude?.some(e => currentHeading.includes(e))) {
          inSection = false
          continue
        }

        if (options.sections) {
          inSection = options.sections.some(s => currentHeading.includes(s))
        } else {
          inSection = true
        }

        if (inSection) {
          result.push(line)
        }
        continue
      }

      if (inSection) {
        result.push(line)
      }
    }

    return result.join('\n')
  }

  headingSkeleton(content: string): string {
    const lines = content.split('\n')
    const result: string[] = []
    let firstParagraph = false
    let paragraphLines = 0

    for (const line of lines) {
      if (line.match(/^#{1,6}\s+/)) {
        result.push(line)
        firstParagraph = true
        paragraphLines = 0
        continue
      }

      if (firstParagraph && line.trim() !== '') {
        if (paragraphLines < 2) {
          result.push(line)
          paragraphLines++
        }
      }

      if (line.trim() === '') {
        if (firstParagraph && paragraphLines > 0) {
          firstParagraph = false
        }
        if (paragraphLines > 0) {
          result.push('')
        }
      }
    }

    return result.join('\n').trim()
  }

  formatContext(files: LoadedFile[]): string {
    return files.map(f => {
      return `<context source="${f.path}" hash="${f.hash}" loaded_at="${f.loadedAt}">\n${f.content}\n</context>`
    }).join('\n\n')
  }

  clearCache(): void {
    this.cache.clear()
  }

  private resolveSourcePath(source: string, changePath: string, specDir: string): string {
    switch (source) {
      case 'project_context':
        return join(specDir, 'project.md')
      case 'existing_specs':
        return join(specDir, 'specs')
      case 'architecture':
        return join(changePath, 'architecture.md')
      case 'research_contracts':
        return join(changePath, 'research', 'contracts')
      case 'research_schemas':
        return join(changePath, 'research', 'schemas')
      default:
        return join(changePath, `${source}.md`)
    }
  }

  /** Evict oldest cache entries when maxCacheSize is exceeded. */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxCacheSize) {
      // Map iteration order is insertion order — first key is oldest
      const oldestKey = this.cache.keys().next().value as string
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Apply the loading strategy transformation to file content.
   * - `full`: no transformation (tokens < 5000)
   * - `section`: no automatic transformation — section extraction requires
   *   caller-specified sections via extractSections() (tokens 5000–20000)
   * - `skeleton`: reduces content to heading skeleton (tokens > 20000)
   */
  private applyStrategy(content: string, strategy: LoadedFile['strategy']): string {
    if (strategy === 'skeleton') {
      return this.headingSkeleton(content)
    }
    // 'full' and 'section' return content as-is.
    // 'section' requires caller-specified sections — see extractSections().
    return content
  }

  private selectStrategy(tokens: number): LoadedFile['strategy'] {
    if (tokens < 5000) return 'full'
    if (tokens < 20000) return 'section'
    return 'skeleton'
  }

  private truncateToTokens(content: string, maxTokens: number): string {
    const maxChars = maxTokens * 4
    if (content.length <= maxChars) return content
    return content.slice(0, maxChars) + '\n\n[... truncated due to context budget ...]'
  }
}
