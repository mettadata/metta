import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { ProjectConfig, ReleaseConfig } from '../schemas/project-config.js'
import type { BumpLevel, ReleaseEntry, ReleasesRecord } from '../schemas/releases-record.js'
import { bumpVersion } from './semver.js'
import { deriveBump, type CommitInput } from './bump-derivation.js'
import { readProductVersion, writeProductVersion } from './version-file.js'
import { loadReleasesRecord, saveReleasesRecord } from './releases-record-store.js'
import {
  listReleaseTags,
  tagExists,
  collectCommitsSince,
  attributeArchiveDirsToTags,
} from './git-release-tags.js'
import { createGithubRelease, type GhExec, type GhOutcome } from './gh-release.js'
import { DocGenerator, type DocType } from '../docs/doc-generator.js'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Root of the release error hierarchy. */
export class ReleaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseError'
  }
}

/** Thrown when the project config has no `release:` block. */
export class ReleaseConfigMissingError extends ReleaseError {
  constructor() {
    super(
      'Release configuration is missing. Add a release: block to .metta/config.yaml ' +
        "with the required keys release.scheme (only 'semver' is supported) and " +
        'release.version_file (path to the file holding the product version).',
    )
    this.name = 'ReleaseConfigMissingError'
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReleaseStep {
  step: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
}

export interface ReleaseStatusResult {
  version: string
  lastTag: string | null
  commitCount: number | null
  recommendedBump: BumpLevel | null
  unreleasedChanges: number
  warnings: string[]
}

/**
 * Minimal contract for the changelog regeneration collaborator used inside
 * the mutation group of `cut()`. Satisfied by `DocGenerator`.
 */
export interface ChangelogGenerator {
  generate(types?: DocType[]): Promise<unknown>
}

export interface ReleaseCutOptions {
  bumpOverride?: BumpLevel
  /** CLI wires askYesNo or `--yes`; tests inject. */
  confirmVersion: (
    target: string,
    recommended: BumpLevel,
    source: 'derived' | 'override',
  ) => Promise<boolean>
  /** Explicit per-cut confirmation for GitHub publication. */
  github: boolean
  dryRun: boolean
  /** Injection seam for the gh subprocess (tests); production uses the default. */
  ghExec?: GhExec
  /** Injection seam for the changelog generator (tests); production uses the real DocGenerator. */
  docGenerator?: ChangelogGenerator
}

export interface ReleaseCutResult {
  status: 'success' | 'failure' | 'aborted'
  steps: ReleaseStep[]
  version?: string
  tag?: string
  /** Present only when github publication was attempted. */
  gh?: GhOutcome
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

const STRICT_SEMVER = /^\d+\.\d+\.\d+$/

const MUTATION_STEPS = [
  'backfill-record',
  'write-version-file',
  'write-releases-record',
  'regen-changelog',
  'commit',
  'annotated-tag',
  'gh',
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Release pipeline (imperative shell): `status()` is read-only; `cut()`
 * performs the release with ordered step records in the `MergeSafetyPipeline`
 * style — every step is recorded, the first failure aborts, and zero
 * mutations happen before all abort points (spec: Release Cut Safety
 * Constraints).
 */
export class ReleasePipeline {
  constructor(
    private projectRoot: string,
    private config: ProjectConfig,
  ) {}

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private get specDir(): string {
    return join(this.projectRoot, 'spec')
  }

  private requireReleaseConfig(): ReleaseConfig {
    const release = this.config.release
    if (release === undefined) {
      throw new ReleaseConfigMissingError()
    }
    return release
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.projectRoot })
    return stdout.trim()
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      return (await this.git(['rev-parse', '--is-inside-work-tree'])) === 'true'
    } catch {
      return false
    }
  }

  private async listArchiveDirs(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.specDir, 'archive'), { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
    } catch {
      return []
    }
  }

  private async readFileOrNull(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // status
  // -----------------------------------------------------------------------

  async status(): Promise<ReleaseStatusResult> {
    const release = this.requireReleaseConfig()
    const warnings: string[] = []

    const version = await readProductVersion(this.projectRoot, release)

    let lastTag: string | null = null
    let commitCount: number | null = null
    let recommendedBump: BumpLevel | null = null

    if (this.config.git?.enabled === false) {
      warnings.push(
        'git is disabled (git.enabled: false) — last tag, commit count, and recommended bump are unavailable',
      )
    } else if (!(await this.isGitRepo())) {
      warnings.push(
        'not a git repository — last tag, commit count, and recommended bump are unavailable',
      )
    } else {
      const tags = await listReleaseTags(this.projectRoot, release.tag_prefix)
      lastTag = tags[0] ?? null
      const commits = await collectCommitsSince(this.projectRoot, lastTag ?? undefined)
      commitCount = commits.length
      recommendedBump = deriveBump(commits)
    }

    let record: ReleasesRecord | null = null
    try {
      record = await loadReleasesRecord(this.specDir)
    } catch {
      warnings.push('spec/releases.yaml is invalid — treating all archived changes as unreleased')
    }
    const claimed = new Set<string>(record?.releases.flatMap(r => r.changes) ?? [])
    const archiveDirs = await this.listArchiveDirs()
    const unreleasedChanges = archiveDirs.filter(d => !claimed.has(d)).length

    return { version, lastTag, commitCount, recommendedBump, unreleasedChanges, warnings }
  }

  // -----------------------------------------------------------------------
  // cut
  // -----------------------------------------------------------------------

  async cut(opts: ReleaseCutOptions): Promise<ReleaseCutResult> {
    const steps: ReleaseStep[] = []

    // Step: config-check — before any read or write.
    const release = this.requireReleaseConfig()
    steps.push({ step: 'config-check', status: 'pass' })

    // Step: git-check — repo usable; warns (does not block) on metta/* branch
    // and shallow clones.
    if (this.config.git?.enabled === false) {
      steps.push({ step: 'git-check', status: 'fail', detail: 'git is disabled (git.enabled: false)' })
      return { status: 'failure', steps }
    }
    if (!(await this.isGitRepo())) {
      steps.push({ step: 'git-check', status: 'fail', detail: 'not a git repository' })
      return { status: 'failure', steps }
    }
    let branch: string
    try {
      branch = await this.git(['symbolic-ref', '--short', 'HEAD'])
    } catch {
      steps.push({ step: 'git-check', status: 'fail', detail: 'detached HEAD — check out a branch first' })
      return { status: 'failure', steps }
    }
    const gitWarnings: string[] = []
    if (branch.startsWith('metta/')) {
      gitWarnings.push(`on ${branch} — releases are normally cut on the mainline`)
    }
    try {
      if ((await this.git(['rev-parse', '--is-shallow-repository'])) === 'true') {
        gitWarnings.push('shallow clone — commit collection and backfill may be incomplete')
      }
    } catch {
      // older git without --is-shallow-repository — treat as not shallow
    }
    steps.push({
      step: 'git-check',
      status: 'pass',
      detail: gitWarnings.length > 0 ? `on ${branch}; warnings: ${gitWarnings.join('; ')}` : `on ${branch}`,
    })

    // Step: clean-tree
    try {
      const status = await this.git(['status', '--porcelain', '--untracked-files=no'])
      if (status.length > 0) {
        steps.push({
          step: 'clean-tree',
          status: 'fail',
          detail: 'working tree has uncommitted changes to tracked files',
        })
        return { status: 'failure', steps }
      }
      steps.push({ step: 'clean-tree', status: 'pass' })
    } catch (error) {
      steps.push({ step: 'clean-tree', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: last-tag — absence of a prior tag is not an error.
    let tags: string[]
    try {
      tags = await listReleaseTags(this.projectRoot, release.tag_prefix)
    } catch (error) {
      steps.push({ step: 'last-tag', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }
    const lastTag: string | null = tags[0] ?? null
    steps.push({ step: 'last-tag', status: 'pass', detail: lastTag ?? 'none' })

    // Step: collect-commits
    let commits: CommitInput[]
    try {
      commits = await collectCommitsSince(this.projectRoot, lastTag ?? undefined)
      steps.push({ step: 'collect-commits', status: 'pass', detail: `${commits.length} commit(s)` })
    } catch (error) {
      steps.push({ step: 'collect-commits', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: derive-bump — read current product version, derive the
    // recommendation, apply any override, compute the target version.
    const recommended = deriveBump(commits)
    const level: BumpLevel = opts.bumpOverride ?? recommended
    const source: 'derived' | 'override' = opts.bumpOverride !== undefined ? 'override' : 'derived'
    let currentVersion: string
    let target: string
    try {
      currentVersion = await readProductVersion(this.projectRoot, release)
      target = bumpVersion(currentVersion, level)
    } catch (error) {
      steps.push({ step: 'derive-bump', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }
    steps.push({
      step: 'derive-bump',
      status: 'pass',
      detail: `${currentVersion} → ${target} (${level}, ${source}; recommended: ${recommended})`,
    })

    // Step: confirm — decline aborts with nothing written.
    const confirmed = await opts.confirmVersion(target, recommended, source)
    if (!confirmed) {
      steps.push({ step: 'confirm', status: 'fail', detail: 'user declined the target version' })
      return { status: 'aborted', steps }
    }
    steps.push({ step: 'confirm', status: 'pass', detail: `${currentVersion} → ${target}` })

    // Step: target-tag-absent — before any write; never -f, never delete.
    const tag = `${release.tag_prefix}${target}`
    try {
      if (await tagExists(this.projectRoot, tag)) {
        steps.push({
          step: 'target-tag-absent',
          status: 'fail',
          detail:
            `tag ${tag} already exists — refusing to overwrite or delete it. ` +
            'Pick a different bump level or remove the conflicting tag manually first.',
        })
        return { status: 'failure', steps }
      }
      steps.push({ step: 'target-tag-absent', status: 'pass', detail: tag })
    } catch (error) {
      steps.push({ step: 'target-tag-absent', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    if (opts.dryRun) {
      for (const step of MUTATION_STEPS) {
        steps.push({ step, status: 'skip', detail: 'dry-run' })
      }
      return { status: 'success', steps, version: target, tag }
    }

    // Step: backfill-record — first cut with pre-existing tags only; in memory.
    let record: ReleasesRecord
    try {
      const existing = await loadReleasesRecord(this.specDir)
      if (existing !== null) {
        record = existing
        steps.push({ step: 'backfill-record', status: 'skip', detail: 'record already exists' })
      } else if (tags.length === 0) {
        record = { releases: [] }
        steps.push({ step: 'backfill-record', status: 'skip', detail: 'no pre-existing tags' })
      } else {
        const oldestFirst = [...tags].reverse()
        const archiveDirs = await this.listArchiveDirs()
        const attribution = await attributeArchiveDirsToTags(this.projectRoot, oldestFirst, archiveDirs)
        const backfilled: ReleaseEntry[] = []
        // Record order is newest first.
        for (const historicalTag of tags) {
          const version = historicalTag.slice(release.tag_prefix.length)
          if (!STRICT_SEMVER.test(version)) continue
          const date = await this.git(['log', '-1', '--format=%cs', `refs/tags/${historicalTag}`])
          backfilled.push({
            version,
            tag: historicalTag,
            date,
            backfilled: true,
            changes: attribution.get(historicalTag) ?? [],
          })
        }
        record = { releases: backfilled }
        steps.push({
          step: 'backfill-record',
          status: 'pass',
          detail: `${backfilled.length} historical tag(s) backfilled`,
        })
      }
    } catch (error) {
      steps.push({ step: 'backfill-record', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // -------------------------------------------------------------------
    // Mutation group: version file, releases record, changelog. Nothing is
    // staged until `commit`, so on failure a best-effort restore of the
    // previously-read file contents suffices; the failing step is named.
    // -------------------------------------------------------------------

    const versionFilePath = resolve(this.projectRoot, release.version_file)
    const releasesRecordPath = join(this.specDir, 'releases.yaml')
    const changelogPath = join(this.projectRoot, this.config.docs.output, 'changelog.md')

    const originals = new Map<string, string | null>()
    originals.set(versionFilePath, await this.readFileOrNull(versionFilePath))
    originals.set(releasesRecordPath, await this.readFileOrNull(releasesRecordPath))
    originals.set(changelogPath, await this.readFileOrNull(changelogPath))

    const restoreFiles = async (): Promise<void> => {
      for (const [path, content] of originals) {
        // Best-effort: a failed restore never masks the reported step failure.
        if (content === null) {
          await rm(path, { force: true }).catch(() => {})
        } else {
          await writeFile(path, content, 'utf-8').catch(() => {})
        }
      }
    }

    // Step: write-version-file
    try {
      await writeProductVersion(this.projectRoot, release, target)
      steps.push({ step: 'write-version-file', status: 'pass', detail: release.version_file })
    } catch (error) {
      await restoreFiles()
      steps.push({ step: 'write-version-file', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: write-releases-record — new entry prepended (newest first).
    try {
      const claimed = new Set<string>(record.releases.flatMap(r => r.changes))
      const archiveDirs = await this.listArchiveDirs()
      const changes = archiveDirs.filter(d => !claimed.has(d))
      const entry: ReleaseEntry = {
        version: target,
        tag,
        date: new Date().toISOString().slice(0, 10),
        bump: level,
        bump_source: source,
        backfilled: false,
        changes,
      }
      await saveReleasesRecord(this.specDir, { releases: [entry, ...record.releases] })
      steps.push({ step: 'write-releases-record', status: 'pass', detail: `${changes.length} change(s) attributed` })
    } catch (error) {
      await restoreFiles()
      steps.push({ step: 'write-releases-record', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: regen-changelog
    try {
      const generator =
        opts.docGenerator ?? new DocGenerator(this.specDir, this.projectRoot, this.config.docs)
      await generator.generate(['changelog'])
      steps.push({ step: 'regen-changelog', status: 'pass', detail: relative(this.projectRoot, changelogPath) })
    } catch (error) {
      await restoreFiles()
      steps.push({ step: 'regen-changelog', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: commit
    const commitFiles = [
      relative(this.projectRoot, versionFilePath),
      relative(this.projectRoot, releasesRecordPath),
      relative(this.projectRoot, changelogPath),
    ]
    try {
      await this.git(['add', '--', ...commitFiles])
      await this.git(['commit', '-m', `chore(release): ${target}`])
      steps.push({ step: 'commit', status: 'pass', detail: `chore(release): ${target}` })
    } catch (error) {
      // Unstage anything `add` staged, then restore file contents.
      await this.git(['reset', '-q', '--', ...commitFiles]).catch(() => {})
      await restoreFiles()
      steps.push({ step: 'commit', status: 'fail', detail: errorMessage(error) })
      return { status: 'failure', steps }
    }

    // Step: annotated-tag — a failure here leaves a valid release commit
    // without a tag; report the single manual command, no automatic rollback.
    try {
      await this.git(['tag', '-a', tag, '-m', `Release ${target}`])
      steps.push({ step: 'annotated-tag', status: 'pass', detail: tag })
    } catch (error) {
      steps.push({
        step: 'annotated-tag',
        status: 'fail',
        detail:
          `the release commit for ${target} was created but the annotated tag was not ` +
          `(${errorMessage(error)}). Complete the release manually with: ` +
          `git tag -a ${tag} -m "Release ${target}"`,
      })
      return { status: 'failure', steps, version: target }
    }

    // Step: gh — optional, isolated; its outcome never changes local success.
    let gh: GhOutcome | undefined
    if (release.github_release === true && opts.github === true) {
      const notes = await this.extractChangelogSection(changelogPath, target)
      gh = await createGithubRelease(this.projectRoot, tag, tag, notes, opts.ghExec)
      steps.push({
        step: 'gh',
        status: gh.status === 'created' ? 'pass' : 'fail',
        detail: gh.status === 'created' ? `GitHub release created for ${tag}` : gh.status,
      })
    } else {
      steps.push({
        step: 'gh',
        status: 'skip',
        detail:
          release.github_release !== true
            ? 'release.github_release is disabled in config'
            : 'GitHub publication not requested for this cut',
      })
    }

    const result: ReleaseCutResult = { status: 'success', steps, version: target, tag }
    if (gh !== undefined) result.gh = gh
    return result
  }

  /**
   * Extract the `## {version} — {date}` section from the regenerated
   * changelog for use as GitHub release notes. Falls back to a minimal note
   * when the section cannot be located.
   */
  private async extractChangelogSection(changelogPath: string, version: string): Promise<string> {
    const content = await this.readFileOrNull(changelogPath)
    if (content === null) return `Release ${version}`
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^## ${escaped} — .*$`, 'm')
    const match = pattern.exec(content)
    if (match === null || match.index === undefined) return `Release ${version}`
    const start = match.index + match[0].length
    const rest = content.slice(start)
    const next = /^## /m.exec(rest)
    const body = (next ? rest.slice(0, next.index) : rest).trim()
    return body.length > 0 ? body : `Release ${version}`
  }
}
