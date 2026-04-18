import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import YAML from 'yaml'
import { GateDefinitionSchema, type GateDefinition } from '../schemas/gate-definition.js'
import type { GateResult } from '../schemas/gate-result.js'

export class GateRegistry {
  private gates = new Map<string, GateDefinition>()

  register(gate: GateDefinition): void {
    this.gates.set(gate.name, gate)
  }

  get(name: string): GateDefinition | undefined {
    return this.gates.get(name)
  }

  list(): GateDefinition[] {
    return Array.from(this.gates.values())
  }

  async loadFromDirectory(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir)
      for (const entry of entries) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue
        const content = await readFile(join(dir, entry), 'utf-8')
        const raw = YAML.parse(content)
        const gate = GateDefinitionSchema.parse(raw)
        this.register(gate)
      }
    } catch {
      // Directory doesn't exist or is empty — that's fine
    }
  }

  private async runCommand(
    command: string,
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; killed: boolean; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: true,
        env: { ...process.env },
      })
      let stdout = ''
      let stderr = ''
      let killed = false
      let exited = false

      const killGroup = (signal: 'SIGTERM' | 'SIGKILL') => {
        if (exited || child.pid == null) return
        try {
          if (process.platform === 'win32') {
            child.kill(signal)
          } else {
            process.kill(-child.pid, signal)
          }
        } catch {
          // ESRCH: group already dead. Ignore.
        }
      }

      const timer = setTimeout(() => {
        killed = true
        killGroup('SIGTERM')
        setTimeout(() => killGroup('SIGKILL'), 1000)
      }, timeoutMs)

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        exited = true
        clearTimeout(timer)
        resolve({ stdout, stderr, killed, exitCode: code })
      })
      child.on('error', (err) => {
        exited = true
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  async run(name: string, cwd: string): Promise<GateResult> {
    const gate = this.gates.get(name)
    if (!gate) {
      return {
        gate: name,
        status: 'skip',
        duration_ms: 0,
        output: `Gate '${name}' not configured`,
      }
    }

    const start = Date.now()
    try {
      const { stdout, stderr, killed, exitCode } = await this.runCommand(
        gate.command,
        cwd,
        gate.timeout,
      )
      const duration = Date.now() - start

      if (killed) {
        return {
          gate: name,
          status: 'fail',
          duration_ms: duration,
          output: `Gate timed out after ${gate.timeout}ms`,
          failures: [{ file: '', message: 'Timeout', severity: 'error' }],
        }
      }

      if (exitCode === 0) {
        return {
          gate: name,
          status: 'pass',
          duration_ms: duration,
          output: stdout || stderr || undefined,
        }
      }

      return {
        gate: name,
        status: 'fail',
        duration_ms: duration,
        output: stdout || stderr || undefined,
        failures: [
          {
            file: '',
            message: stderr || `Gate command failed with exit code ${exitCode}`,
            severity: 'error',
          },
        ],
      }
    } catch (err: unknown) {
      const duration = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      return {
        gate: name,
        status: 'fail',
        duration_ms: duration,
        output: message,
        failures: [{ file: '', message, severity: 'error' }],
      }
    }
  }

  async runAll(names: string[], cwd: string): Promise<GateResult[]> {
    const results: GateResult[] = []
    let stoppedBy: string | null = null

    for (const name of names) {
      if (stoppedBy !== null) {
        results.push({
          gate: name,
          status: 'skip',
          duration_ms: 0,
          output: `Skipped due to earlier fail of ${stoppedBy}`,
        })
        continue
      }

      const result = await this.runWithPolicy(name, cwd)
      results.push(result)

      if (result.status === 'fail') {
        const gate = this.gates.get(name)
        if (gate?.on_failure === 'stop') {
          stoppedBy = name
        }
      }
    }

    return results
  }

  async runWithPolicy(name: string, cwd: string): Promise<GateResult> {
    const gate = this.gates.get(name)
    const result = await this.run(name, cwd)
    if (result.status !== 'fail') return result
    if (!gate) return result

    switch (gate.on_failure) {
      case 'retry_once':
        return await this.run(name, cwd)
      case 'continue_with_warning':
        return { ...result, status: 'warn' }
      case 'stop':
        return result
      default:
        return result
    }
  }

  async runWithRetry(name: string, cwd: string): Promise<GateResult> {
    return this.runWithPolicy(name, cwd)
  }
}
