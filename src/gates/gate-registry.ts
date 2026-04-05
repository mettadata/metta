import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { GateDefinitionSchema, type GateDefinition } from '../schemas/gate-definition.js'
import type { GateResult } from '../schemas/gate-result.js'

const execAsync = promisify(exec)

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
      const { stdout, stderr } = await execAsync(gate.command, {
        cwd,
        timeout: gate.timeout,
        env: { ...process.env },
      })

      return {
        gate: name,
        status: 'pass',
        duration_ms: Date.now() - start,
        output: stdout || stderr || undefined,
      }
    } catch (err: unknown) {
      const duration = Date.now() - start
      const error = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean }

      if (error.killed) {
        return {
          gate: name,
          status: 'fail',
          duration_ms: duration,
          output: `Gate timed out after ${gate.timeout}ms`,
          failures: [{ file: '', message: 'Timeout', severity: 'error' }],
        }
      }

      return {
        gate: name,
        status: 'fail',
        duration_ms: duration,
        output: error.stdout || error.stderr || error.message,
        failures: [
          {
            file: '',
            message: error.stderr || error.message || 'Gate command failed',
            severity: 'error',
          },
        ],
      }
    }
  }

  async runAll(names: string[], cwd: string): Promise<GateResult[]> {
    const results: GateResult[] = []
    for (const name of names) {
      results.push(await this.run(name, cwd))
    }
    return results
  }

  async runWithRetry(name: string, cwd: string): Promise<GateResult> {
    const gate = this.gates.get(name)
    const result = await this.run(name, cwd)

    if (result.status === 'fail' && gate?.on_failure === 'retry_once') {
      const retry = await this.run(name, cwd)
      return retry
    }

    return result
  }
}
