import { mkdir, readdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import { applyFrontmatterPatch, splitFrontmatter } from '../issues/issue-frontmatter.js'
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
 *
 * Legacy items come in two formats: the retired `BacklogStore` bold-label
 * format (`# Title` + `**Added**`/`**Priority**` lines, no frontmatter) and an
 * older YAML-frontmatter format (`slug`/`title`/`priority`/`added` keys —
 * present in real repo data, e.g. metta's own `spec/backlog/done/`). Those
 * legacy keys are invalid under the strict issue frontmatter schema, so the
 * legacy block is replaced wholesale by the minted issue block; the body below
 * the legacy fence is carried byte-verbatim and the archived original keeps
 * every pre-migration byte, including the replaced block.
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
  /**
   * Project-relative posix display paths of every file created, rewritten, or
   * removed by this run — empty when `nothingToDo` or every item collided.
   * Suitable as git pathspecs with cwd = projectRoot.
   */
  changedPaths: string[]
}

/** Display-path prefix for reporting (paths are project-relative, posix-style). */
const SPEC_DISPLAY = 'spec'
const ARCHIVED_TO = `${SPEC_DISPLAY}/archive/backlog-legacy`

type LegacyPriority = 'high' | 'medium' | 'low'

/**
 * Legacy `**Priority**` bold-label parser, copied verbatim in spirit from the
 * retired `BacklogStore.parseItem` (private pure helper — the store is
 * deleted; do not import from it). Unparsable levels yield `undefined` so no
 * `priority` field is carried into frontmatter.
 */
function parseLegacyPriority(content: string): LegacyPriority | undefined {
  const lines = content.split('\n')
  const priorityLine = lines.find(l => l.startsWith('**Priority**:'))?.replace('**Priority**:', '').trim()
  return ['high', 'medium', 'low'].includes(priorityLine ?? '') ? (priorityLine as LegacyPriority) : undefined
}

interface LegacyItemSplit {
  /** Content below the legacy frontmatter fence — the whole file when there is none. */
  body: string
  /** `priority` carried out of a legacy YAML frontmatter block, when it parses. */
  frontmatterPriority: LegacyPriority | undefined
}

/**
 * Split a legacy item into its byte-verbatim body and any salvageable
 * `priority` from an old-format YAML frontmatter block. The legacy block's
 * other keys (`slug`, `title`, `added`) are redundant with the filename or
 * preserved only in the archived original — they are not carried forward.
 * Throws (via `splitFrontmatter`) on an opening fence with no closing fence.
 */
function splitLegacyItem(original: string): LegacyItemSplit {
  const { rawFrontmatter, body } = splitFrontmatter(original)
  if (rawFrontmatter === undefined) {
    return { body: original, frontmatterPriority: undefined }
  }
  let priority: unknown
  try {
    const data: unknown = YAML.parse(rawFrontmatter)
    priority =
      data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).priority
        : undefined
  } catch {
    priority = undefined
  }
  return {
    body,
    frontmatterPriority:
      typeof priority === 'string' && ['high', 'medium', 'low'].includes(priority)
        ? (priority as LegacyPriority)
        : undefined,
  }
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
  /** Body carried below the minted frontmatter — the legacy content, byte-verbatim. */
  body: string
  targetDir: string
  targetDisplayPath: string
  archiveDir: string
  patch: IssueFrontmatterPatch
}

/** Convert one legacy item: write target (create-only), then rename the original to the archive. */
async function migrateItem(plan: MigrateItemPlan): Promise<void> {
  const converted = applyFrontmatterPatch(plan.body, plan.patch, plan.targetDisplayPath)
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
 * - Legacy content rides below the minted frontmatter byte-verbatim (for
 *   old-format YAML-frontmatter items, the body below their legacy fence —
 *   the invalid legacy block is replaced, carrying `priority` when it parses);
 *   originals are renamed to `spec/archive/backlog-legacy/{,done/}<slug>.md`.
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
    changedPaths: [],
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
    const { body, frontmatterPriority } = splitLegacyItem(original)
    const targetDisplayPath = `${SPEC_DISPLAY}/issues/${file}`
    await migrateItem({
      file,
      legacyPath,
      body,
      targetDir: issuesDir,
      targetDisplayPath,
      archiveDir,
      patch: { type: 'idea', backlog: true, priority: frontmatterPriority ?? parseLegacyPriority(body) },
    })
    result.converted.active += 1
    result.changedPaths.push(targetDisplayPath, legacyDisplayPath, `${ARCHIVED_TO}/${file}`)
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
    const targetDisplayPath = `${SPEC_DISPLAY}/issues/resolved/${file}`
    await migrateItem({
      file,
      legacyPath,
      body: splitLegacyItem(await readFile(legacyPath, 'utf8')).body,
      targetDir: resolvedDir,
      targetDisplayPath,
      archiveDir: archiveDoneDir,
      patch: { type: 'idea' },
    })
    result.converted.done += 1
    result.changedPaths.push(targetDisplayPath, legacyDisplayPath, `${ARCHIVED_TO}/done/${file}`)
  }

  await removeDirIfEmpty(doneDir)
  await removeDirIfEmpty(backlogDir)

  return result
}
