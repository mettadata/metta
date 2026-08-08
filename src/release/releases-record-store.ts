import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import YAML from 'yaml'
import { ReleasesRecordSchema, type ReleasesRecord } from '../schemas/releases-record.js'

const RELEASES_FILENAME = 'releases.yaml'

function releasesPath(specDir: string): string {
  return join(specDir, RELEASES_FILENAME)
}

/**
 * Load the releases record from `{specDir}/releases.yaml`.
 *
 * Returns `null` when the file does not exist. Invalid YAML or content that
 * fails `ReleasesRecordSchema` throws — callers decide how to degrade.
 */
export async function loadReleasesRecord(specDir: string): Promise<ReleasesRecord | null> {
  let content: string
  try {
    content = await readFile(releasesPath(specDir), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  const data = YAML.parse(content)
  return ReleasesRecordSchema.parse(data)
}

/**
 * Save the releases record to `{specDir}/releases.yaml`.
 *
 * The record is validated through `ReleasesRecordSchema` before serialization —
 * no unvalidated writes.
 */
export async function saveReleasesRecord(specDir: string, record: ReleasesRecord): Promise<void> {
  const validated = ReleasesRecordSchema.parse(record)
  const fullPath = releasesPath(specDir)
  await mkdir(dirname(fullPath), { recursive: true })
  const content = YAML.stringify(validated, { lineWidth: 0 })
  await writeFile(fullPath, content, 'utf-8')
}
