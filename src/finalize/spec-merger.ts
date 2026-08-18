import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { parseSpec, parseDeltaSpec, type ParsedDelta } from '../specs/spec-parser.js'
import { StateStore } from '../state/state-store.js'
import { toSlug } from '../util/slug.js'
import { join } from 'node:path'

/**
 * Raised when a delta spec's merge target cannot be accepted — e.g. the H1
 * resolves to the change's own slug, no such capability exists, and the
 * author has not confirmed a net-new capability with the
 * `<!-- new-capability -->` marker. Co-located with the merge-target domain
 * logic; thrown by `metta complete spec` before any write happens.
 */
export class SpecTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpecTargetError'
  }
}

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
  /**
   * ADDED deltas whose requirement name already exists in the target
   * capability spec — skipped as no-ops instead of appended (idempotent
   * re-merge). Entries are `${capability}/${requirementId}`. Dry-run and
   * applying merges classify no-ops identically.
   */
  noops?: string[]
}

/**
 * A capability's reconciled-but-not-yet-committed state, produced by the
 * compute phase and consumed by the commit phase. `content` is the final
 * merged file content after every delta targeting this capability (in this
 * run) has been composed in order.
 */
interface StagedCapability {
  content: string
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
    const noops: string[] = []

    // Find delta specs in the change
    const changeDir = join('changes', changeName)
    const specExists = await state.exists(join(changeDir, 'spec.md'))
    if (!specExists) {
      return { status: 'clean', merged: [], conflicts: [] }
    }

    const deltaContent = await state.readRaw(join(changeDir, 'spec.md'))
    const deltaSpec = parseDeltaSpec(deltaContent)

    // Compute phase — pure over in-memory content, identical in both dry-run
    // and applying mode. Staged content is threaded forward per capability so
    // multiple deltas against the same capability in this run compose: each
    // subsequent delta reconciles against the previous delta's output, not
    // the stale on-disk file. Only capabilities that received at least one
    // real (non-noop) change are marked dirty and become commit candidates.
    const stagedContent = new Map<string, StagedCapability>()
    const dirtyCapabilities = new Set<string>()

    for (const delta of deltaSpec.deltas) {
      // Determine which capability this delta affects
      const capabilityName = toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))

      let staged = stagedContent.get(capabilityName)
      let capExists: boolean
      if (staged) {
        capExists = true
      } else {
        const capSpecPath = join('specs', capabilityName, 'spec.md')
        const onDisk = await state.exists(capSpecPath)
        if (onDisk) {
          const content = await state.readRaw(capSpecPath)
          staged = { content }
          stagedContent.set(capabilityName, staged)
          capExists = true
        } else {
          capExists = false
        }
      }

      if (delta.operation === 'ADDED' && !capExists) {
        // New capability — no conflict possible
        const content = renderNewCapabilitySpec(capabilityName, delta)
        stagedContent.set(capabilityName, { content })
        dirtyCapabilities.add(capabilityName)
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

      // Check base version (against on-disk lock — unaffected by this run's
      // in-memory staging, since a base-version conflict is about drift
      // relative to the change's recorded base, not this run's own edits).
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

      // Reconcile the delta against the capability's current staged content.
      // `staged` is guaranteed set here (capExists is true).
      const outcome = reconcileDelta(staged!.content, capabilityName, delta)
      if (outcome === 'noop') {
        noops.push(`${capabilityName}/${delta.requirement.id}`)
        continue
      }
      if ('reason' in outcome) {
        conflicts.push(outcome)
        continue
      }

      stagedContent.set(capabilityName, { content: outcome.content })
      dirtyCapabilities.add(capabilityName)
      merged.push(`${capabilityName}/${delta.requirement.id}`)
    }

    const status: MergeResult['status'] = conflicts.length > 0 ? 'conflict' : 'clean'

    // Commit phase — apply mode only, all-or-nothing: writes happen only
    // when the compute phase produced zero conflicts. A conflict anywhere in
    // the run means zero files and zero locks are written, regardless of how
    // many earlier deltas reconciled cleanly. Every dirty capability's final
    // staged content is parsed up front, before any write — a parse failure
    // here aborts with zero writes rather than surfacing mid-loop, after some
    // capabilities' spec files were already written but before their lock
    // was updated.
    if (!dryRun && status === 'clean') {
      const parsedByCapability = new Map<string, ReturnType<typeof parseSpec>>()
      for (const capability of dirtyCapabilities) {
        const content = stagedContent.get(capability)!.content
        parsedByCapability.set(capability, parseSpec(content))
      }
      for (const capability of dirtyCapabilities) {
        const content = stagedContent.get(capability)!.content
        await state.writeRaw(join('specs', capability, 'spec.md'), content)
        await this.specLockManager.update(capability, parsedByCapability.get(capability)!)
      }
    }

    return {
      status,
      merged,
      conflicts,
      noops,
    }
  }
}

/**
 * Pure render of a brand-new capability spec file's content from its first
 * ADDED delta. No I/O — used by the compute phase for both dry-run and
 * applying merges.
 */
function renderNewCapabilitySpec(capability: string, delta: ParsedDelta): string {
  return `# ${capability}\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
    delta.requirement.scenarios.map(s =>
      `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
    ).join('\n\n')
  }\n`
}

/**
 * Pure reconciliation of a single delta (ADDED/MODIFIED/RENAMED/REMOVED)
 * against in-memory capability content. No I/O — this is the shared compute
 * step run identically by dry-run and applying merges.
 *
 * Returns the new content on success. Returns a `MergeConflict` when
 * MODIFIED/RENAMED/REMOVED targets a requirement that does not exist in
 * `content` — caller MUST record the conflict and skip recording the
 * capability as merged. Returns the string 'noop' when an ADDED delta's
 * requirement name already exists in `content` — content is left unchanged,
 * making repeated ADDED merges idempotent. MODIFIED/RENAMED/REMOVED
 * re-application produces byte-identical output.
 */
function reconcileDelta(
  content: string,
  capability: string,
  delta: ParsedDelta,
): { content: string } | MergeConflict | 'noop' {
  switch (delta.operation) {
    case 'ADDED': {
      const { sections } = splitRequirements(content)
      if (sections.has(delta.requirement.name)) {
        return 'noop'
      }
      const appended = content + `\n\n## Requirement: ${delta.requirement.name}\n\n${delta.requirement.text}\n\n${
        delta.requirement.scenarios.map(s =>
          `### Scenario: ${s.name}\n${s.steps.map(step => `- ${step}`).join('\n')}`
        ).join('\n\n')
      }\n`
      return { content: appended }
    }
    case 'MODIFIED': {
      // Split on requirement header boundary so the preamble is preserved and
      // each section is keyed by its requirement name. This avoids regex
      // escaping pitfalls and prevents accidental duplication when the target
      // cannot be located.
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
      const newBody = renderRequirementBody(
        delta.requirement.name,
        delta.requirement.text,
        delta.requirement.scenarios,
      )
      sections.set(delta.requirement.name, newBody)
      return { content: joinRequirements(preamble, sections) }
    }
    case 'RENAMED': {
      // Extract old name, then re-key the map preserving order.
      const { preamble, sections } = splitRequirements(content)
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
      return { content: joinRequirements(preamble, rekeyed) }
    }
    case 'REMOVED': {
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
      return { content: joinRequirements(preamble, sections) }
    }
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
