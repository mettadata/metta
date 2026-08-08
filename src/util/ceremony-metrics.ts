import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { StateStore } from '../state/state-store.js'
import { ChangeMetadataSchema } from '../schemas/change-metadata.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'

const execFileAsync = promisify(execFile)

/**
 * Classification rule (see design "Risks & Mitigations" (b)): a commit is
 * ceremony iff its subject matches `^(chore|docs)(\(.+\))?:` — a lowercase
 * conventional-commit type with an optional scope. Merge commits
 * (`Merge ...` subjects) and any subject without a recognized type prefix
 * count toward `total` only, never toward the `ceremony` numerator — they
 * land in "functional/other". Do NOT treat merges as ceremony.
 */
const CEREMONY_SUBJECT = /^(chore|docs)(\(.+\))?:/

/**
 * Compute the ceremony-commit ratio at `projectRoot` via one
 * `git log --format=%s` pass (no path filter).
 *
 * When `sinceRef` is omitted, the pass covers the entire repo history
 * (`git log --format=%s`). When provided, it is windowed to
 * `git log <sinceRef>..HEAD --format=%s` — every commit reachable from
 * `HEAD` but not from `sinceRef`.
 *
 * Always resolves; never throws. Returns `null` only when the `git log`
 * call itself fails (e.g. not a git repo, a repo with no commits, or —
 * for a windowed call — a `sinceRef` that does not resolve). A
 * successful run over zero subjects (including a legitimately empty
 * window, such as a ref that already points at `HEAD`) returns
 * `{ ceremony: 0, total: 0, ratio: 0 }` — never conflated with `null`.
 */
export async function getCeremonyCommitRatio(
  projectRoot: string,
  sinceRef?: string,
): Promise<{ ceremony: number; total: number; ratio: number } | null> {
  try {
    const range = sinceRef ? `${sinceRef}..HEAD` : undefined
    const args = range ? ['log', range, '--format=%s'] : ['log', '--format=%s']
    const { stdout } = await execFileAsync('git', args, { cwd: projectRoot })
    const subjects = stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    const ceremony = subjects.filter(s => CEREMONY_SUBJECT.test(s)).length
    const total = subjects.length
    const ratio = total === 0 ? 0 : ceremony / total
    return { ceremony, total, ratio }
  } catch {
    return null
  }
}

/**
 * Resolve the most recent version tag reachable from `HEAD` at
 * `projectRoot` via `git describe --tags --abbrev=0`, for use as the
 * default ceremony-ratio window ref.
 *
 * Always resolves; never throws. Returns `null` when the repo has no
 * tags (or git is otherwise unavailable) — the caller's no-window case,
 * not an error.
 */
export async function getLatestTag(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['describe', '--tags', '--abbrev=0'],
      { cwd: projectRoot },
    )
    const tag = stdout.trim()
    return tag.length > 0 ? tag : null
  } catch {
    return null
  }
}

/**
 * Average artifact count across archived small changes (`workflow` of
 * `'quick'` or `'trivial'`) under `${specDir}/archive/<entry>/.metta.yaml`.
 * Each metadata file is parsed through the same Zod-validated
 * `ChangeMetadataSchema` read path `ArtifactStore` uses; entries that are
 * missing a `.metta.yaml` or fail schema validation are skipped rather
 * than throwing.
 *
 * Always resolves; never throws. Returns `null` (not `0`) when the
 * filtered set is empty — including when the archive directory is absent.
 */
export async function getArtifactsPerSmallChange(
  specDir: string,
): Promise<{ mean: number; sample_size: number } | null> {
  let entries
  try {
    entries = await readdir(join(specDir, 'archive'), { withFileTypes: true })
  } catch {
    return null
  }

  const state = new StateStore(specDir)
  const counts: number[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const metadata = await state.read(
        join('archive', entry.name, '.metta.yaml'),
        ChangeMetadataSchema,
      )
      if (metadata.workflow === 'quick' || metadata.workflow === 'trivial') {
        counts.push(Object.keys(metadata.artifacts).length)
      }
    } catch {
      // Skip archive entries with a missing or schema-invalid .metta.yaml.
    }
  }

  if (counts.length === 0) return null
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  return { mean, sample_size: counts.length }
}

/**
 * Model-escalation rate across all active and archived changes.
 *
 * Denominator (`total`): sum of `model_runs.length` — every recorded
 * non-inherit executor resolution (stamped by `metta instructions` itself).
 * Numerator (`escalated`): sum of `model_escalations.length` — Rung-1
 * escalations recorded via `metta model-escalation record`.
 *
 * This metric only measures STOP/verify-FAIL-driven escalations; it makes
 * no claim about cheap-executor output that produced neither a STOP report
 * nor a verify FAIL.
 *
 * Always resolves; never throws. Returns `null` when `total === 0` (no
 * cheap-tier invocations recorded at all — the explicit no-data case).
 * `rate: 0` is a valid, distinct result when `escalated === 0` but
 * `total > 0`. Archive entries with a missing or schema-invalid
 * `.metta.yaml` are skipped rather than throwing.
 */
export async function getModelEscalationRate(
  specDir: string,
  artifactStore: ArtifactStore,
): Promise<{ escalated: number; total: number; rate: number } | null> {
  let escalated = 0
  let total = 0

  // Active changes.
  let changeNames: string[] = []
  try {
    changeNames = await artifactStore.listChanges()
  } catch {
    // No active-changes directory — treat as zero active changes.
  }
  for (const name of changeNames) {
    try {
      const metadata = await artifactStore.getChange(name)
      total += metadata.model_runs?.length ?? 0
      escalated += metadata.model_escalations?.length ?? 0
    } catch {
      // Skip changes with a missing or schema-invalid .metta.yaml.
    }
  }

  // Archived changes.
  let entries: Dirent[]
  try {
    entries = await readdir(join(specDir, 'archive'), { withFileTypes: true })
  } catch {
    entries = []
  }
  const state = new StateStore(specDir)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const metadata = await state.read(
        join('archive', entry.name, '.metta.yaml'),
        ChangeMetadataSchema,
      )
      total += metadata.model_runs?.length ?? 0
      escalated += metadata.model_escalations?.length ?? 0
    } catch {
      // Skip archive entries with a missing or schema-invalid .metta.yaml.
    }
  }

  if (total === 0) return null
  return { escalated, total, rate: escalated / total }
}

/** The fixed workflow tiers the token-usage metric groups by. */
export type WorkflowTier = 'trivial' | 'quick' | 'standard' | 'full'

const WORKFLOW_TIERS: readonly WorkflowTier[] = ['trivial', 'quick', 'standard', 'full']

function isWorkflowTier(workflow: string): workflow is WorkflowTier {
  return (WORKFLOW_TIERS as readonly string[]).includes(workflow)
}

/**
 * Average reported token consumption per change, grouped by workflow tier,
 * across all active and archived changes.
 *
 * Per-change total = sum of `token_usage[].tokens`. Reporting is opt-in and
 * best-effort, so changes with an absent `token_usage` field AND changes with
 * a present-but-empty array are excluded from the sample entirely — they are
 * never counted as `0`, which would drag the mean toward zero.
 *
 * Always resolves; never throws. The returned record always carries all four
 * tier keys; a tier with no sampled changes maps to `null` (the explicit
 * no-data case). Changes whose `workflow` is outside the four fixed tiers are
 * ignored. Archive entries with a missing or schema-invalid `.metta.yaml`
 * are skipped rather than throwing.
 */
export async function getAvgTokensPerChangeByTier(
  specDir: string,
  artifactStore: ArtifactStore,
): Promise<Record<WorkflowTier, { mean: number; sample_size: number } | null>> {
  const totalsByTier: Record<WorkflowTier, number[]> = {
    trivial: [],
    quick: [],
    standard: [],
    full: [],
  }

  const collect = (metadata: { workflow: string; token_usage?: { tokens: number }[] }): void => {
    if (!isWorkflowTier(metadata.workflow)) return
    const usage = metadata.token_usage
    if (!usage || usage.length === 0) return
    totalsByTier[metadata.workflow].push(usage.reduce((sum, record) => sum + record.tokens, 0))
  }

  // Active changes.
  let changeNames: string[] = []
  try {
    changeNames = await artifactStore.listChanges()
  } catch {
    // No active-changes directory — treat as zero active changes.
  }
  for (const name of changeNames) {
    try {
      collect(await artifactStore.getChange(name))
    } catch {
      // Skip changes with a missing or schema-invalid .metta.yaml.
    }
  }

  // Archived changes.
  let entries: Dirent[]
  try {
    entries = await readdir(join(specDir, 'archive'), { withFileTypes: true })
  } catch {
    entries = []
  }
  const state = new StateStore(specDir)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      collect(await state.read(join('archive', entry.name, '.metta.yaml'), ChangeMetadataSchema))
    } catch {
      // Skip archive entries with a missing or schema-invalid .metta.yaml.
    }
  }

  const result = {} as Record<WorkflowTier, { mean: number; sample_size: number } | null>
  for (const tier of WORKFLOW_TIERS) {
    const totals = totalsByTier[tier]
    result[tier] = totals.length === 0
      ? null
      : { mean: totals.reduce((a, b) => a + b, 0) / totals.length, sample_size: totals.length }
  }
  return result
}
