import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runCli } from './helpers/cli.js'

// Guards for the deterministic CLI test runtime (ci-test-infrastructure):
// the runtime the tests exec must be declared in package.json so `npm ci`
// installs it and cold runners never resolve it over the network, and a
// timeout-killed subprocess must be diagnosable from stderr.
// See spec/archive & spec/issues: CI flakiness from undeclared tsx.

const REPO_ROOT = join(import.meta.dirname, '..')

describe('CLI test runtime is declared', () => {
  it('declares tsx in package.json devDependencies', async () => {
    const pkg = JSON.parse(
      await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> }
    expect(pkg.devDependencies).toBeDefined()
    expect(pkg.devDependencies?.tsx).toMatch(/^\^?\d+\.\d+\.\d+/)
  })
})

describe('runCli timeout diagnosability', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'metta-cli-runtime-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('marks a timeout-killed subprocess in stderr', async () => {
    // 1ms timeout guarantees the subprocess is killed before it can do
    // any work, exercising the kill-marker path without a long wait.
    const result = await runCli(['--help'], dir, 1)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('[runCli] subprocess killed')
    expect(result.stderr).toContain('timeout=1ms')
  })
})
