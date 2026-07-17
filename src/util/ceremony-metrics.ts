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
 * Compute the ceremony-commit ratio across the entire repo history at
 * `projectRoot` via one `git log --format=%s` pass (no path filter).
 *
 * Always resolves; never throws. Returns `null` only when the `git log`
 * call itself fails (e.g. not a git repo, or a repo with no commits).
 * A successful run over zero subjects returns `{ ceremony: 0, total: 0,
 * ratio: 0 }` — never conflated with `null`.
 */
export async function getCeremonyCommitRatio(
  projectRoot: string,
): Promise<{ ceremony: number; total: number; ratio: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--format=%s'],
      { cwd: projectRoot },
    )
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
