import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { StateStore } from '../state/state-store.js'
import {
  MainTreeBaselineSchema,
  type MainTreeBaseline,
  type TreeEntry,
} from '../schemas/tree-baseline.js'

const execAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Functional core (pure, no I/O)
// ---------------------------------------------------------------------------

/**
 * Parse the stdout of `git status --porcelain=v1 -z --untracked-files=no`.
 *
 * NUL-delimited records: `XY <path>\0`, where rename/copy records (X of
 * `R`/`C`) are followed by a second NUL-terminated field carrying the
 * original path. NUL delimiting keeps paths with spaces intact. Malformed
 * tokens (shorter than the `XY <path>` minimum) are skipped defensively.
 */
export function parsePorcelain(raw: string): TreeEntry[] {
  const entries: TreeEntry[] = []
  const tokens = raw.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4 || token[2] !== ' ') {
      continue
    }
    const status = token.slice(0, 2)
    const path = token.slice(3)
    const entry: TreeEntry = { path, status }
    // Rename/copy records carry the original path as the NEXT NUL field.
    if (status[0] === 'R' || status[0] === 'C') {
      const from = tokens[i + 1]
      if (from !== undefined && from.length > 0) {
        entry.renamed_from = from
        i++
      }
    }
    entries.push(entry)
  }
  return entries
}

/**
 * Attribute current dirt against a baseline snapshot.
 *
 * A current entry is *new dirt* when its path is absent from the baseline
 * OR its XY status differs from the baseline's (a path that "became dirty
 * or changed state"); otherwise it is *pre-existing*.
 */
export function diffTreeState(
  baseline: TreeEntry[],
  current: TreeEntry[],
): { newDirt: TreeEntry[]; preExisting: TreeEntry[] } {
  const baselineStatus = new Map<string, string>()
  for (const entry of baseline) {
    baselineStatus.set(entry.path, entry.status)
  }
  const newDirt: TreeEntry[] = []
  const preExisting: TreeEntry[] = []
  for (const entry of current) {
    if (baselineStatus.get(entry.path) === entry.status) {
      preExisting.push(entry)
    } else {
      newDirt.push(entry)
    }
  }
  return { newDirt, preExisting }
}

/** Baseline storage directory, relative to `<mainRoot>/.metta`. */
export const BASELINE_DIR = 'scratch/tree-baselines'

/** Relative path (under `<mainRoot>/.metta`) of a change's baseline file. */
export function baselineRelPath(change: string): string {
  return `${BASELINE_DIR}/${change}.yaml`
}

// ---------------------------------------------------------------------------
// Imperative shell (execFile git + StateStore)
// ---------------------------------------------------------------------------

function baselineStore(mainRoot: string): StateStore {
  return new StateStore(join(mainRoot, '.metta'))
}

/**
 * Read the current tracked-file status of the main checkout.
 * Detection only — never mutates the checkout.
 */
export async function readMainTreeStatus(mainRoot: string): Promise<TreeEntry[]> {
  const { stdout } = await execAsync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=no'],
    { cwd: mainRoot },
  )
  return parsePorcelain(stdout)
}

/**
 * Capture the main-checkout baseline for a change. Write-once: when the
 * baseline file already exists (e.g. a verify-fail → re-execute retry), the
 * original snapshot is kept and `created` is false.
 */
export async function captureMainTreeBaseline(
  mainRoot: string,
  change: string,
): Promise<{ created: boolean; preExisting: TreeEntry[] }> {
  const store = baselineStore(mainRoot)
  const relPath = baselineRelPath(change)
  if (await store.exists(relPath)) {
    try {
      const existing = await store.read(relPath, MainTreeBaselineSchema)
      return { created: false, preExisting: existing.entries }
    } catch {
      // Unreadable existing baseline: still write-once — never overwrite.
      return { created: false, preExisting: [] }
    }
  }
  const entries = await readMainTreeStatus(mainRoot)
  const baseline: MainTreeBaseline = {
    change,
    main_root: resolve(mainRoot),
    recorded_at: new Date().toISOString(),
    entries,
  }
  await store.write(relPath, MainTreeBaselineSchema, baseline)
  return { created: true, preExisting: entries }
}

/**
 * Compare the main checkout's current state against the recorded baseline.
 *
 * No baseline file, an unreadable baseline, or a `main_root` mismatch
 * (checkout moved — comparison would be apples to oranges) all yield
 * `hasBaseline: false` so callers warn/skip instead of comparing falsely.
 */
export async function compareMainTree(
  mainRoot: string,
  change: string,
): Promise<{ hasBaseline: boolean; newDirt: TreeEntry[]; preExisting: TreeEntry[] }> {
  const store = baselineStore(mainRoot)
  const relPath = baselineRelPath(change)
  let baseline: MainTreeBaseline
  try {
    baseline = await store.read(relPath, MainTreeBaselineSchema)
  } catch {
    return { hasBaseline: false, newDirt: [], preExisting: [] }
  }
  if (resolve(baseline.main_root) !== resolve(mainRoot)) {
    return { hasBaseline: false, newDirt: [], preExisting: [] }
  }
  const current = await readMainTreeStatus(mainRoot)
  const { newDirt, preExisting } = diffTreeState(baseline.entries, current)
  return { hasBaseline: true, newDirt, preExisting }
}

/** Delete a change's baseline file. Best-effort — never throws. */
export async function deleteMainTreeBaseline(mainRoot: string, change: string): Promise<void> {
  try {
    await baselineStore(mainRoot).deleteIfExists(baselineRelPath(change))
  } catch {
    // Best-effort cleanup: stale baseline files are harmless (keyed by change).
  }
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by the `metta complete implementation` gate when the main checkout
 * accumulated new dirt during a worktree-hosted change's execution window.
 * Carries only the newly-dirty entries — pre-existing dirt never fails.
 */
export class MainTreeContaminationError extends Error {
  constructor(
    message: string,
    public readonly newDirt: TreeEntry[],
  ) {
    super(message)
    this.name = 'MainTreeContaminationError'
  }
}
