import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReleaseConfigSchema, type ReleaseConfig } from '../src/schemas/project-config.js'
import {
  ProductVersionError,
  readProductVersion,
  writeProductVersion,
} from '../src/release/version-file.js'

const config = (versionFile: string): ReleaseConfig =>
  ReleaseConfigSchema.parse({ scheme: 'semver', version_file: versionFile })

describe('release: version file I/O', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-version-file-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('JSON strategy', () => {
    it('reads the top-level version field from package.json', async () => {
      const raw = `{\n  "name": "demo",\n  "version": "0.4.0",\n  "private": true\n}\n`
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      const version = await readProductVersion(tempDir, config('package.json'))
      expect(version).toBe('0.4.0')
    })

    it('round-trips a 2-space-indented package.json byte-identically except the version value', async () => {
      const raw = [
        '{',
        '  "name": "demo",',
        '  "version": "0.4.0",',
        '  "scripts": {',
        '    "test": "vitest run"',
        '  },',
        '  "dependencies": {',
        '    "left-pad": "1.3.0"',
        '  }',
        '}',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      await writeProductVersion(tempDir, config('package.json'), '0.5.0')

      const updated = await readFile(join(tempDir, 'package.json'), 'utf8')
      expect(updated).toBe(raw.replace('"version": "0.4.0"', '"version": "0.5.0"'))
    })

    it('round-trips a 4-space-indented package.json byte-identically except the version value', async () => {
      const raw = [
        '{',
        '    "name": "demo",',
        '    "version": "1.2.3",',
        '    "nested": {',
        '        "version": "9.9.9"',
        '    }',
        '}',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      await writeProductVersion(tempDir, config('package.json'), '1.3.0')

      const updated = await readFile(join(tempDir, 'package.json'), 'utf8')
      // Only the top-level version changes; the nested one is untouched.
      expect(updated).toBe(raw.replace('"version": "1.2.3"', '"version": "1.3.0"'))
      expect(updated).toContain('"version": "9.9.9"')
    })

    it('round-trips a tab-indented package.json byte-identically except the version value', async () => {
      const raw = `{\n\t"name": "demo",\n\t"version": "2.0.0",\n\t"license": "MIT"\n}\n`
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      await writeProductVersion(tempDir, config('package.json'), '2.1.0')

      const updated = await readFile(join(tempDir, 'package.json'), 'utf8')
      expect(updated).toBe(raw.replace('"version": "2.0.0"', '"version": "2.1.0"'))
    })

    it('preserves the absence of a trailing newline', async () => {
      const raw = `{\n  "name": "demo",\n  "version": "0.1.0"\n}`
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      await writeProductVersion(tempDir, config('package.json'), '0.2.0')

      const updated = await readFile(join(tempDir, 'package.json'), 'utf8')
      expect(updated).toBe(`{\n  "name": "demo",\n  "version": "0.2.0"\n}`)
      expect(updated.endsWith('\n')).toBe(false)
    })

    it('reads a nested version key only when it is top-level (dependencies do not match)', async () => {
      const raw = `{\n  "dependencies": {\n    "version": "3.0.0"\n  },\n  "version": "0.7.0"\n}\n`
      await writeFile(join(tempDir, 'package.json'), raw, 'utf8')

      const version = await readProductVersion(tempDir, config('package.json'))
      expect(version).toBe('0.7.0')

      await writeProductVersion(tempDir, config('package.json'), '0.8.0')
      const updated = await readFile(join(tempDir, 'package.json'), 'utf8')
      expect(updated).toBe(raw.replace('"version": "0.7.0"', '"version": "0.8.0"'))
    })

    it('throws ProductVersionError when the version field is missing', async () => {
      await writeFile(join(tempDir, 'package.json'), `{\n  "name": "demo"\n}\n`, 'utf8')

      const attempt = readProductVersion(tempDir, config('package.json'))
      await expect(attempt).rejects.toBeInstanceOf(ProductVersionError)
      await expect(attempt).rejects.toThrow(/'version' field is missing or not a string/)
      await expect(attempt).rejects.toThrow(/package\.json/)
    })

    it('throws ProductVersionError when the version field is not a string', async () => {
      await writeFile(join(tempDir, 'package.json'), `{\n  "version": 4\n}\n`, 'utf8')

      const read = readProductVersion(tempDir, config('package.json'))
      await expect(read).rejects.toBeInstanceOf(ProductVersionError)

      const write = writeProductVersion(tempDir, config('package.json'), '1.0.0')
      await expect(write).rejects.toBeInstanceOf(ProductVersionError)
    })

    it('throws ProductVersionError for invalid JSON', async () => {
      await writeFile(join(tempDir, 'package.json'), 'not json at all', 'utf8')

      const attempt = readProductVersion(tempDir, config('package.json'))
      await expect(attempt).rejects.toBeInstanceOf(ProductVersionError)
      await expect(attempt).rejects.toThrow(/not valid JSON/)
    })
  })

  describe('plain-text strategy', () => {
    it('reads a plain-text version file trimmed', async () => {
      await writeFile(join(tempDir, 'VERSION'), '1.2.3\n', 'utf8')

      const version = await readProductVersion(tempDir, config('VERSION'))
      expect(version).toBe('1.2.3')
    })

    it('writes plain text preserving the trailing-newline convention', async () => {
      await writeFile(join(tempDir, 'VERSION'), '1.2.3\n', 'utf8')
      await writeProductVersion(tempDir, config('VERSION'), '1.3.0')
      expect(await readFile(join(tempDir, 'VERSION'), 'utf8')).toBe('1.3.0\n')

      await writeFile(join(tempDir, 'VERSION'), '1.3.0', 'utf8')
      await writeProductVersion(tempDir, config('VERSION'), '2.0.0')
      expect(await readFile(join(tempDir, 'VERSION'), 'utf8')).toBe('2.0.0')
    })

    it('throws ProductVersionError for an empty plain-text file', async () => {
      await writeFile(join(tempDir, 'VERSION'), '   \n', 'utf8')

      const attempt = readProductVersion(tempDir, config('VERSION'))
      await expect(attempt).rejects.toBeInstanceOf(ProductVersionError)
      await expect(attempt).rejects.toThrow(/product version/)
    })
  })

  describe('error wording (spec: Product Version Distinct From Installed Version)', () => {
    it('missing file error names the configured path and says "product version"', async () => {
      const attempt = readProductVersion(tempDir, config('missing/version.json'))
      await expect(attempt).rejects.toBeInstanceOf(ProductVersionError)

      const error = await readProductVersion(tempDir, config('missing/version.json')).catch(
        (e: unknown) => e as Error,
      )
      expect(error).toBeInstanceOf(ProductVersionError)
      expect((error as Error).message).toContain("'missing/version.json'")
      expect((error as Error).message).toContain('product version')
      expect((error as Error).message).not.toContain('installed_version')
    })

    it('missing file error on write also uses product-version wording', async () => {
      const error = await writeProductVersion(tempDir, config('VERSION'), '1.0.0').catch(
        (e: unknown) => e as Error,
      )
      expect(error).toBeInstanceOf(ProductVersionError)
      expect((error as Error).message).toContain("'VERSION'")
      expect((error as Error).message).toContain('product version')
      expect((error as Error).message).not.toContain('installed_version')
    })

    it('the module source never mentions the install stamp', async () => {
      const source = await readFile(
        new URL('../src/release/version-file.ts', import.meta.url),
        'utf8',
      )
      expect(source).not.toContain(['installed', 'version'].join('_'))
    })
  })
})
