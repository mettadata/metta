import { mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyFrontmatterPatch } from '../issues/issue-frontmatter.js'
import type { IssueFrontmatterPatch } from '../schemas/issue-frontmatter.js'

/**
 * Legacy `spec/backlog/` → issue-store migration (imperative shell).
 *
 * One-shot, idempotent-by-derivation: idempotency is read off the filesystem,
 * never a marker file. A converted original no longer exists under
 * `spec/backlog/` (it was renamed to the archive location), so a second run
 * finds nothing to do — or only collision stragglers, which are re-reported
 * with zero writes.
 *
 * Invariants: never overwrite an existing file, never delete an original —
 * converted originals are fs-renamed intact to `spec/archive/backlog-legacy/`
 * (preserving the `done/` subpath) so every pre-migration byte stays
 * recoverable without git archaeology.
 */

export interface MigrationCollision {
  slug: string
  legacy_path: string
  existing_path: string
}

export interface MigrationResult {
  nothingToDo: boolean
  converted: { active: number; done: number }
  collisions: MigrationCollision[]
  /** Display path of the provenance archive: 'spec/archive/backlog-legacy'. */
  archivedTo: string
}

/** Display-path prefix for reporting (paths are project-relative, posix-style). */
const SPEC_DISPLAY = 'spec'
const ARCHIVED_TO = `${SPEC_DISPLAY}/archive/backlog-legacy`

type LegacyPriority = 'high' | 'medium' | 'low'

/**
 * Legacy `**Priority**` bold-label parser, copied verbatim in spirit from the
 * retired backlog-store's `parseItem` (private pure helper — the store is
 * deleted; do not import from it). Unparsable levels yield `undefined` so no
 * `priority` field is carried into frontmatter.
 */
function parseLegacyPriority(content: string): LegacyPriority | undefined {
  const lines = content.split('\n')
  const priorityLine = lines.find(l => l.startsWith('**Priority**:'))?.replace('**Priority**:', '').trim()
  return ['high', 'medium', 'low'].includes(priorityLine ?? '') ? (priorityLine as LegacyPriority) : undefined
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Markdown entries of a directory, sorted for deterministic processing; [] when absent. */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter(entry => entry.endsWith('.md')).sort()
  } catch {
    return []
  }
}

/** Remove a directory only when it exists and is empty (collision stragglers keep it). */
async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir)
    if (entries.length === 0) await rmdir(dir)
  } catch {
    // Absent — nothing to remove.
  }
}

interface CollisionCandidate {
  path: string
  displayPath: string
}

/** First existing candidate wins; `undefined` means the slug is clear to migrate. */
async function findCollision(
  slug: string,
  legacyDisplayPath: string,
  candidates: CollisionCandidate[],
): Promise<MigrationCollision | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate.path)) {
      return { slug, legacy_path: legacyDisplayPath, existing_path: candidate.displayPath }
    }
  }
  return undefined
}

interface MigrateItemPlan {
  file: string
  legacyPath: string
  /** Original file content, already read by the caller. */
  original: string
  targetDir: string
  targetDisplayPath: string
  archiveDir: string
  patch: IssueFrontmatterPatch
}

/** Convert one legacy item: write target (create-only), then rename the original to the archive. */
async function migrateItem(plan: MigrateItemPlan): Promise<void> {
  const converted = applyFrontmatterPatch(plan.original, plan.patch, plan.targetDisplayPath)
  await mkdir(plan.targetDir, { recursive: true })
  // 'wx' is belt-and-braces on top of the collision check: fail rather than overwrite.
  await writeFile(join(plan.targetDir, plan.file), converted, { encoding: 'utf8', flag: 'wx' })
  await mkdir(plan.archiveDir, { recursive: true })
  await rename(plan.legacyPath, join(plan.archiveDir, plan.file))
}

/**
 * Migrate every legacy backlog item into the issue store.
 *
 * - Active `spec/backlog/<slug>.md` → `spec/issues/<slug>.md` with frontmatter
 *   `type: idea`, `backlog: true`, plus `priority` when the legacy
 *   `**Priority**` line parses to high/medium/low.
 * - Done `spec/backlog/done/<slug>.md` → `spec/issues/resolved/<slug>.md` with
 *   frontmatter `type: idea` only.
 * - Original file content rides below the frontmatter byte-verbatim; originals
 *   are renamed to `spec/archive/backlog-legacy/{,done/}<slug>.md`.
 * - Collisions (target slug already in `spec/issues/`, `spec/issues/resolved/`,
 *   or the archive location) are recorded and skipped — both files untouched.
 * - `spec/backlog/done/` then `spec/backlog/` are removed only when emptied.
 */
export async function migrateLegacyBacklog(specDir: string): Promise<MigrationResult> {
  const backlogDir = join(specDir, 'backlog')
  const doneDir = join(backlogDir, 'done')
  const issuesDir = join(specDir, 'issues')
  const resolvedDir = join(issuesDir, 'resolved')
  const archiveDir = join(specDir, 'archive', 'backlog-legacy')
  const archiveDoneDir = join(archiveDir, 'done')

  const activeFiles = await listMarkdownFiles(backlogDir)
  const doneFiles = await listMarkdownFiles(doneDir)

  const result: MigrationResult = {
    nothingToDo: false,
    converted: { active: 0, done: 0 },
    collisions: [],
    archivedTo: ARCHIVED_TO,
  }

  if (activeFiles.length === 0 && doneFiles.length === 0) {
    return { ...result, nothingToDo: true }
  }

  for (const file of activeFiles) {
    const slug = file.slice(0, -'.md'.length)
    const legacyPath = join(backlogDir, file)
    const legacyDisplayPath = `${SPEC_DISPLAY}/backlog/${file}`
    const collision = await findCollision(slug, legacyDisplayPath, [
      { path: join(issuesDir, file), displayPath: `${SPEC_DISPLAY}/issues/${file}` },
      { path: join(resolvedDir, file), displayPath: `${SPEC_DISPLAY}/issues/resolved/${file}` },
      { path: join(archiveDir, file), displayPath: `${ARCHIVED_TO}/${file}` },
    ])
    if (collision) {
      result.collisions.push(collision)
      continue
    }
    const original = await readFile(legacyPath, 'utf8')
    await migrateItem({
      file,
      legacyPath,
      original,
      targetDir: issuesDir,
      targetDisplayPath: `${SPEC_DISPLAY}/issues/${file}`,
      archiveDir,
      patch: { type: 'idea', backlog: true, priority: parseLegacyPriority(original) },
    })
    result.converted.active += 1
  }

  for (const file of doneFiles) {
    const slug = file.slice(0, -'.md'.length)
    const legacyPath = join(doneDir, file)
    const legacyDisplayPath = `${SPEC_DISPLAY}/backlog/done/${file}`
    const collision = await findCollision(slug, legacyDisplayPath, [
      { path: join(issuesDir, file), displayPath: `${SPEC_DISPLAY}/issues/${file}` },
      { path: join(resolvedDir, file), displayPath: `${SPEC_DISPLAY}/issues/resolved/${file}` },
      { path: join(archiveDoneDir, file), displayPath: `${ARCHIVED_TO}/done/${file}` },
    ])
    if (collision) {
      result.collisions.push(collision)
      continue
    }
    await migrateItem({
      file,
      legacyPath,
      original: await readFile(legacyPath, 'utf8'),
      targetDir: resolvedDir,
      targetDisplayPath: `${SPEC_DISPLAY}/issues/resolved/${file}`,
      archiveDir: archiveDoneDir,
      patch: { type: 'idea' },
    })
    result.converted.done += 1
  }

  await removeDirIfEmpty(doneDir)
  await removeDirIfEmpty(backlogDir)

  return result
}
