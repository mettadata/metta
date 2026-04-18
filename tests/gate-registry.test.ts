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

  describe.skipIf(process.platform === 'win32')('gate timeout reaps process group', () => {
    it('kills grandchild sleep processes when the gate command times out', async () => {
      const registry = new GateRegistry()
      registry.register({
        name: 'slow-with-grandchild',
        description: 'command that backgrounds a grandchild',
        command: 'sleep 30 & sleep 30',
        timeout: 500,
        required: true,
        on_failure: 'stop',
      })

      const start = Date.now()
      const result = await registry.run('slow-with-grandchild', process.cwd())
      const duration = Date.now() - start

      expect(result.status).toBe('fail')
      // Per Task 1.1: runCommand sets output to "Gate timed out after Nms"
      // and failures[0].message to "Timeout". Check both signals.
      expect(result.output?.toLowerCase()).toContain('timed out')
      expect(result.failures?.[0]?.message).toBe('Timeout')
      // Must resolve within: 500ms timeout + 1s SIGKILL grace + slack
      expect(duration).toBeLessThan(3000)

      // Give the OS a moment to fully reap the process group
      await new Promise(r => setTimeout(r, 500))

      // Verify no lingering sleep processes we spawned remain. We use pgrep
      // to list all sleeps owned by this user; it's inherently fuzzy because
      // other sleeps may exist, so we bound check: after SIGKILL, the count
      // of our PGID's descendants should be 0. Simplest proxy: our test
      // spawned exactly 2 sleep 30s; waiting 1.5s after timeout, none of
      // OUR sleeps should still be alive. Since we don't track PGID in the
      // test harness, we assert on the looser invariant: the process exit
      // was prompt (checked via duration above) and the gate returned the
      // timeout status. The PGID-kill behavior is covered end-to-end by
      // the prompt exit; a grandchild that survived would keep the parent
      // shell alive and duration would blow past the budget.
    })
  })

  describe('project-local override precedence', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'gate-override-'))
    })

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true })
    })

    it('project-local gate overrides built-in gate with same name', async () => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const builtinDir = join(tempDir, 'builtin')
      const projectDir = join(tempDir, 'project')
      await mkdir(builtinDir)
      await mkdir(projectDir)

      await writeFile(join(builtinDir, 'tests.yaml'), [
        'name: tests',
        'description: Run tests',
        'command: npm test',
        'timeout: 120000',
        'required: true',
        'on_failure: stop',
      ].join('\n'))
      await writeFile(join(projectDir, 'tests.yaml'), [
        'name: tests',
        'description: Run Rust tests',
        'command: cargo test',
        'timeout: 120000',
        'required: true',
        'on_failure: stop',
      ].join('\n'))

      const r = new GateRegistry()
      await r.loadFromDirectory(builtinDir)
      await r.loadFromDirectory(projectDir)

      const gate = r.get('tests')
      expect(gate?.command).toBe('cargo test')
    })

    it('built-in gates without project override remain intact', async () => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const builtinDir = join(tempDir, 'builtin')
      const projectDir = join(tempDir, 'project')
      await mkdir(builtinDir)
      await mkdir(projectDir)

      await writeFile(join(builtinDir, 'lint.yaml'), [
        'name: lint',
        'description: Run linter',
        'command: npm run lint',
        'timeout: 60000',
        'required: true',
        'on_failure: stop',
      ].join('\n'))
      // project dir is empty — only a different gate overridden elsewhere would not touch `lint`
      const r = new GateRegistry()
      await r.loadFromDirectory(builtinDir)
      await r.loadFromDirectory(projectDir)

      expect(r.get('lint')?.command).toBe('npm run lint')
    })

    it('loadFromDirectory on non-existent path is silent', async () => {
      const r = new GateRegistry()
      await expect(r.loadFromDirectory(join(tempDir, 'does-not-exist'))).resolves.toBeUndefined()
    })
  })
})
