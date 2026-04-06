import { readdir, mkdir, rename as move } from 'node:fs/promises'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'
import {
  ChangeMetadataSchema,
  type ChangeMetadata,
  type ArtifactStatus,
} from '../schemas/change-metadata.js'

const STOP_WORDS = new Set(['a', 'an', 'the', 'add', 'and', 'or', 'for', 'to', 'of', 'with', 'in', 'on', 'by', 'is', 'it', 'that', 'this', 'from', 'into', 'each', 'its', 'own', 'showing', 'using', 'without'])

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(w => w && !STOP_WORDS.has(w))
    .join('-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '')
}

export class ArtifactStore {
  private state: StateStore

  constructor(private readonly specDir: string) {
    this.state = new StateStore(specDir)
  }

  async createChange(
    description: string,
    workflow: string,
    artifactIds: string[],
    baseVersions: Record<string, string> = {},
  ): Promise<{ name: string; path: string }> {
    const name = slugify(description)
    const changePath = join('changes', name)

    if (await this.state.exists(changePath)) {
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

    await this.state.write(
      join(changePath, '.metta.yaml'),
      ChangeMetadataSchema,
      metadata,
    )

    return { name, path: join(this.specDir, changePath) }
  }

  async getChange(name: string): Promise<ChangeMetadata> {
    return this.state.read(
      join('changes', name, '.metta.yaml'),
      ChangeMetadataSchema,
    )
  }

  async updateChange(name: string, updates: Partial<ChangeMetadata>): Promise<void> {
    const current = await this.getChange(name)
    const merged = { ...current, ...updates }
    await this.state.write(
      join('changes', name, '.metta.yaml'),
      ChangeMetadataSchema,
      merged,
    )
  }

  async listChanges(): Promise<string[]> {
    const changesDir = join(this.specDir, 'changes')
    try {
      const entries = await readdir(changesDir, { withFileTypes: true })
      return entries.filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      return []
    }
  }

  async archive(name: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    const archiveName = `${date}-${name}`
    const srcPath = join(this.specDir, 'changes', name)
    const destPath = join(this.specDir, 'archive', archiveName)

    await mkdir(join(this.specDir, 'archive'), { recursive: true })
    await move(srcPath, destPath)

    return archiveName
  }

  async abandon(name: string): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    const archiveName = `${date}-${name}-abandoned`
    const srcPath = join(this.specDir, 'changes', name)
    const destPath = join(this.specDir, 'archive', archiveName)

    // Update status before archiving
    await this.updateChange(name, { status: 'abandoned' })

    await mkdir(join(this.specDir, 'archive'), { recursive: true })
    await move(srcPath, destPath)

    return archiveName
  }

  async writeArtifact(changeName: string, fileName: string, content: string): Promise<void> {
    await this.state.writeRaw(join('changes', changeName, fileName), content)
  }

  async readArtifact(changeName: string, fileName: string): Promise<string> {
    return this.state.readRaw(join('changes', changeName, fileName))
  }

  async artifactExists(changeName: string, fileName: string): Promise<boolean> {
    return this.state.exists(join('changes', changeName, fileName))
  }

  async markArtifact(changeName: string, artifactId: string, status: ArtifactStatus): Promise<void> {
    const metadata = await this.getChange(changeName)
    metadata.artifacts[artifactId] = status
    if (status === 'in_progress' || status === 'complete') {
      metadata.current_artifact = artifactId
    }
    await this.state.write(
      join('changes', changeName, '.metta.yaml'),
      ChangeMetadataSchema,
      metadata,
    )
  }

  getSpecDir(): string {
    return this.specDir
  }
}
