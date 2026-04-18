import { StateStore } from '../state/state-store.js'
import { SpecLockSchema, type SpecLock, type SpecLockRequirement } from '../schemas/spec-lock.js'
import { type ParsedSpec, hashSpec } from './spec-parser.js'
import { toSlugUntruncated } from '../util/slug.js'
import { join } from 'node:path'

export class SpecLockManager {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async read(capability: string): Promise<SpecLock> {
    return this.state.read(
      join('specs', capability, 'spec.lock'),
      SpecLockSchema,
    )
  }

  async write(capability: string, lock: SpecLock): Promise<void> {
    await this.state.write(
      join('specs', capability, 'spec.lock'),
      SpecLockSchema,
      lock,
    )
  }

  async exists(capability: string): Promise<boolean> {
    return this.state.exists(join('specs', capability, 'spec.lock'))
  }

  createFromParsed(
    spec: ParsedSpec,
    version: number = 1,
    source: 'scan' | 'manual' | 'change' = 'change',
  ): SpecLock {
    const requirements: SpecLockRequirement[] = spec.requirements.map(req => ({
      id: req.id,
      hash: req.hash,
      scenarios: req.scenarios.map(s => toSlugUntruncated(s.name)),
    }))

    return {
      version,
      hash: hashSpec(spec),
      updated: new Date().toISOString(),
      status: 'draft',
      source,
      requirements,
    }
  }

  async update(capability: string, spec: ParsedSpec): Promise<SpecLock> {
    let version = 1
    try {
      const existing = await this.read(capability)
      version = existing.version + 1
    } catch {
      // First version
    }

    const lock = this.createFromParsed(spec, version)
    await this.write(capability, lock)
    return lock
  }

  async getBaseVersion(capability: string): Promise<string | null> {
    try {
      const lock = await this.read(capability)
      return lock.hash
    } catch {
      return null
    }
  }
}
