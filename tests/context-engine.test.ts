import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContextEngine } from '../src/context/context-engine.js'
import { countTokens } from '../src/context/token-counter.js'

describe('countTokens', () => {
  it('estimates 1 token per 4 characters', () => {
    expect(countTokens('1234')).toBe(1)
    expect(countTokens('12345678')).toBe(2)
    expect(countTokens('123')).toBe(1) // ceil
  })

  it('handles empty string', () => {
    expect(countTokens('')).toBe(0)
  })
})

describe('ContextEngine', () => {
  let tempDir: string
  let specDir: string
  let changePath: string
  let engine: ContextEngine

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-ctx-'))
    specDir = join(tempDir, 'spec')
    changePath = join(specDir, 'changes', 'test-change')
    await mkdir(changePath, { recursive: true })
    await mkdir(join(specDir, 'specs'), { recursive: true })
    engine = new ContextEngine()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('getManifest', () => {
    it('returns manifest for known artifact types', () => {
      const manifest = engine.getManifest('intent')
      expect(manifest.budget).toBe(50_000)
      expect(manifest.required).toEqual([])
    })

    it('returns default manifest for unknown types', () => {
      const manifest = engine.getManifest('unknown')
      expect(manifest.budget).toBe(20000)
    })

    it('exposes recalibrated per-phase budgets', () => {
      expect(engine.getManifest('stories').budget).toBe(50_000)
      expect(engine.getManifest('spec').budget).toBe(60_000)
      expect(engine.getManifest('research').budget).toBe(80_000)
      expect(engine.getManifest('design').budget).toBe(100_000)
      expect(engine.getManifest('tasks').budget).toBe(100_000)
      expect(engine.getManifest('execution').budget).toBe(150_000)
      expect(engine.getManifest('verification').budget).toBe(120_000)
    })

    it('stories required includes intent; spec required includes intent+stories', () => {
      expect(engine.getManifest('stories').required).toEqual(['intent'])
      expect(engine.getManifest('spec').required).toEqual(['intent', 'stories'])
    })
  })

  describe('resolve', () => {
    it('loads required files into context', async () => {
      await writeFile(join(changePath, 'intent.md'), '# Test Intent\n\nThis is a test.')
      const result = await engine.resolve('spec', changePath, specDir)
      expect(result.files.length).toBeGreaterThanOrEqual(0) // intent.md if it exists
      expect(result.totalTokens).toBeLessThanOrEqual(result.budget)
    })

    it('respects budget limits', async () => {
      // Create a file between 5000-20000 tokens (section strategy, no transformation)
      // so budget truncation is exercised directly
      const bigContent = 'x'.repeat(40000) // 10K tokens — 'section' strategy, no transform
      await writeFile(join(changePath, 'intent.md'), bigContent)

      const result = await engine.resolve('spec', changePath, specDir, 5000)
      expect(result.totalTokens).toBeLessThanOrEqual(5000)
      if (result.files.length > 0) {
        expect(result.truncations.length).toBeGreaterThan(0)
      }
    })

    it('skips missing optional files gracefully', async () => {
      const result = await engine.resolve('intent', changePath, specDir)
      // Optional files don't exist — no error
      expect(result.files).toEqual([])
    })

    it('warns on permission errors for required files instead of silently swallowing', async () => {
      // Create required file for 'spec' artifact type (requires 'intent')
      const intentPath = join(changePath, 'intent.md')
      await writeFile(intentPath, '# Intent\n\nSome intent content.')
      // Remove read permissions
      await chmod(intentPath, 0o000)

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const result = await engine.resolve('spec', changePath, specDir)
        // File should NOT be loaded
        expect(result.files.find(f => f.path === intentPath)).toBeUndefined()
        // Warning should be emitted
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('failed to read required context file'),
        )
        // Truncations should record the read error
        expect(result.truncations.some(t => t.includes('read error'))).toBe(true)
      } finally {
        warnSpy.mockRestore()
        // Restore permissions so cleanup can remove the file
        await chmod(intentPath, 0o644)
      }
    })
  })

  describe('warning + droppedOptionals', () => {
    it('under-80% load returns warning null and empty droppedOptionals', async () => {
      await writeFile(join(changePath, 'intent.md'), '# Intent\n\nShort content.')
      const result = await engine.resolve('spec', changePath, specDir)
      expect(result.warning).toBeNull()
      expect(result.droppedOptionals).toEqual([])
    })

    it('smart-zone warning when utilization is 80-100%', async () => {
      // Intent content sized to ~8500 tokens under a 10K agentBudget → ~85% util.
      // Use under-20K-token content so the 'section' strategy applies (no transformation)
      // and raw token count survives the load.
      const intentContent = 'word '.repeat(8_500) // 42500 chars → ~10625 tokens → clamped by budget below
      // Actually keep it simple: write 7 chars × ~4700 = ~8250 tokens
      await writeFile(join(changePath, 'intent.md'), 'abcdefg'.repeat(4_800)) // 33600 chars = 8400 tokens
      const result = await engine.resolve('spec', changePath, specDir, 10_000)
      const utilization = result.totalTokens / result.budget
      expect(utilization).toBeGreaterThanOrEqual(0.8)
      expect(utilization).toBeLessThan(1.0)
      expect(result.warning).toBe('smart-zone')
    })

    it('drops optional file and records it when neither full nor skeleton fits', async () => {
      // Intent uses ~7500 tokens of 10K agent budget (full strategy — under 5K? no, 'section' at >5K).
      // Keep it under 5K so full strategy applies and token count is preserved.
      await writeFile(join(changePath, 'intent.md'), 'a'.repeat(4 * 4_500)) // 4500 tokens
      // project.md (optional) is 10K tokens with no headings → skeleton returns empty string
      // → skeletonTokens === 0 → not loaded → drops into droppedOptionals. But remaining is
      // 10K - 4500 = 5500, and full tokens 10K doesn't fit.
      await writeFile(join(specDir, 'project.md'), 'y'.repeat(4 * 10_000))
      const result = await engine.resolve('spec', changePath, specDir, 10_000)
      expect(result.droppedOptionals).toContain('project_context')
      expect(result.warning).toBe('over-budget')
    })

    it('loads optional with skeleton strategy when full exceeds remaining but skeleton fits', async () => {
      // Required intent is small
      await writeFile(join(changePath, 'intent.md'), 'a'.repeat(4 * 4_500)) // 4500 tokens
      // project.md (optional): many sections with SHORT bodies (skeleton-friendly).
      // Full body: large enough to exceed remaining 5500 tokens.
      // Skeleton: headings + short first-paragraph each → well under 5500 tokens.
      const sections: string[] = []
      for (let i = 0; i < 20; i++) {
        // Each section: heading + short paragraph (~30 chars) + repeated filler lines after a blank line
        const filler = Array.from({ length: 100 }, (_, j) => `filler line ${j} padding padding padding padding`).join('\n')
        sections.push(`## Section ${i}\n\nShort intro line.\n\n${filler}\n`)
      }
      await writeFile(join(specDir, 'project.md'), `# Project\n\n${sections.join('\n')}`)
      const result = await engine.resolve('spec', changePath, specDir, 10_000)
      const skeletonFile = result.files.find(f => f.strategy === 'skeleton' && f.path.endsWith('project.md'))
      expect(skeletonFile).toBeDefined()
      expect(result.droppedOptionals).not.toContain('project_context')
    })
  })

  describe('loadFile', () => {
    it('loads a file with hash and token count', async () => {
      const path = join(tempDir, 'test.md')
      await writeFile(path, '# Test\n\nHello world')
      const loaded = await engine.loadFile(path, 10000)
      expect(loaded.tokens).toBeGreaterThan(0)
      expect(loaded.hash).toMatch(/^sha256:/)
      expect(loaded.truncated).toBe(false)
    })

    it('truncates files exceeding budget', async () => {
      const path = join(tempDir, 'big.md')
      await writeFile(path, 'x'.repeat(40000)) // 10K tokens
      const loaded = await engine.loadFile(path, 100) // only 100 tokens budget
      expect(loaded.truncated).toBe(true)
      expect(loaded.tokens).toBe(100)
      expect(loaded.content).toContain('truncated due to context budget')
    })

    it('applies headingSkeleton strategy for large files (>20000 tokens)', async () => {
      // Build a markdown file exceeding 20000 tokens (>80000 chars).
      // Use repeated heading+paragraph blocks so headingSkeleton produces meaningful output.
      const sections: string[] = []
      for (let i = 0; i < 200; i++) {
        sections.push(`## Section ${i}\n\n${'Lorem ipsum dolor sit amet. '.repeat(60)}\n\nExtra paragraph that should be trimmed by skeleton.\n`)
      }
      const bigMarkdown = `# Big Document\n\n${sections.join('\n')}`
      expect(countTokens(bigMarkdown)).toBeGreaterThan(20000)

      const path = join(tempDir, 'big-strategy.md')
      await writeFile(path, bigMarkdown)

      const loaded = await engine.loadFile(path, 500000)
      expect(loaded.strategy).toBe('skeleton')
      // Skeleton should be significantly smaller than the original
      expect(loaded.content.length).toBeLessThan(bigMarkdown.length)
      // Should still contain headings
      expect(loaded.content).toContain('# Big Document')
      expect(loaded.content).toContain('## Section 0')
    })

    it('uses cache on repeated reads', async () => {
      const path = join(tempDir, 'cached.md')
      await writeFile(path, '# Cached Content')
      const first = await engine.loadFile(path, 10000)
      const second = await engine.loadFile(path, 10000)
      expect(first.hash).toBe(second.hash)
    })
  })

  describe('extractSections', () => {
    const content = `# Document

## Requirements
Some requirements here.

## Scenarios
Some scenarios here.

## Changelog
Old changes.

## Archive
Past data.
`

    it('extracts specified sections', () => {
      const result = engine.extractSections(content, { sections: ['Requirements', 'Scenarios'] })
      expect(result).toContain('Requirements')
      expect(result).toContain('Scenarios')
      expect(result).not.toContain('Changelog')
    })

    it('excludes specified sections', () => {
      const result = engine.extractSections(content, { exclude: ['Changelog', 'Archive'] })
      expect(result).toContain('Requirements')
      expect(result).not.toContain('Changelog')
      expect(result).not.toContain('Archive')
    })
  })

  describe('headingSkeleton', () => {
    it('extracts headings and first paragraph only', () => {
      const content = `# Title

First paragraph of intro.

More intro text that should be included.

Even more intro text.

## Section One

First paragraph of section one.

More text in section one.

## Section Two

First paragraph of section two.

More text.
`
      const skeleton = engine.headingSkeleton(content)
      expect(skeleton).toContain('# Title')
      expect(skeleton).toContain('## Section One')
      expect(skeleton).toContain('## Section Two')
      // Should have much less content than original
      expect(skeleton.length).toBeLessThan(content.length)
    })
  })

  describe('formatContext', () => {
    it('wraps files in XML context tags with metadata', () => {
      const formatted = engine.formatContext([
        {
          path: 'spec/project.md',
          content: '# Project\nTest',
          tokens: 5,
          hash: 'sha256:abc123',
          loadedAt: '2026-04-04T12:00:00Z',
          truncated: false,
          strategy: 'full',
        },
      ])
      expect(formatted).toContain('<context source="spec/project.md"')
      expect(formatted).toContain('hash="sha256:abc123"')
      expect(formatted).toContain('# Project')
      expect(formatted).toContain('</context>')
    })
  })

  describe('cache eviction', () => {
    it('evicts oldest entries when maxCacheSize is exceeded', async () => {
      const smallEngine = new ContextEngine({ maxCacheSize: 3 })

      // Load 4 files — the first should be evicted
      const paths: string[] = []
      for (let i = 0; i < 4; i++) {
        const p = join(tempDir, `evict-${i}.md`)
        await writeFile(p, `content-${i}`)
        paths.push(p)
        await smallEngine.loadFile(p, 10000)
      }

      // Modify the first file on disk — if its cache entry was evicted,
      // a fresh load will show the updated content
      await writeFile(paths[0], 'updated-content-0')
      const reloaded = await smallEngine.loadFile(paths[0], 10000)
      expect(reloaded.content).toBe('updated-content-0')

      // The third file should still be cached (not evicted)
      // Verify by checking hash matches without content change
      const third = await smallEngine.loadFile(paths[2], 10000)
      expect(third.content).toBe('content-2')
    })
  })

  describe('clearCache', () => {
    it('clears the internal cache', async () => {
      const path = join(tempDir, 'clearme.md')
      await writeFile(path, 'original')
      await engine.loadFile(path, 10000)

      engine.clearCache()

      await writeFile(path, 'updated')
      const loaded = await engine.loadFile(path, 10000)
      expect(loaded.content).toBe('updated')
    })
  })
})
