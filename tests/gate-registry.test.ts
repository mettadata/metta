import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GateRegistry } from '../src/gates/gate-registry.js'
import type { GateDefinition } from '../src/schemas/gate-definition.js'

describe('GateRegistry', () => {
  let registry: GateRegistry

  beforeEach(() => {
    registry = new GateRegistry()
  })

  it('registers and retrieves gates', () => {
    const gate: GateDefinition = {
      name: 'tests',
      description: 'Run tests',
      command: 'npm test',
      timeout: 120000,
      required: true,
      on_failure: 'retry_once',
    }
    registry.register(gate)
    expect(registry.get('tests')).toEqual(gate)
  })

  it('returns undefined for unregistered gates', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('lists all registered gates', () => {
    registry.register({ name: 'a', description: 'A', command: 'a', timeout: 1000, required: true, on_failure: 'stop' })
    registry.register({ name: 'b', description: 'B', command: 'b', timeout: 1000, required: false, on_failure: 'stop' })
    expect(registry.list()).toHaveLength(2)
  })

  it('runs a gate with a passing command', async () => {
    registry.register({
      name: 'echo-test',
      description: 'Echo test',
      command: 'echo "hello"',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })
    const result = await registry.run('echo-test', process.cwd())
    expect(result.status).toBe('pass')
    expect(result.gate).toBe('echo-test')
    expect(result.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('runs a gate with a failing command', async () => {
    registry.register({
      name: 'fail-test',
      description: 'Fail test',
      command: 'exit 1',
      timeout: 5000,
      required: true,
      on_failure: 'stop',
    })
    const result = await registry.run('fail-test', process.cwd())
    expect(result.status).toBe('fail')
  })

  it('returns skip for unknown gates', async () => {
    const result = await registry.run('unknown', process.cwd())
    expect(result.status).toBe('skip')
  })

  it('runs all gates sequentially', async () => {
    registry.register({ name: 'g1', description: 'G1', command: 'echo g1', timeout: 5000, required: true, on_failure: 'stop' })
    registry.register({ name: 'g2', description: 'G2', command: 'echo g2', timeout: 5000, required: true, on_failure: 'stop' })
    const results = await registry.runAll(['g1', 'g2'], process.cwd())
    expect(results).toHaveLength(2)
    expect(results.every(r => r.status === 'pass')).toBe(true)
  })

  it('loads gates from YAML directory', async () => {
    const gatesDir = new URL('../src/templates/gates', import.meta.url).pathname
    await registry.loadFromDirectory(gatesDir)
    expect(registry.get('tests')).toBeDefined()
    expect(registry.get('lint')).toBeDefined()
    expect(registry.get('typecheck')).toBeDefined()
    expect(registry.get('build')).toBeDefined()
  })

  it('retries once on failure with retry_once policy', async () => {
    registry.register({
      name: 'retry-test',
      description: 'Retry test',
      command: 'exit 1',
      timeout: 5000,
      required: true,
      on_failure: 'retry_once',
    })
    const result = await registry.runWithRetry('retry-test', process.cwd())
    // Should still fail after retry
    expect(result.status).toBe('fail')
  })

  describe('runWithPolicy', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'metta-gate-policy-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('retry_once — retries on first fail, passes on retry', async () => {
      const sentinel = join(tempDir, 'sentinel')
      const flipCmd = `if [ -f ${sentinel} ]; then rm ${sentinel}; exit 0; else touch ${sentinel}; exit 1; fi`
      registry.register({
        name: 'flip',
        description: 'Flip',
        command: flipCmd,
        timeout: 5000,
        required: true,
        on_failure: 'retry_once',
      })
      const result = await registry.runWithPolicy('flip', tempDir)
      expect(result.status).toBe('pass')
    })

    it('retry_once — no retry on initial pass', async () => {
      registry.register({
        name: 'pass-immediately',
        description: 'Pass',
        command: 'true',
        timeout: 5000,
        required: true,
        on_failure: 'retry_once',
      })
      const result = await registry.runWithPolicy('pass-immediately', tempDir)
      expect(result.status).toBe('pass')
    })

    it('retry_once — both fails return fail', async () => {
      registry.register({
        name: 'always-fails',
        description: 'Always fails',
        command: 'false',
        timeout: 5000,
        required: true,
        on_failure: 'retry_once',
      })
      const result = await registry.runWithPolicy('always-fails', tempDir)
      expect(result.status).toBe('fail')
    })

    it('continue_with_warning — downgrades fail to warn', async () => {
      registry.register({
        name: 'warn-on-fail',
        description: 'Warn on fail',
        command: 'false',
        timeout: 5000,
        required: false,
        on_failure: 'continue_with_warning',
      })
      const result = await registry.runWithPolicy('warn-on-fail', tempDir)
      expect(result.status).toBe('warn')
      // Verify that failure context is preserved on the downgraded warn result
      const hasContext = (result.output !== undefined && result.output !== '') || (result.failures !== undefined && result.failures.length > 0)
      expect(hasContext).toBe(true)
    })

    it('continue_with_warning — leaves pass unchanged', async () => {
      registry.register({
        name: 'warn-but-pass',
        description: 'Pass',
        command: 'true',
        timeout: 5000,
        required: false,
        on_failure: 'continue_with_warning',
      })
      const result = await registry.runWithPolicy('warn-but-pass', tempDir)
      expect(result.status).toBe('pass')
    })

    it('stop — returns fail unchanged', async () => {
      registry.register({
        name: 'stop-on-fail',
        description: 'Stop on fail',
        command: 'false',
        timeout: 5000,
        required: true,
        on_failure: 'stop',
      })
      const result = await registry.runWithPolicy('stop-on-fail', tempDir)
      expect(result.status).toBe('fail')
    })
  })

  describe('runAll stop-propagation', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'metta-gate-runall-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('stop — subsequent gates get skip with reference to failing gate', async () => {
      registry.register({ name: 'A', description: 'A', command: 'true', timeout: 5000, required: true, on_failure: 'retry_once' })
      registry.register({ name: 'B', description: 'B', command: 'false', timeout: 5000, required: true, on_failure: 'stop' })
      registry.register({ name: 'C', description: 'C', command: 'true', timeout: 5000, required: true, on_failure: 'retry_once' })

      const results = await registry.runAll(['A', 'B', 'C'], tempDir)
      expect(results).toHaveLength(3)
      expect(results[0]?.status).toBe('pass')
      expect(results[1]?.status).toBe('fail')
      expect(results[2]?.status).toBe('skip')
      expect(results[2]?.output).toContain('Skipped due to earlier fail of B')
    })

    it('no stop — completes all gates even on fail', async () => {
      registry.register({ name: 'A', description: 'A', command: 'false', timeout: 5000, required: false, on_failure: 'continue_with_warning' })
      registry.register({ name: 'B', description: 'B', command: 'true', timeout: 5000, required: true, on_failure: 'retry_once' })

      const results = await registry.runAll(['A', 'B'], tempDir)
      expect(results).toHaveLength(2)
      expect(results[0]?.status).toBe('warn')
      expect(results[1]?.status).toBe('pass')
    })
  })

  describe('runWithRetry back-compat alias', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'metta-gate-alias-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('runWithRetry is a back-compat alias for runWithPolicy', async () => {
      registry.register({
        name: 'alias-test',
        description: 'Alias',
        command: 'true',
        timeout: 5000,
        required: true,
        on_failure: 'retry_once',
      })
      const viaRetry = await registry.runWithRetry('alias-test', tempDir)
      const viaPolicy = await registry.runWithPolicy('alias-test', tempDir)
      expect(viaRetry.status).toBe('pass')
      expect(viaPolicy.status).toBe('pass')
    })
  })
})
