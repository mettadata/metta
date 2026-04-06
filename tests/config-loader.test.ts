import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { ConfigLoader } from '../src/config/config-loader.js'

describe('ConfigLoader', () => {
  let tempDir: string
  let projectDir: string
  let globalDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-config-'))
    projectDir = join(tempDir, 'project')
    globalDir = join(tempDir, 'global')
    await mkdir(join(projectDir, '.metta'), { recursive: true })
    await mkdir(globalDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    // Clean up env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('METTA_')) delete process.env[key]
    }
  })

  it('returns empty config when no files exist', async () => {
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect(config).toBeDefined()
  })

  it('loads global config', async () => {
    await writeFile(join(globalDir, 'config.yaml'), `
project:
  name: "Global App"
defaults:
  workflow: standard
  mode: supervised
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect(config.project?.name).toBe('Global App')
    expect(config.defaults?.workflow).toBe('standard')
  })

  it('project config overrides global config', async () => {
    await writeFile(join(globalDir, 'config.yaml'), `
project:
  name: "Global App"
defaults:
  workflow: standard
  mode: supervised
`)
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Project App"
defaults:
  workflow: full
  mode: supervised
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect(config.project?.name).toBe('Project App')
    expect(config.defaults?.workflow).toBe('full')
  })

  it('local config overrides project config', async () => {
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Project App"
defaults:
  workflow: standard
  mode: supervised
`)
    await writeFile(join(projectDir, '.metta', 'local.yaml'), `
defaults:
  workflow: standard
  mode: autonomous
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect(config.defaults?.mode).toBe('autonomous')
  })

  it('environment variables override all configs', async () => {
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Project App"
`)
    process.env.METTA_DEFAULTS__WORKFLOW = 'full'
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect((config.defaults as { workflow: string })?.workflow).toBe('full')
  })

  it('caches loaded config', async () => {
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Cached"
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config1 = await loader.load()
    const config2 = await loader.load()
    expect(config1).toBe(config2) // Same reference (cached)
  })

  it('clearCache forces reload', async () => {
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Original"
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config1 = await loader.load()
    expect(config1.project?.name).toBe('Original')

    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Updated"
`)
    loader.clearCache()
    const config2 = await loader.load()
    expect(config2.project?.name).toBe('Updated')
  })

  it('env vars with double underscore separator handle keys containing single underscores', async () => {
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Test"
providers:
  anthropic:
    provider: anthropic
`)
    process.env.METTA_PROVIDERS__ANTHROPIC__API_KEY_ENV = 'MY_SECRET_KEY'
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    expect(config.providers?.anthropic?.api_key_env).toBe('MY_SECRET_KEY')
  })

  it('logs warning and falls back to defaults for malformed YAML', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Valid"
`)
    await writeFile(join(projectDir, '.metta', 'local.yaml'), `
  bad yaml: [unterminated
    : broken
`)
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    // The valid project config should still load; malformed local.yaml is skipped
    expect(config.project?.name).toBe('Valid')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: failed to parse YAML config'))
    stderrSpy.mockRestore()
  })

  it('exposes path accessors', () => {
    const loader = new ConfigLoader(projectDir, globalDir)
    expect(loader.projectPath).toBe(projectDir)
    expect(loader.globalPath).toBe(globalDir)
    expect(loader.mettaDir).toBe(join(projectDir, '.metta'))
    expect(loader.specDir).toBe(join(projectDir, 'spec'))
  })

  it('warns and ignores env vars that cause Zod validation errors', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await writeFile(join(projectDir, '.metta', 'config.yaml'), `
project:
  name: "Test"
`)
    // This env var creates an unrecognized top-level key
    process.env.METTA_BOGUS_KEY = 'oops'
    const loader = new ConfigLoader(projectDir, globalDir)
    const config = await loader.load()
    // Should still load successfully with file-only config
    expect(config.project?.name).toBe('Test')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: METTA_* environment variable(s) caused config validation errors'))
    stderrSpy.mockRestore()
  })

  it('defaults globalDir to ~/.metta when not provided', () => {
    const loader = new ConfigLoader(projectDir)
    expect(loader.globalPath).toBe(join(homedir(), '.metta'))
  })
})
