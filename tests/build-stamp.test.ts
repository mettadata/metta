import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  distFreshnessCheck,
  distMtimeFallbackCheck,
  distStampCheck,
  readBuildStamp,
} from '../src/config/build-stamp.js'

const execAsync = promisify(execFile)

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)

describe('distStampCheck', () => {
  it('passes with the short head commit when stamp matches HEAD', () => {
    expect(distStampCheck(COMMIT_A, COMMIT_A)).toEqual({
      status: 'pass',
      detail: `built at ${COMMIT_A.slice(0, 7)}`,
    })
  })

  it('warns with both short commits and the stamp..HEAD range on drift', () => {
    const result = distStampCheck(COMMIT_A, COMMIT_B)
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('dist behind HEAD')
    expect(result.detail).toContain(COMMIT_A.slice(0, 7))
    expect(result.detail).toContain(COMMIT_B.slice(0, 7))
    expect(result.detail).toContain(`${COMMIT_A.slice(0, 7)}..${COMMIT_B.slice(0, 7)}`)
    expect(result.detail).toContain("run 'npm run build'")
  })
})

describe('distMtimeFallbackCheck', () => {
  it('warns when dist mtime predates the latest commit', () => {
    const result = distMtimeFallbackCheck(1000, 2000)
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('no build stamp')
    expect(result.detail).toContain('cannot verify precisely')
  })

  it('passes (with imprecision caveat) when dist mtime is newer than the latest commit', () => {
    const result = distMtimeFallbackCheck(2000, 1000)
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('no build stamp')
    expect(result.detail).toContain('cannot verify precisely')
  })
})

describe('readBuildStamp', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-build-stamp-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns the parsed stamp for a valid commit', async () => {
    writeFileSync(join(tmpDir, '.build-stamp'), JSON.stringify({ commit: COMMIT_A }), 'utf8')
    await expect(readBuildStamp(tmpDir)).resolves.toEqual({ commit: COMMIT_A })
  })

  it('returns a null-commit stamp (git unavailable at build)', async () => {
    writeFileSync(join(tmpDir, '.build-stamp'), JSON.stringify({ commit: null, built_at: 'x' }), 'utf8')
    await expect(readBuildStamp(tmpDir)).resolves.toEqual({ commit: null, built_at: 'x' })
  })

  it('returns undefined when the stamp file is missing', async () => {
    await expect(readBuildStamp(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined on malformed JSON without throwing', async () => {
    writeFileSync(join(tmpDir, '.build-stamp'), '{not json', 'utf8')
    await expect(readBuildStamp(tmpDir)).resolves.toBeUndefined()
  })

  it('returns undefined when commit is not a 40-hex string', async () => {
    writeFileSync(join(tmpDir, '.build-stamp'), JSON.stringify({ commit: 'HEAD; rm -rf /' }), 'utf8')
    await expect(readBuildStamp(tmpDir)).resolves.toBeUndefined()
  })
})

describe('distFreshnessCheck', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-dist-fresh-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function git(args: string[]): Promise<string> {
    const { stdout } = await execAsync('git', ['-C', tmpDir, ...args])
    return stdout.trim()
  }

  async function initRepo(): Promise<string> {
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.email', 't@t.com'])
    await git(['config', 'user.name', 'T'])
    writeFileSync(join(tmpDir, 'seed.txt'), 'seed\n', 'utf8')
    await git(['add', 'seed.txt'])
    await git(['commit', '-m', 'init'])
    return git(['rev-parse', 'HEAD'])
  }

  function writeStamp(commit: string | null): void {
    mkdirSync(join(tmpDir, 'dist'), { recursive: true })
    writeFileSync(join(tmpDir, 'dist', '.build-stamp'), `${JSON.stringify({ commit })}\n`, 'utf8')
  }

  it('reports pass when the stamp matches HEAD', async () => {
    const head = await initRepo()
    writeStamp(head)

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('pass')
    expect(result.detail).toContain(head.slice(0, 7))
  })

  it('reports drift with the stamp..HEAD range when the stamp is behind HEAD', async () => {
    const first = await initRepo()
    writeStamp(first)
    writeFileSync(join(tmpDir, 'seed.txt'), 'seed 2\n', 'utf8')
    await git(['add', 'seed.txt'])
    await git(['commit', '-m', 'second'])
    const head = await git(['rev-parse', 'HEAD'])

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('dist behind HEAD')
    expect(result.detail).toContain(`${first.slice(0, 7)}..${head.slice(0, 7)}`)
  })

  it('falls back to the imprecise mtime diagnostic when the stamp is missing (stale dist)', async () => {
    await initRepo()
    mkdirSync(join(tmpDir, 'dist', 'cli'), { recursive: true })
    const entry = join(tmpDir, 'dist', 'cli', 'index.js')
    writeFileSync(entry, '// built\n', 'utf8')
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    utimesSync(entry, past, past)

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('no build stamp')
    expect(result.detail).toContain('cannot verify precisely')
  })

  it('falls back to a passing imprecise diagnostic when the stamp is missing but dist is newer than HEAD', async () => {
    await initRepo()
    mkdirSync(join(tmpDir, 'dist', 'cli'), { recursive: true })
    const entry = join(tmpDir, 'dist', 'cli', 'index.js')
    writeFileSync(entry, '// built\n', 'utf8')
    const future = new Date(Date.now() + 60 * 60 * 1000)
    utimesSync(entry, future, future)

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('no build stamp')
    expect(result.detail).toContain('cannot verify precisely')
  })

  it('warns on a null-commit stamp (git was unavailable at build time)', async () => {
    await initRepo()
    writeStamp(null)

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('warn')
    expect(result.detail).toContain('git unavailable at build time')
  })

  it('treats a corrupt stamp as missing and uses the mtime fallback', async () => {
    await initRepo()
    mkdirSync(join(tmpDir, 'dist'), { recursive: true })
    writeFileSync(join(tmpDir, 'dist', '.build-stamp'), '{corrupt', 'utf8')
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    utimesSync(join(tmpDir, 'dist'), past, past)

    const result = await distFreshnessCheck(tmpDir)
    expect(result.detail).toContain('no build stamp')
  })

  it('skips (pass) when the package root is not a git checkout', async () => {
    mkdirSync(join(tmpDir, 'dist'), { recursive: true })

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('not a git checkout')
  })

  it('passes when there is no dist directory at all', async () => {
    await initRepo()

    const result = await distFreshnessCheck(tmpDir)
    expect(result.status).toBe('pass')
    expect(result.detail).toContain('no dist/')
  })
})

describe('emit-build-stamp.mjs', () => {
  let tmpDir: string
  const script = join(process.cwd(), 'scripts', 'emit-build-stamp.mjs')

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-emit-stamp-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  async function git(args: string[]): Promise<string> {
    const { stdout } = await execAsync('git', ['-C', tmpDir, ...args])
    return stdout.trim()
  }

  it('writes dist/.build-stamp with the checkout HEAD', async () => {
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.email', 't@t.com'])
    await git(['config', 'user.name', 'T'])
    writeFileSync(join(tmpDir, 'seed.txt'), 'seed\n', 'utf8')
    await git(['add', 'seed.txt'])
    await git(['commit', '-m', 'init'])
    const head = await git(['rev-parse', 'HEAD'])

    await execAsync(process.execPath, [script, tmpDir])

    const stamp = await readBuildStamp(join(tmpDir, 'dist'))
    expect(stamp?.commit).toBe(head)
    expect(stamp?.built_at).toBeTruthy()
  })

  it('emits a null-commit stamp instead of failing outside a git checkout', async () => {
    await execAsync(process.execPath, [script, tmpDir])

    const stamp = await readBuildStamp(join(tmpDir, 'dist'))
    expect(stamp).toBeDefined()
    expect(stamp?.commit).toBeNull()
  })
})
