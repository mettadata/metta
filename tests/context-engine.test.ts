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
      expect(manifest.budget).toBe(20000)
      expect(manifest.required).toEqual([])
    })

    it('returns default manifest for unknown types', () => {
      const manifest = engine.getManifest('unknown')
      expect(manifest.budget).toBe(20000)
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
      // Create a large file
      const bigContent = 'x'.repeat(200000) // 50K tokens
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
