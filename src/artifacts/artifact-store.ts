import { readdir, mkdir, rename as move, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'
import { toSlug } from '../util/slug.js'
import {
  ChangeMetadataSchema,
  type ChangeMetadata,
  type ArtifactStatus,
} from '../schemas/change-metadata.js'

const STOP_WORDS = new Set(['a', 'an', 'the', 'add', 'and', 'or', 'for', 'to', 'of', 'with', 'in', 'on', 'by', 'is', 'it', 'that', 'this', 'from', 'into', 'each', 'its', 'own', 'showing', 'using', 'without'])

/** A change discovered by the store, with its hosting worktree when not local. */
export interface DiscoveredChange {
  name: string
  /** Absolute path of the worktree checkout hosting the change; undefined for local changes. */
  worktree?: string
}

/** Result of change discovery across the local spec dir and worktree checkouts. */
export interface ChangeDiscovery {
  changes: DiscoveredChange[]
  /** Slug-collision warnings — a worktree copy shadowing a local copy is surfaced, never silently merged. */
  warnings: string[]
}

export interface ArtifactStoreOptions {
  /**
   * Absolute path of the directory holding per-change worktree checkouts
   * (`<projectRoot>/.metta/worktrees`). When set, change discovery and change
   * resolution by name also cover `<worktreesDir>/<name>/spec/changes/`, with
   * worktree copies winning slug collisions against local copies.
   */
  worktreesDir?: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export class ArtifactStore {
  private state: StateStore
  private readonly worktreesDir: string | undefined

  constructor(
    private readonly specDir: string,
    options?: ArtifactStoreOptions,
  ) {
    this.state = new StateStore(specDir)
    this.worktreesDir = options?.worktreesDir
  }

  /**
   * Derive the change name (slug) for a description — the same name
   * createChange will use. Exposed so callers can compute the name before
   * change state exists (e.g. to create the change's git worktree first).
   */
  deriveChangeName(description: string): string {
    return toSlug(description, { stopWords: STOP_WORDS })
  }

  async createChange(
    description: string,
    workflow: string,
    artifactIds: string[],
    baseVersions: Record<string, string> = {},
    autoAccept?: boolean,
    workflowLocked?: boolean,
    stopAfter?: string,
    worktree?: string,
  ): Promise<{ name: string; path: string }> {
    const name = this.deriveChangeName(description)
    const changePath = join('changes', name)

    if (
      (await this.state.exists(changePath)) ||
      (await this.findWorktreeHost(name)) !== undefined
    ) {
      throw new Error(`Change '${name}' already exists`)
    }

    const artifacts: Record<string, ArtifactStatus> = {}
    for (const id of artifactIds) {
      artifacts[id] = 'pending'
    }
    // First artifact is ready
    if (artifactIds.length > 0) {
      artifacts[artifactIds[0]] = 'ready'
    }

    const metadata: ChangeMetadata = {
      workflow,
      created: new Date().toISOString(),
      status: 'active',
      current_artifact: artifactIds[0] ?? '',
      base_versions: baseVersions,
      artifacts,
    }

    if (autoAccept === true) {
      metadata.auto_accept_recommendation = true
    }
    if (workflowLocked === true) {
      metadata.workflow_locked = true
    }
    if (stopAfter !== undefined) {
      metadata.stop_after = stopAfter
    }
    if (worktree !== undefined) {
      metadata.worktree = worktree
    }

    await this.state.write(
      join(changePath, '.metta.yaml'),
      ChangeMetadataSchema,
      metadata,
    )

    return { name, path: join(this.specDir, changePath) }
  }

  async getChange(name: string): Promise<ChangeMetadata> {
    const host = await this.findWorktreeHost(name)
    const state = host === undefined ? this.state : new StateStore(join(host, 'spec'))
    const metadata = await state.read(
      join('changes', name, '.metta.yaml'),
      ChangeMetadataSchema,
    )
    // Report the hosting worktree even when the stored metadata predates
    // worktree mode, so consumers (status --json and friends) can always
    // locate the checkout that owns the change.
    if (host !== undefined && metadata.worktree === undefined) {
      metadata.worktree = host
    }
    return metadata
  }

  async updateChange(name: string, updates: Partial<ChangeMetadata>): Promise<void> {
    const state = await this.stateFor(name)
    const current = await this.getChange(name)
    const merged = { ...current, ...updates }
    await state.write(
      join('changes', name, '.metta.yaml'),
      ChangeMetadataSchema,
      merged,
    )
  }

  /**
   * List active change names — local plus worktree-hosted. Slug-collision
   * warnings from discovery are surfaced on stderr so they never corrupt
   * JSON stdout output.
   */
  async listChanges(): Promise<string[]> {
    const { changes, warnings } = await this.discoverChanges()
    for (const warning of warnings) {
      process.stderr.write(`Warning: ${warning}\n`)
    }
    return changes.map((change) => change.name)
  }

  /**
   * Discover active changes in the local spec dir and (when a worktrees dir
   * is configured) in each `<worktreesDir>/<name>/spec/changes/` checkout. On a
   * slug collision the worktree copy wins and a warning is recorded.
   */
  async discoverChanges(): Promise<ChangeDiscovery> {
    const byName = new Map<string, DiscoveredChange>()
    for (const name of await this.listLocalChanges()) {
      byName.set(name, { name })
    }
    const warnings: string[] = []
    for (const { name, worktree } of await this.listWorktreeHostedChanges()) {
      if (byName.has(name)) {
        warnings.push(
          `change '${name}' exists in both the main checkout and worktree '${worktree}'; using the worktree copy`,
        )
      }
      byName.set(name, { name, worktree })
    }
    return { changes: [...byName.values()], warnings }
  }

  /** Active changes under the store's own `<specDir>/changes/`. */
  private async listLocalChanges(): Promise<string[]> {
    const changesDir = join(this.specDir, 'changes')
    try {
      const entries = await readdir(changesDir, { withFileTypes: true })
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
      // Only return directories that have a .metta.yaml (active changes)
      const active: string[] = []
      for (const dir of dirs) {
        if (await this.state.exists(join('changes', dir, '.metta.yaml'))) {
          active.push(dir)
        }
      }
      return active
    } catch {
      return []
    }
  }

  /** Active changes hosted in `<worktreesDir>/<name>/spec/changes/` checkouts. */
  private async listWorktreeHostedChanges(): Promise<Array<{ name: string; worktree: string }>> {
    const worktreesDir = this.worktreesDir
    if (worktreesDir === undefined) return []
    let hosts: string[]
    try {
      const entries = await readdir(worktreesDir, { withFileTypes: true })
      hosts = entries.filter((e) => e.isDirectory()).map((e) => join(worktreesDir, e.name))
    } catch {
      return []
    }
    const hosted: Array<{ name: string; worktree: string }> = []
    for (const host of hosts) {
      const changesDir = join(host, 'spec', 'changes')
      let names: string[]
      try {
        const entries = await readdir(changesDir, { withFileTypes: true })
        names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        continue
      }
      for (const name of names) {
        if (await pathExists(join(changesDir, name, '.metta.yaml'))) {
          hosted.push({ name, worktree: host })
        }
      }
    }
    return hosted
  }

  /**
   * Resolve the worktree checkout hosting `name`, when one exists. Worktree
   * copies win slug collisions, so a defined result shadows any local copy.
   */
  private async findWorktreeHost(name: string): Promise<string | undefined> {
    for (const hosted of await this.listWorktreeHostedChanges()) {
      if (hosted.name === name) return hosted.worktree
    }
    return undefined
  }

  /** State store rooted at the spec dir that actually hosts `name`. */
  private async stateFor(name: string): Promise<StateStore> {
    const host = await this.findWorktreeHost(name)
    return host === undefined ? this.state : new StateStore(join(host, 'spec'))
  }

  /** Spec dir that actually hosts `name` (worktree copy wins collisions). */
  private async specDirFor(name: string): Promise<string> {
    const host = await this.findWorktreeHost(name)
    return host === undefined ? this.specDir : join(host, 'spec')
  }

  async archive(name: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    const archiveName = `${date}-${name}`
    const baseDir = await this.specDirFor(name)
    const srcPath = join(baseDir, 'changes', name)
    const destPath = join(baseDir, 'archive', archiveName)

    await mkdir(join(baseDir, 'archive'), { recursive: true })
    await move(srcPath, destPath)

    return archiveName
  }

  async abandon(name: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    const archiveName = `${date}-${name}-abandoned`
    const baseDir = await this.specDirFor(name)
    const srcPath = join(baseDir, 'changes', name)
    const destPath = join(baseDir, 'archive', archiveName)

    // Update status before archiving
    await this.updateChange(name, { status: 'abandoned' })

    await mkdir(join(baseDir, 'archive'), { recursive: true })
    await move(srcPath, destPath)

    return archiveName
  }

  async writeArtifact(changeName: string, fileName: string, content: string): Promise<void> {
    const state = await this.stateFor(changeName)
    await state.writeRaw(join('changes', changeName, fileName), content)
  }

  async readArtifact(changeName: string, fileName: string): Promise<string> {
    const state = await this.stateFor(changeName)
    return state.readRaw(join('changes', changeName, fileName))
  }

  async artifactExists(changeName: string, fileName: string): Promise<boolean> {
    const state = await this.stateFor(changeName)
    return state.exists(join('changes', changeName, fileName))
  }

  async markArtifact(changeName: string, artifactId: string, status: ArtifactStatus): Promise<void> {
    const state = await this.stateFor(changeName)
    const metadata = await this.getChange(changeName)
    metadata.artifacts[artifactId] = status
    if (status === 'ready' || status === 'in_progress' || status === 'complete') {
      metadata.current_artifact = artifactId
    }
    await state.write(
      join('changes', changeName, '.metta.yaml'),
      ChangeMetadataSchema,
      metadata,
    )
  }

  getSpecDir(): string {
    return this.specDir
  }
}
