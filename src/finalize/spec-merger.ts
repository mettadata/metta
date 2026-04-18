import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { parseSpec, parseDeltaSpec, type ParsedSpec, type ParsedDelta } from '../specs/spec-parser.js'
import { StateStore } from '../state/state-store.js'
import { toSlug } from '../util/slug.js'
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
      const capabilityName = toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))

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
        const conflict = await this.applyDelta(state, capabilityName, delta)
        if (conflict) {
          conflicts.push(conflict)
          continue
        }
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

  /**
   * Apply a single delta (ADDED/MODIFIED/RENAMED/REMOVED) to a capability spec on disk.
   * Returns null on success. Returns a MergeConflict when MODIFIED/RENAMED/REMOVED
   * targets a requirement that does not exist — caller MUST record the conflict and
   * skip recording the capability as merged. Idempotent: applying the same delta to
   * already-applied content produces byte-identical output.
   */
  private async applyDelta(
    state: StateStore,
    capability: string,
    delta: ParsedDelta,
  ): Promise<MergeConflict | null> {
    const specPath = join('specs', capability, 'spec.md')
    let content = await state.readRaw(specPath)

    if (delta.operation === 'ADDED') {
      content += `\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
        delta.requirement.scenarios.map(s =>
          `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
        ).join('\n\n')
      }\n`
    } else if (delta.operation === 'MODIFIED' || delta.operation === 'RENAMED') {
      // Split on requirement header boundary so the preamble is preserved and
      // each section is keyed by its requirement name. This avoids regex
      // escaping pitfalls and prevents accidental duplication when the target
      // cannot be located.
      const { preamble, sections } = splitRequirements(content)

      if (delta.operation === 'MODIFIED') {
        if (!sections.has(delta.requirement.name)) {
          return {
            capability,
            requirementId: delta.requirement.id,
            reason: 'requirement not found',
            baseHash: '',
            currentHash: '',
          }
        }
        const newBody = renderRequirementBody(
          delta.requirement.name,
          delta.requirement.text,
          delta.requirement.scenarios,
        )
        sections.set(delta.requirement.name, newBody)
      } else {
        // RENAMED — extract old name, then re-key the map preserving order
        const renameMatch = delta.requirement.text.match(/^Renamed from:\s*(.+)/m)
        const oldName = renameMatch ? renameMatch[1].trim() : ''
        if (!oldName || !sections.has(oldName)) {
          return {
            capability,
            requirementId: delta.requirement.id,
            reason: 'requirement not found',
            baseHash: '',
            currentHash: '',
          }
        }
        const cleanedText = delta.requirement.text.replace(/^Renamed from:.*\n?/m, '').trim()
        const newBody = renderRequirementBody(
          delta.requirement.name,
          cleanedText,
          delta.requirement.scenarios,
        )
        const rekeyed = new Map<string, string>()
        for (const [name, body] of sections) {
          if (name === oldName) {
            rekeyed.set(delta.requirement.name, newBody)
          } else {
            rekeyed.set(name, body)
          }
        }
        sections.clear()
        for (const [name, body] of rekeyed) sections.set(name, body)
      }

      content = joinRequirements(preamble, sections)
    } else if (delta.operation === 'REMOVED') {
      // Use the same section-keyed split as MODIFIED/RENAMED so we never silently
      // mis-match across requirement bodies that happen to contain `## Requirement:`.
      const { preamble, sections } = splitRequirements(content)
      if (!sections.has(delta.requirement.name)) {
        return {
          capability,
          requirementId: delta.requirement.id,
          reason: 'requirement not found',
          baseHash: '',
          currentHash: '',
        }
      }
      sections.delete(delta.requirement.name)
      content = joinRequirements(preamble, sections)
    }

    await state.writeRaw(specPath, content)
    const parsed = parseSpec(content)
    await this.specLockManager.update(capability, parsed)
    return null
  }
}

/**
 * Split spec content on the `\n## Requirement: ` boundary. Returns the file
 * preamble plus an ordered Map keyed by requirement name → section body. The
 * body is the text that follows the requirement-header line (the name is
 * stored as the map key; it is not duplicated in the body).
 */
function splitRequirements(content: string): {
  preamble: string
  sections: Map<string, string>
} {
  const marker = '\n## Requirement: '
  const sections = new Map<string, string>()
  const firstIdx = content.indexOf(marker)
  if (firstIdx === -1) {
    return { preamble: content, sections }
  }
  const preamble = content.slice(0, firstIdx)
  const rest = content.slice(firstIdx + 1) // drop leading '\n'; keep '## Requirement: ...'
  // Split on occurrences of the header at line-start; we re-use the same
  // boundary but need to preserve the header token on each chunk.
  const chunks: string[] = []
  let cursor = 0
  while (cursor < rest.length) {
    const next = rest.indexOf(marker, cursor + 1)
    if (next === -1) {
      chunks.push(rest.slice(cursor))
      break
    }
    // next points at '\n## Requirement: ' — chunk ends just before that '\n'
    chunks.push(rest.slice(cursor, next))
    cursor = next + 1 // skip the '\n'
  }
  for (const chunk of chunks) {
    // chunk starts with '## Requirement: <name>\n<body>' (possibly no body)
    const headerPrefix = '## Requirement: '
    if (!chunk.startsWith(headerPrefix)) continue
    const afterHeader = chunk.slice(headerPrefix.length)
    const nlIdx = afterHeader.indexOf('\n')
    let name: string
    let body: string
    if (nlIdx === -1) {
      name = afterHeader.trim()
      body = ''
    } else {
      name = afterHeader.slice(0, nlIdx).trim()
      body = afterHeader.slice(nlIdx + 1) // preserve trailing newlines
    }
    sections.set(name, body)
  }
  return { preamble, sections }
}

/**
 * Inverse of `splitRequirements`: emit preamble + each '\n## Requirement: name\nbody' section.
 */
function joinRequirements(preamble: string, sections: Map<string, string>): string {
  let out = preamble
  for (const [name, body] of sections) {
    out += `\n## Requirement: ${name}\n${body}`
  }
  return out
}

/**
 * Render a requirement body (the text that follows the `## Requirement: <name>`
 * header line). Includes the blank line after the header, the requirement
 * text, scenario blocks, and a trailing newline so the output is byte-stable
 * when re-applied.
 */
function renderRequirementBody(
  _name: string,
  text: string,
  scenarios: ReadonlyArray<{ name: string; steps: readonly string[] }>,
): string {
  const scenarioBlock = scenarios
    .map(s => `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`)
    .join('\n\n')
  if (scenarioBlock.length === 0) {
    return `\n${text}\n`
  }
  return `\n${text}\n\n${scenarioBlock}\n`
}
