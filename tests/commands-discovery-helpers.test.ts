import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectBrownfield, buildDiscoveryInstructions } from '../src/cli/commands/discovery-helpers.js'

describe('discovery-helpers', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-disc-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('detectBrownfield', () => {
    it('returns greenfield when skipScan is true even if stack files are present', async () => {
      await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname = "x"\n')
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'main.rs'), 'fn main() {}\n')
      const result = await detectBrownfield(tempDir, true)
      expect(result.isBrownfield).toBe(false)
      expect(result.detectedStack).toEqual([])
      expect(result.detectedDirs).toEqual([])
    })

    it('detects Rust from Cargo.toml and non-empty src/', async () => {
      await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname = "x"\n')
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'main.rs'), 'fn main() {}\n')
      const result = await detectBrownfield(tempDir, false)
      expect(result.isBrownfield).toBe(true)
      expect(result.detectedStack).toContain('Rust')
      expect(result.detectedDirs).toContain('src')
    })

    it('returns greenfield for an empty project', async () => {
      const result = await detectBrownfield(tempDir, false)
      expect(result.isBrownfield).toBe(false)
      expect(result.detectedStack).toEqual([])
      expect(result.detectedDirs).toEqual([])
    })
  })

  describe('buildDiscoveryInstructions', () => {
    it('returns the brownfield question set when isBrownfield is true', () => {
      const result = buildDiscoveryInstructions(tempDir, true, ['Rust'], ['src'])
      expect(result.mode).toBe('brownfield')
      expect(result.questions[0].id).toBe('corrections')
    })

    it('returns the greenfield question set when isBrownfield is false', () => {
      const result = buildDiscoveryInstructions(tempDir, false, [], [])
      expect(result.mode).toBe('greenfield')
      expect(result.questions[0].id).toBe('description')
    })
  })
})
