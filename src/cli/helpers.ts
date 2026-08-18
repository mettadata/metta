import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { ZodError } from 'zod'
import { getErrorMessage } from '../util/errors.js'
import { escapeJsonControls } from '../util/escape-json-controls.js'
import { formatZodError } from '../util/format-zod-error.js'
import { DEFAULT_WORKTREE_DIR, detectWorktreeChangeName } from '../util/git-worktree.js'
import { ConfigLoader, ConfigParseError } from '../config/config-loader.js'
import { getVersionDrift } from '../config/version-drift.js'
import { ArtifactStore } from '../artifacts/artifact-store.js'
import { WorkflowEngine } from '../workflow/workflow-engine.js'
import { ContextEngine } from '../context/context-engine.js'
import { GateRegistry } from '../gates/gate-registry.js'
import { IssuesStore } from '../issues/issues-store.js'
import { MilestonesStore } from '../milestones/milestones-store.js'
import { RoadmapStore } from '../roadmap/roadmap-store.js'
import { GapsStore } from '../gaps/gaps-store.js'
import { SpecLockManager } from '../specs/spec-lock-manager.js'
import { TemplateEngine } from '../templates/template-engine.js'
import { InstructionGenerator } from '../context/instruction-generator.js'
import { StateStore } from '../state/state-store.js'
import type { ChangeMetadata } from '../schemas/change-metadata.js'
import type { Command } from 'commander'

export interface CliContext {
  projectRoot: string
  configLoader: ConfigLoader
  artifactStore: ArtifactStore
  workflowEngine: WorkflowEngine
  contextEngine: ContextEngine
  gateRegistry: GateRegistry
  issuesStore: IssuesStore
  milestonesStore: MilestonesStore
  roadmapStore: RoadmapStore
  gapsStore: GapsStore
  specLockManager: SpecLockManager
  templateEngine: TemplateEngine
  instructionGenerator: InstructionGenerator
  stateStore: StateStore
}

/**
 * Resolve the project root for a CLI invocation: the nearest ancestor of
 * `cwd` (including `cwd` itself) that has its own `spec/changes/` directory,
 * so invocations from inside a worktree checkout (or any subdirectory of a
 * checkout) root the context at that checkout's top level. The walk never
 * escapes the containing git checkout — reaching a directory with a `.git`
 * entry that lacks `spec/changes/` stops the search. Falls back to `cwd`
 * when no ancestor qualifies (e.g. pre-init projects).
 */
export function resolveProjectRoot(cwd: string = process.cwd()): string {
  // Normalize once so every return branch yields a resolved absolute path —
  // the fallbacks must not leak a raw (possibly relative) `cwd` argument.
  const start = resolve(cwd)
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'spec', 'changes'))) return dir
    if (existsSync(join(dir, '.git'))) return start
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

/**
 * Resolve the checkout root that hosts a change's files. When the change's
 * discovery metadata carries a hosting `worktree` path (injected transiently
 * by `ArtifactStore.getChange()` for changes living under
 * `<root>/.metta/worktrees/<name>/`), all change-scoped paths — artifact
 * files, the change's `spec/` tree, and git side-effect targets — must root
 * at that checkout; otherwise they root at the project root. Pure given the
 * metadata (functional core) — callers perform the store lookup at the
 * command edge. Invoked from inside a worktree, the metadata carries no
 * injected host (discovery is local), so the result is the worktree's own
 * project root and in-worktree behavior is unchanged.
 *
 * Containment guarantee: the `worktree` value is persisted in a git-tracked
 * `.metta.yaml` and therefore untrusted. It is resolved against
 * `projectRoot` (never `process.cwd()`), so a relative persisted value
 * yields the same result regardless of the invocation directory. The
 * resolved value is only honored
 * when it is strictly contained under `<projectRoot>/.metta/worktrees/`
 * (checked via `path.relative`, never string prefixing); anything else —
 * an absolute path elsewhere, a `..` escape, or the worktrees dir itself —
 * silently falls back to `projectRoot`, matching the absent-metadata default.
 * This bounds every change-scoped path and git side-effect cwd to the
 * project's own worktree area. Still pure: path math only, no fs I/O.
 */
export function resolveChangeRoot(
  projectRoot: string,
  metadata: Pick<ChangeMetadata, 'worktree'>,
): string {
  if (metadata.worktree === undefined) return projectRoot
  const worktreesDir = resolve(projectRoot, DEFAULT_WORKTREE_DIR)
  const candidate = resolve(projectRoot, metadata.worktree)
  const rel = relative(worktreesDir, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return projectRoot
  return candidate
}

/**
 * Resolve the MAIN checkout root hosting a worktree-hosted change, covering
 * both invocation topologies. Returns `null` when the change is not
 * worktree-hosted — which disengages the layer-3 tree-baseline machinery and
 * automatically covers `git.enabled: false` and worktree-fallback modes (no
 * worktree ⇒ no injected `metadata.worktree` and no
 * `detectWorktreeChangeName` match).
 *
 * 1. Main-checkout invocation: discovery injected `metadata.worktree`, so
 *    `resolveChangeRoot` points away from `projectRoot` — the main root is
 *    `projectRoot` itself. Zero new machinery.
 * 2. In-worktree invocation: `metadata.worktree` is absent (discovery is
 *    local), but `projectRoot` IS the worktree checkout — detected via
 *    `detectWorktreeChangeName(projectRoot) === changeName`. The main root
 *    comes from stripping the `<worktreeDir>/<name>` suffix (pure path math,
 *    guard-edit precedent), cross-checked against — and falling back to —
 *    `git rev-parse --path-format=absolute --git-common-dir`, whose result's
 *    dirname is the hosting checkout root (config-agnostic: covers layouts
 *    where the default-suffix math misses). On disagreement git is
 *    authoritative about the shared common dir, except when git reports the
 *    checkout as its own main (not a linked worktree) — then the git probe is
 *    uninformative and the path-math result stands.
 * 3. Neither topology matches → `null`.
 */
export async function resolveMainCheckoutRoot(
  projectRoot: string,
  changeName: string,
  metadata: Pick<ChangeMetadata, 'worktree'>,
): Promise<string | null> {
  // 1. Main-checkout invocation: the change's files live in a worktree
  //    hosted by this projectRoot.
  if (resolveChangeRoot(projectRoot, metadata) !== projectRoot) return projectRoot

  // 2. In-worktree invocation, gated on the change-name match so a CLI call
  //    for change A from inside change B's worktree never engages.
  if (detectWorktreeChangeName(projectRoot) !== changeName) return null

  const root = resolve(projectRoot)
  // Path math: a metta worktree root is exactly `<H>/<worktreeDir>/<name>`
  // (three trailing segments with the default dir). Rebuild-and-compare keeps
  // this exact rather than substring-based.
  const stripped = resolve(root, '..', '..', '..')
  const pathDerived =
    resolve(stripped, DEFAULT_WORKTREE_DIR, changeName) === root ? stripped : null

  try {
    const { stdout } = await execAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root },
    )
    const commonDir = stdout.trim()
    if (commonDir.length > 0) {
      const gitDerived = resolve(dirname(commonDir))
      if (gitDerived === root) {
        // Git says this checkout owns its .git — not a linked worktree; the
        // probe is uninformative here, so fall back to path math.
        return pathDerived
      }
      if (pathDerived === null || gitDerived !== pathDerived) return gitDerived
      return pathDerived
    }
  } catch {
    // git unavailable or not a repository — the path-math result stands.
  }
  return pathDerived
}

export function createCliContext(projectRoot?: string): CliContext {
  const root = projectRoot ?? resolveProjectRoot()
  const configLoader = new ConfigLoader(root)
  const specDir = join(root, 'spec')
  const mettaDir = join(root, '.metta')

  // Change discovery also covers worktree-per-change checkouts under
  // `<root>/.metta/worktrees/<name>/spec/changes/`, so status/list/resolution
  // stay truthful when invoked from the main checkout root.
  const artifactStore = new ArtifactStore(specDir, {
    worktreesDir: resolve(root, DEFAULT_WORKTREE_DIR),
    // Slug-collision warnings surface on stderr so they never corrupt JSON
    // stdout. The write happens here in the CLI shell — the store core is
    // pure and only invokes the injected sink.
    onWarning: (warning) => process.stderr.write(`Warning: ${warning}\n`),
  })
  const workflowEngine = new WorkflowEngine()
  const contextEngine = new ContextEngine()
  const gateRegistry = new GateRegistry()
  const issuesStore = new IssuesStore(specDir)
  const milestonesStore = new MilestonesStore(specDir)
  const roadmapStore = new RoadmapStore(specDir)
  const gapsStore = new GapsStore(specDir)
  const specLockManager = new SpecLockManager(specDir)
  const stateStore = new StateStore(mettaDir)

  const builtinTemplates = new URL('../templates/artifacts', import.meta.url).pathname
  const projectTemplates = join(mettaDir, 'templates')
  const templateEngine = new TemplateEngine([projectTemplates, builtinTemplates])

  const instructionGenerator = new InstructionGenerator(contextEngine, templateEngine)

  return {
    projectRoot: root,
    configLoader,
    artifactStore,
    workflowEngine,
    contextEngine,
    gateRegistry,
    issuesStore,
    milestonesStore,
    roadmapStore,
    gapsStore,
    specLockManager,
    templateEngine,
    instructionGenerator,
    stateStore,
  }
}

const execAsync = promisify(execFile)

export interface AutoCommitResult {
  committed: boolean
  sha?: string
  reason?: string
}

export async function autoCommitFile(
  projectRoot: string,
  filePath: string,
  message: string,
): Promise<AutoCommitResult> {
  const rel = relative(projectRoot, filePath)
  try {
    await execAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot })
  } catch {
    return { committed: false, reason: 'not a git repository' }
  }
  try {
    const { stdout } = await execAsync(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      { cwd: projectRoot },
    )
    const otherDirtyPaths = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((path) => path !== rel && path !== `"${rel}"`)
    if (otherDirtyPaths.length > 0) {
      const MAX_REASON_LEN = 200
      const count = otherDirtyPaths.length
      let list = otherDirtyPaths.join(', ')
      if (list.length > MAX_REASON_LEN) {
        const truncated: string[] = []
        let running = 0
        for (const p of otherDirtyPaths) {
          if (running + p.length + 2 > MAX_REASON_LEN) break
          truncated.push(p)
          running += p.length + 2
        }
        const remaining = count - truncated.length
        list = `${truncated.join(', ')}, ...and ${remaining} more`
      }
      return {
        committed: false,
        reason: `working tree has ${count} uncommitted tracked change${count === 1 ? '' : 's'} (${list})`,
      }
    }
  } catch {
    return { committed: false, reason: 'failed to read git status' }
  }
  try {
    // TODO(consolidate-git-commit): the ~7 `git commit` sites across the CLI have
    // divergent error handling and cannot share a single helper without behavior
    // changes; deferred to a dedicated refactor.
    await execAsync('git', ['add', '--', rel], { cwd: projectRoot })
    await execAsync('git', ['commit', '-m', message], { cwd: projectRoot })
    const { stdout } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })
    return { committed: true, sha: stdout.trim() }
  } catch (err) {
    const raw = getErrorMessage(err)
    return { committed: false, reason: `git commit failed: ${raw}` }
  }
}

export function outputJson(data: unknown): void {
  const drift = getVersionDrift()
  if (
    drift !== null &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !('template_version_mismatch' in data)
  ) {
    data = {
      ...data,
      template_version_mismatch: { installed: drift.installed, running: drift.running },
    }
  }
  console.log(escapeJsonControls(JSON.stringify(data, null, 2)))
}

// getErrorMessage is imported from util/errors (above) for internal use here and
// re-exported so CLI files can keep importing it from helpers, while core
// (non-CLI) modules import it directly from util/errors to avoid depending on
// the CLI layer.
export { getErrorMessage }

export function handleError(err: unknown, json: boolean): never {
  if (err instanceof ConfigParseError) {
    if (json) {
      outputJson({
        error: {
          code: 4,
          type: 'config_parse_error',
          path: err.path,
          message: err.parserMessage,
          remedy: "Run 'metta doctor --fix' to repair.",
        },
      })
    } else {
      process.stderr.write(`${err.path}: ${err.parserMessage}\n`)
      process.stderr.write(`Run 'metta doctor --fix' to repair.\n`)
    }
    process.exit(4)
  }
  // A raw ZodError's `.message` is the JSON-serialized issues array — render
  // it as friendly `path: message` lines instead (same envelope, same exit 4).
  const message = err instanceof ZodError ? formatZodError(err) : getErrorMessage(err)
  if (json) {
    outputJson({ error: { code: 4, type: 'validation_error', message } })
  } else {
    console.error(`Error: ${message}`)
  }
  process.exit(4)
}

export function getJsonFlag(cmd: Command): boolean {
  const parent = cmd.parent
  return parent?.opts()?.json ?? false
}

// --- ANSI color helpers ---

export function color(text: string, code: number): string {
  return `\x1b[${code}m${text}\x1b[0m`
}

const phaseColorMap: Record<string, number> = {
  propose: 31,
  intent: 31,
  spec: 31,
  research: 33,
  design: 33,
  tasks: 33,
  implementation: 34,
  execute: 34,
  verification: 32,
  verify: 32,
  finalize: 32,
  ship: 92,
  error: 31,
  success: 32,
  info: 36,
  dim: 90,
}

function phaseColor(phase: string): number {
  return phaseColorMap[phase] ?? 36
}

export function banner(phase: string, message: string): string {
  const code = phaseColor(phase)
  return color(`[${phase.toUpperCase()}]`, code) + ' ' + message
}

// Agent-specific colored banners
const agentColorMap: Record<string, { code: number; icon: string }> = {
  proposer:   { code: 31, icon: '📝' },
  specifier:  { code: 31, icon: '📋' },
  researcher: { code: 33, icon: '🔬' },
  architect:  { code: 33, icon: '🏗️' },
  planner:    { code: 33, icon: '📐' },
  executor:   { code: 34, icon: '⚡' },
  reviewer:   { code: 35, icon: '🔎' },
  verifier:   { code: 32, icon: '✅' },
  discovery:  { code: 36, icon: '🔍' },
}

export function agentBanner(agentName: string, message: string): string {
  const bareName = agentName.startsWith('metta-') ? agentName.slice('metta-'.length) : agentName
  const agent = agentColorMap[bareName] ?? { code: 36, icon: '🤖' }
  const label = `metta-${bareName}`
  return `${agent.icon} ${color(`[${label.toUpperCase()}]`, agent.code)} ${message}`
}

/**
 * Branch-safety guard for state-mutating CLI commands that should only write
 * on the main branch (metta issue, metta backlog add/done). Silently passes
 * when the project is not a git repository.
 *
 * @param projectRoot The git working directory
 * @param mainBranchName The configured main branch name (usually `pr_base`)
 * @param overrideBranch When set and equal to the current branch, bypass the guard
 * @throws Error when the current branch is neither the main nor the override
 */
export async function assertOnMainBranch(
  projectRoot: string,
  mainBranchName: string,
  overrideBranch?: string,
): Promise<void> {
  try {
    await execAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot })
  } catch {
    return
  }

  const { stdout } = await execAsync('git', ['branch', '--show-current'], { cwd: projectRoot })
  const current = stdout.trim()

  if (current === mainBranchName) return
  if (overrideBranch && overrideBranch === current) return

  throw new Error(
    `Refusing to write: current branch '${current}' is not the main branch '${mainBranchName}'. ` +
      `Switch branches, or use --on-branch ${current} to override.`,
  )
}

/**
 * Interactive yes/no prompt helper, with cause detection. Returns the
 * configured default (false when unspecified) without prompting when
 * stdin is not a TTY or when `jsonMode` is set, making it safe to call
 * from CLI commands that may be invoked non-interactively or with
 * --json. `viaDefault` is `true` whenever the resolved value came from
 * `defaultYes` rather than an explicit y/n answer — i.e. the non-TTY/
 * jsonMode early return, an empty answer, or an unrecognized answer.
 *
 * When interactive: prints the question with an auto-appended suffix
 * (`[Y/n]` when defaultYes, otherwise `[y/N]`) unless the question
 * text already ends in a `[y/N]`/`[Y/n]` marker, reads one line, and
 * resolves based on the first character (y/Y → true, n/N → false,
 * anything else or empty → defaultYes ?? false).
 */
export async function askYesNoDetailed(
  question: string,
  opts?: { defaultYes?: boolean; jsonMode?: boolean },
): Promise<{ value: boolean; viaDefault: boolean }> {
  const defaultYes = opts?.defaultYes ?? false
  if (!process.stdin.isTTY || opts?.jsonMode === true) {
    return { value: defaultYes, viaDefault: true }
  }
  // Auto-append the [y/N] or [Y/n] suffix unless the caller already
  // provided one. This keeps prompts consistent across the CLI and
  // matches the literal text quoted in spec scenarios.
  const trimmed = question.trimEnd()
  const hasSuffix = /\[[yY]\/[nN]\]\s*$/.test(trimmed)
  const suffix = defaultYes ? '[Y/n]' : '[y/N]'
  const rendered = hasSuffix ? question : `${trimmed} ${suffix}`
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise<{ value: boolean; viaDefault: boolean }>((resolve) => {
    rl.question(rendered + ' ', (answer) => {
      rl.close()
      const trimmed = answer.trim()
      if (trimmed.length === 0) {
        resolve({ value: defaultYes, viaDefault: true })
        return
      }
      const first = trimmed[0]
      if (first === 'y' || first === 'Y') {
        resolve({ value: true, viaDefault: false })
        return
      }
      if (first === 'n' || first === 'N') {
        resolve({ value: false, viaDefault: false })
        return
      }
      resolve({ value: defaultYes, viaDefault: true })
    })
  })
}

/**
 * Thin wrapper over {@link askYesNoDetailed} that discards the
 * `viaDefault` cause and returns the bare boolean. Signature and
 * behavior are unchanged for all existing call sites.
 */
export async function askYesNo(
  question: string,
  opts?: { defaultYes?: boolean; jsonMode?: boolean },
): Promise<boolean> {
  return (await askYesNoDetailed(question, opts)).value
}

/**
 * Read all data piped to stdin. Returns `''` immediately when stdin is a
 * TTY (no pipe attached) or when reading fails (SIGPIPE, early-close,
 * empty stream). Does NOT trim — callers must handle whitespace-only
 * payloads themselves.
 */
export async function readPipedStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  return new Promise<string>((resolve) => {
    let data = ''
    let settled = false
    // After setEncoding('utf8'), chunks are guaranteed strings — no Buffer branch needed.
    const onData = (chunk: string): void => {
      data += chunk
    }
    const onEnd = (): void => {
      clearTimeout(timer)
      settle(data)
    }
    const onError = (): void => {
      clearTimeout(timer)
      settle('')
    }
    // When this helper is invoked from a child process spawned via execFile's
    // default stdio (pipe with no writer attached), stdin never emits 'end'
    // and the promise would hang forever. The timer bounds the wait, and
    // pause() + unref() in cleanup ensure the stdin handle stops pulling
    // bytes and no longer keeps the event loop alive after we've settled.
    // timer.unref() lets the timer itself not block process exit.
    const cleanup = (): void => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.removeListener('error', onError)
      try {
        process.stdin.pause()
        process.stdin.unref()
      } catch {
        // best-effort cleanup; stdin may already be detached
      }
    }
    const settle = (v: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(v)
    }
    // Preserve whatever was buffered so far on timeout — partial bytes from
    // a slow multi-chunk producer should not be silently dropped. For the
    // pipe-with-no-data hang case, `data` is still '' so behavior matches.
    const timer = setTimeout(() => settle(data), 100)
    timer.unref()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
    process.stdin.on('error', onError)
  })
}

/**
 * Read the installed package version from package.json. The file sits at the
 * package root, two levels up from {src,dist}/cli/ in both layouts.
 */
export async function getPackageVersion(): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const pkgUrl = new URL('../../package.json', import.meta.url)
  const pkg = JSON.parse(await readFile(pkgUrl, 'utf8')) as { version?: string }
  return pkg.version ?? 'unknown'
}
