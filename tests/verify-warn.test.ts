import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { registerVerifyCommand } from '../src/cli/commands/verify.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'
import { GateRegistry } from '../src/gates/gate-registry.js'
import type { GateResult } from '../src/schemas/gate-result.js'
import type { ChangeMetadata } from '../src/schemas/change-metadata.js'

// Test the verify command's warn handling.
//
// The verify command is tightly coupled to createCliContext (instantiates an
// ArtifactStore + GateRegistry inline inside its commander action), so we
// exercise it via the real registerVerifyCommand but stub the collaborators
// on their prototypes. This keeps the test focused on:
//   1. verify treats `warn` as "all passed" (exit 0)
//   2. verify emits warn gate names to stderr
//   3. verify exits non-zero when any gate fails

class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`)
  }
}

describe('verify command — warn handling', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let listChangesSpy: ReturnType<typeof vi.spyOn>
  let getChangeSpy: ReturnType<typeof vi.spyOn>
  let loadFromDirSpy: ReturnType<typeof vi.spyOn>
  let listGatesSpy: ReturnType<typeof vi.spyOn>
  let runAllSpy: ReturnType<typeof vi.spyOn>

  const fakeChange: ChangeMetadata = {
    workflow: 'standard',
    created: new Date().toISOString(),
    status: 'active',
    current_artifact: 'verify',
    base_versions: {},
    artifacts: {},
  }

  beforeEach(() => {
    // Throw on process.exit so we can observe the exit code without
    // actually terminating the test runner.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitCalled(code ?? 0)
    }) as never)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    listChangesSpy = vi
      .spyOn(ArtifactStore.prototype, 'listChanges')
      .mockResolvedValue(['test-change'])
    getChangeSpy = vi
      .spyOn(ArtifactStore.prototype, 'getChange')
      .mockResolvedValue(fakeChange)
    // Prevent loading the real templates/gates directory; we control results
    // directly via runAll.
    loadFromDirSpy = vi
      .spyOn(GateRegistry.prototype, 'loadFromDirectory')
      .mockResolvedValue(undefined)
    listGatesSpy = vi.spyOn(GateRegistry.prototype, 'list').mockReturnValue([
      { name: 'flaky-lint', description: '', command: '', timeout: 1, required: true, on_failure: 'continue_with_warning' },
      { name: 'tests', description: '', command: '', timeout: 1, required: true, on_failure: 'retry_once' },
    ])
    runAllSpy = vi.spyOn(GateRegistry.prototype, 'runAll')
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stderrSpy.mockRestore()
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    listChangesSpy.mockRestore()
    getChangeSpy.mockRestore()
    loadFromDirSpy.mockRestore()
    listGatesSpy.mockRestore()
    runAllSpy.mockRestore()
  })

  async function runVerify(args: string[]): Promise<number> {
    const program = new Command()
    program.exitOverride()
    // Match the global --json option declared on the real CLI so verify
    // can read program.opts().json safely.
    program.option('--json', 'Machine-readable JSON output')
    registerVerifyCommand(program)

    try {
      await program.parseAsync(['node', 'metta', ...args])
    } catch (err) {
      if (err instanceof ExitCalled) return err.code
      throw err
    }
    return 0
  }

  it('exits 0 when all gates warn or pass', async () => {
    const warnResult: GateResult = {
      gate: 'flaky-lint',
      status: 'warn',
      duration_ms: 5,
      output: 'lint had 2 warnings but policy is continue_with_warning',
    }
    const passResult: GateResult = {
      gate: 'tests',
      status: 'pass',
      duration_ms: 10,
    }
    runAllSpy.mockResolvedValue([warnResult, passResult])

    const code = await runVerify(['verify', 'test-change'])
    expect(code).toBe(0)

    // The warn gate's name must surface on stderr so operators notice it
    // even though verify treats it as a pass.
    const stderrPayload = stderrSpy.mock.calls
      .map(c => (typeof c[0] === 'string' ? c[0] : ''))
      .join('')
    expect(stderrPayload).toContain('flaky-lint')
    expect(stderrPayload).toContain('⚠')
  })

  it('exits non-zero when any gate fails', async () => {
    const failResult: GateResult = {
      gate: 'tests',
      status: 'fail',
      duration_ms: 20,
      output: 'assertion failure',
      failures: [{ file: '', message: 'boom', severity: 'error' }],
    }
    const passResult: GateResult = {
      gate: 'flaky-lint',
      status: 'pass',
      duration_ms: 5,
    }
    runAllSpy.mockResolvedValue([passResult, failResult])

    const code = await runVerify(['verify', 'test-change'])
    expect(code).not.toBe(0)
  })
})
