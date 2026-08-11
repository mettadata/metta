import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

/**
 * dist/.build-stamp — emitted by scripts/emit-build-stamp.mjs at the end of
 * `npm run build`. `commit` is the checkout's git HEAD at build time, or null
 * when git was unavailable during the build.
 */
export const BuildStampSchema = z.object({
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  built_at: z.string().optional(),
})

export type BuildStamp = z.infer<typeof BuildStampSchema>

/** Doctor check payload — same shape templateFreshnessCheck feeds into checks[]. */
export interface DistFreshnessResult {
  status: 'pass' | 'warn'
  detail: string
}

/**
 * Tolerant reader — never throws. Returns the parsed stamp when
 * dist/.build-stamp exists and validates against BuildStampSchema; undefined
 * on missing file, unreadable file, malformed JSON, or schema mismatch (a
 * corrupt stamp is treated the same as no stamp so doctor falls back to the
 * imprecise mtime comparison instead of erroring).
 */
export async function readBuildStamp(distDir: string): Promise<BuildStamp | undefined> {
  try {
    const raw = await readFile(join(distDir, '.build-stamp'), 'utf8')
    const parsed = BuildStampSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const short = (commit: string): string => commit.slice(0, 7)

/**
 * Pure. Exact commit comparison between the stamped build commit and the
 * checkout's current HEAD. Drift is a warn (the CLI still runs — it is just
 * stale), mirroring templateFreshnessCheck semantics.
 */
export function distStampCheck(stampCommit: string, headCommit: string): DistFreshnessResult {
  if (stampCommit === headCommit) {
    return { status: 'pass', detail: `built at ${short(headCommit)}` }
  }
  return {
    status: 'warn',
    detail: `dist behind HEAD — built at ${short(stampCommit)}, HEAD is ${short(headCommit)} (${short(stampCommit)}..${short(headCommit)}) — run 'npm run build'`,
  }
}

/**
 * Pure. Fallback for checkouts whose dist/ predates stamp emission: compare
 * dist mtime against the latest commit time. Imprecise (touching any file
 * updates mtime without rebuilding), so both branches say so.
 */
export function distMtimeFallbackCheck(
  distMtimeMs: number,
  headCommitTimeMs: number,
): DistFreshnessResult {
  if (distMtimeMs < headCommitTimeMs) {
    return {
      status: 'warn',
      detail: "no build stamp — dist older than latest commit; cannot verify precisely — run 'npm run build'",
    }
  }
  return {
    status: 'pass',
    detail: 'no build stamp — dist newer than latest commit; cannot verify precisely',
  }
}

async function gitStdout(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, ...args])
    return stdout.trim()
  } catch {
    return undefined
  }
}

/**
 * Imperative shell for doctor's "Dist freshness" check. packageRoot is the
 * root of the checkout that owns the running CLI's dist/ (resolved by the
 * caller from import.meta.url), NOT the user's project root — the drift being
 * detected is the globally-linked CLI executing a stale dist behind that
 * checkout's HEAD. Never throws.
 */
export async function distFreshnessCheck(packageRoot: string): Promise<DistFreshnessResult> {
  const distDir = join(packageRoot, 'dist')

  let distStat
  try {
    distStat = await stat(distDir)
  } catch {
    return { status: 'pass', detail: 'no dist/ — running from source' }
  }

  const head = await gitStdout(packageRoot, ['rev-parse', 'HEAD'])
  if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) {
    return { status: 'pass', detail: 'not a git checkout — drift check skipped' }
  }

  const stamp = await readBuildStamp(distDir)

  if (stamp === undefined) {
    const commitEpoch = await gitStdout(packageRoot, ['log', '-1', '--format=%ct', 'HEAD'])
    const commitTimeMs = commitEpoch !== undefined ? Number(commitEpoch) * 1000 : Number.NaN
    if (!Number.isFinite(commitTimeMs)) {
      return { status: 'warn', detail: 'no build stamp — cannot verify dist freshness' }
    }
    // The dist dir's own mtime only changes when entries are added/removed,
    // so prefer the CLI entrypoint (rewritten by every tsc build) when present.
    let mtimeMs = distStat.mtimeMs
    try {
      mtimeMs = (await stat(join(distDir, 'cli', 'index.js'))).mtimeMs
    } catch {
      // keep the dist dir mtime
    }
    return distMtimeFallbackCheck(mtimeMs, commitTimeMs)
  }

  if (stamp.commit === null) {
    return {
      status: 'warn',
      detail: 'build stamp has no commit (git unavailable at build time) — cannot verify precisely',
    }
  }

  return distStampCheck(stamp.commit, head)
}
