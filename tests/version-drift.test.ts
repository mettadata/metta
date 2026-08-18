import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  detectVersionDrift,
  getVersionDrift,
  readInstalledVersion,
  recordVersionDrift,
  resetVersionDrift,
  stampInstalledVersion,
  templateFreshnessCheck,
} from '../src/config/version-drift.js'

describe('detectVersionDrift', () => {
  it('returns null when versions match exactly', () => {
    expect(detectVersionDrift('0.4.0', '0.4.0')).toBeNull()
  })

  it('returns drift on upgrade mismatch', () => {
    expect(detectVersionDrift('0.3.0', '0.4.0')).toEqual({ installed: '0.3.0', running: '0.4.0' })
  })

  it('returns drift on downgrade mismatch', () => {
    expect(detectVersionDrift('0.5.0', '0.4.0')).toEqual({ installed: '0.5.0', running: '0.4.0' })
  })

  it('returns null when the stamp is undefined (legacy install)', () => {
    expect(detectVersionDrift(undefined, '0.4.0')).toBeNull()
  })

  it('treats an empty-string stamp as drift (exact string inequality; readInstalledVersion filters this out upstream)', () => {
    expect(detectVersionDrift('', '0.4.0')).toEqual({ installed: '', running: '0.4.0' })
  })
})

describe('templateFreshnessCheck', () => {
  it('passes with the running version as detail when versions match', () => {
    expect(templateFreshnessCheck('0.4.0', '0.4.0')).toEqual({ status: 'pass', detail: '0.4.0' })
  })

  it('warns naming both versions on mismatch', () => {
    const result = templateFreshnessCheck('0.3.0', '0.4.0')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('installed 0.3.0')
    expect(result.detail).toContain('running 0.4.0')
    expect(result.detail).toContain("run 'metta install' to refresh")
  })

  it('warns about the missing stamp when installed version is undefined', () => {
    const result = templateFreshnessCheck(undefined, '0.4.0')
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('no installed_version stamp')
    expect(result.detail).toContain("run 'metta install' to stamp")
  })
})

describe('readInstalledVersion', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-drift-'))
    mkdirSync(join(tmpDir, '.metta'), { recursive: true })
    configPath = join(tmpDir, '.metta', 'config.yaml')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns the stamp when installed_version is a string', async () => {
    writeFileSync(configPath, 'project:\n  name: test\ninstalled_version: "0.4.0"\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBe('0.4.0')
  })

  it('returns undefined when the field is absent', async () => {
    writeFileSync(configPath, 'project:\n  name: test\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined when config.yaml is missing', async () => {
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined when the .metta directory is missing', async () => {
    rmSync(join(tmpDir, '.metta'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined on corrupt YAML without throwing', async () => {
    writeFileSync(configPath, 'foo: [unclosed\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined when installed_version is not a string', async () => {
    writeFileSync(configPath, 'installed_version: 4\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined for a YAML scalar document', async () => {
    writeFileSync(configPath, 'just a string\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined for an empty-string stamp (fails the 1-char minimum)', async () => {
    writeFileSync(configPath, 'installed_version: ""\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined for a stamp containing an ANSI escape sequence', async () => {
    writeFileSync(configPath, 'installed_version: "1.0.0\\u001b[31m"\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined for a stamp longer than 64 characters', async () => {
    const long = '1.'.repeat(40)
    writeFileSync(configPath, `installed_version: "${long}"\n`, 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined for a stamp containing a newline', async () => {
    writeFileSync(configPath, 'installed_version: "1.0.0\\nrunning 9.9.9"\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBeUndefined()
  })

  it('returns a prerelease + build-metadata stamp within the bounded charset', async () => {
    writeFileSync(configPath, 'installed_version: "0.4.0-beta.1+build.5"\n', 'utf8')
    await expect(readInstalledVersion(tmpDir)).resolves.toBe('0.4.0-beta.1+build.5')
  })
})

describe('stampInstalledVersion', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-stamp-'))
    mkdirSync(join(tmpDir, '.metta'), { recursive: true })
    configPath = join(tmpDir, '.metta', 'config.yaml')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('writes a fresh stamp that parses back as the version string', async () => {
    writeFileSync(configPath, 'project:\n  name: test\n', 'utf8')

    await stampInstalledVersion(tmpDir, '0.4.0')

    const doc = YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(doc.installed_version).toBe('0.4.0')
    await expect(readInstalledVersion(tmpDir)).resolves.toBe('0.4.0')
  })

  it('overwrites an existing stamp', async () => {
    writeFileSync(configPath, 'project:\n  name: test\ninstalled_version: "0.3.0"\n', 'utf8')

    await stampInstalledVersion(tmpDir, '0.4.0')

    const doc = YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    expect(doc.installed_version).toBe('0.4.0')
  })

  it('preserves YAML comments in the config', async () => {
    writeFileSync(configPath, '# comment above project\nproject:\n  name: test\n', 'utf8')

    await stampInstalledVersion(tmpDir, '0.4.0')

    const output = readFileSync(configPath, 'utf8')
    expect(output).toContain('# comment above project')
  })

  it('rejects with ENOENT when config.yaml is absent', async () => {
    let thrown: unknown = null
    try {
      await stampInstalledVersion(tmpDir, '0.4.0')
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeNull()
    const code = (thrown as NodeJS.ErrnoException).code
    const message = (thrown as Error).message ?? ''
    expect(code === 'ENOENT' || message.includes('ENOENT')).toBe(true)
  })
})

describe('drift slot', () => {
  beforeEach(() => {
    resetVersionDrift()
  })

  it('returns null before anything is recorded', () => {
    expect(getVersionDrift()).toBeNull()
  })

  it('returns the recorded drift after recordVersionDrift', () => {
    const drift = { installed: '0.3.0', running: '0.4.0' }
    recordVersionDrift(drift)
    expect(getVersionDrift()).toEqual(drift)
  })

  it('returns null again after resetVersionDrift', () => {
    recordVersionDrift({ installed: '0.3.0', running: '0.4.0' })
    resetVersionDrift()
    expect(getVersionDrift()).toBeNull()
  })
})
