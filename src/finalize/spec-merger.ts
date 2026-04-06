import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { parseSpec, parseDeltaSpec, type ParsedSpec, type ParsedDelta } from '../specs/spec-parser.js'
import { StateStore } from '../state/state-store.js'
import { join } from 'node:path'

export interface MergeConflict {
  capability: string
  requirementId: string
  reason: string
  baseHash: string
  currentHash: string
}

export interface MergeResult {
  status: 'clean' | 'conflict'
  merged: string[]
  conflicts: MergeConflict[]
}

export class SpecMerger {
  constructor(
    private specDir: string,
    private specLockManager: SpecLockManager,
  ) {}

  async merge(
    changeName: string,
    baseVersions: Record<string, string>,
    dryRun: boolean = false,
  ): Promise<MergeResult> {
    const state = new StateStore(this.specDir)
    const merged: string[] = []
    const conflicts: MergeConflict[] = []

    // Find delta specs in the change
    const changeDir = join('changes', changeName)
    const specExists = await state.exists(join(changeDir, 'spec.md'))
    if (!specExists) {
      return { status: 'clean', merged: [], conflicts: [] }
    }

    const deltaContent = await state.readRaw(join(changeDir, 'spec.md'))
    const deltaSpec = parseDeltaSpec(deltaContent)

    // For each delta, check base version against current
    for (const delta of deltaSpec.deltas) {
      // Determine which capability this delta affects
      const capabilityName = deltaSpec.title.replace(/\s*\(Delta\)\s*$/, '').toLowerCase().replace(/\s+/g, '-')

      // Check if capability spec exists
      const capSpecPath = join('specs', capabilityName, 'spec.md')
      const capExists = await state.exists(capSpecPath)

      if (delta.operation === 'ADDED' && !capExists) {
        // New capability — no conflict possible
        if (!dryRun) {
          await this.createCapabilitySpec(state, capabilityName, delta)
        }
        merged.push(capabilityName)
        continue
      }

      if (!capExists) {
        // Modifying/removing something that doesn't exist
        conflicts.push({
          capability: capabilityName,
          requirementId: delta.requirement.id,
          reason: `Capability '${capabilityName}' does not exist`,
          baseHash: '',
          currentHash: '',
        })
        continue
      }

      // Check base version
      const baseVersion = baseVersions[`${capabilityName}/spec.md`]
      const currentHash = await this.specLockManager.getBaseVersion(capabilityName)

      if (baseVersion && currentHash && baseVersion !== currentHash) {
        // Base has changed — check at requirement level
        const lock = await this.specLockManager.read(capabilityName)
        const reqLock = lock.requirements.find(r => r.id === delta.requirement.id)

        if (reqLock) {
          // Requirement exists and may have been modified
          conflicts.push({
            capability: capabilityName,
            requirementId: delta.requirement.id,
            reason: 'Requirement modified in both base and change',
            baseHash: baseVersion,
            currentHash: currentHash,
          })
          continue
        }
      }

      // Clean merge
      if (!dryRun) {
        await this.applyDelta(state, capabilityName, delta)
      }
      merged.push(`${capabilityName}/${delta.requirement.id}`)
    }

    return {
      status: conflicts.length > 0 ? 'conflict' : 'clean',
      merged,
      conflicts,
    }
  }

  private async createCapabilitySpec(
    state: StateStore,
    capability: string,
    delta: ParsedDelta,
  ): Promise<void> {
    const content = `# ${capability}\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
      delta.requirement.scenarios.map(s =>
        `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
      ).join('\n\n')
    }\n`

    await state.writeRaw(join('specs', capability, 'spec.md'), content)
    const parsed = parseSpec(content)
    await this.specLockManager.update(capability, parsed)
  }

  private async applyDelta(
    state: StateStore,
    capability: string,
    delta: ParsedDelta,
  ): Promise<void> {
    const specPath = join('specs', capability, 'spec.md')
    let content = await state.readRaw(specPath)

    if (delta.operation === 'ADDED') {
      content += `\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
        delta.requirement.scenarios.map(s =>
          `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
        ).join('\n\n')
      }\n`
    } else if (delta.operation === 'MODIFIED') {
      // Remove the old requirement section and append the replacement
      const reqPattern = new RegExp(
        `## Requirement: ${delta.requirement.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=## Requirement:|$)`,
      )
      content = content.replace(reqPattern, '')
      content += `\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
        delta.requirement.scenarios.map(s =>
          `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
        ).join('\n\n')
      }\n`
    } else if (delta.operation === 'RENAMED') {
      // Extract old name from first line: "Renamed from: <old name>"
      const renameMatch = delta.requirement.text.match(/^Renamed from:\s*(.+)/m)
      if (renameMatch) {
        const oldName = renameMatch[1].trim()
        const oldPattern = new RegExp(
          `## Requirement: ${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=## Requirement:|$)`,
        )
        content = content.replace(oldPattern, '')
      }
      // Build the replacement text, stripping the "Renamed from:" line
      const cleanedText = delta.requirement.text.replace(/^Renamed from:.*\n?/m, '').trim()
      content += `\n\n## Requirement: ${delta.requirement.name}\n\n${cleanedText}\n\n${
        delta.requirement.scenarios.map(s =>
          `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
        ).join('\n\n')
      }\n`
    } else if (delta.operation === 'REMOVED') {
      // Remove the requirement section
      const reqPattern = new RegExp(
        `## Requirement: ${delta.requirement.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=## Requirement:|$)`,
      )
      content = content.replace(reqPattern, '')
    }

    await state.writeRaw(specPath, content)
    const parsed = parseSpec(content)
    await this.specLockManager.update(capability, parsed)
  }
}
