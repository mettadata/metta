import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerGateCommand } from '../src/cli/commands/gate.js'

// CLI-level proof that gate-running commands honor a non-JS project's
// `.metta/gates/` overrides (US-4). A fixture project overrides the built-in
// `tests` gate with `cargo test`; `metta gate list --json` must report the
// override command, not the npm built-in. `gate list` is the lowest-friction
// proof point: it loads gates through the same loadGatesWithOverrides path as
// `gate run`/`verify`/`ship`/`finalize` but spawns no processes.

describe('CLI: gate commands load project-local gate overrides', () => {
  let projectRoot: string
  let cwdSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'metta-gate-overrides-'))
    await mkdir(join(projectRoot, '.metta', 'gates'), { recursive: true })
    await writeFile(join(projectRoot, '.metta', 'gates', 'tests.yaml'), [
      'name: tests',
      'description: Run Rust tests',
      'command: cargo test',
      'timeout: 120000',
      'required: true',
      'on_failure: stop',
    ].join('\n'))

    // createCliContext resolves projectRoot from process.cwd().
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    cwdSpy.mockRestore()
    logSpy.mockRestore()
    await rm(projectRoot, { recursive: true, force: true })
  })

  async function runGate(args: string[]): Promise<void> {
    const program = new Command()
    program.option('--json', 'Machine-readable JSON output')
    registerGateCommand(program)
    await program.parseAsync(['node', 'metta', ...args])
  }

  function loggedJson(): unknown {
    const payload = logSpy.mock.calls
      .map(c => (typeof c[0] === 'string' ? c[0] : ''))
      .join('')
    return JSON.parse(payload)
  }

  it('gate list --json reports the non-npm override command for the tests gate', async () => {
    await runGate(['--json', 'gate', 'list'])

    const { gates } = loggedJson() as { gates: Array<{ name: string; command: string }> }
    const testsGate = gates.find(g => g.name === 'tests')
    expect(testsGate).toBeDefined()
    expect(testsGate!.command).toBe('cargo test')
    expect(testsGate!.command).not.toContain('npm')

    // Built-ins without a project override are still present (two-pass load,
    // not a replacement of the whole registry).
    expect(gates.length).toBeGreaterThan(1)
  })

  it('gate show --json resolves the overridden gate definition', async () => {
    await runGate(['--json', 'gate', 'show', 'tests'])

    const gate = loggedJson() as { name: string; command: string; description: string }
    expect(gate.name).toBe('tests')
    expect(gate.command).toBe('cargo test')
    expect(gate.description).toBe('Run Rust tests')
  })
})
