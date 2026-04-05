import { describe, it, expect, beforeEach } from 'vitest'
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
    let callCount = 0
    // Use a command that tracks calls via a side effect
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
})
