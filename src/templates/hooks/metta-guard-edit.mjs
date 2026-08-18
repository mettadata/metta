#!/usr/bin/env node
// Metta PreToolUse guard: block Edit/Write/NotebookEdit/MultiEdit outside an active metta change.
// Philosophy: nudge toward `metta quick <description>`; tolerate missing metta / not-a-project
// (don't block bootstrap or non-metta repos).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const execAsync = promisify(execFile)
const GUARDED = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// Convert an absolute path to its physical (symlink-resolved) form so it can
// be compared against `git rev-parse --show-toplevel`, which always reports
// physical paths. Under a symlinked session path the logical target would
// otherwise appear outside the physical checkout root and hit the
// outside-root early allow — a fail-open. Write targets often don't exist
// yet, so realpath the nearest EXISTING ancestor and re-append the
// not-yet-created tail. Any realpath failure keeps the logical path,
// preserving the tolerant philosophy.
function toPhysicalPath(target) {
  let dir = target
  const tail = []
  while (!existsSync(dir)) {
    const parent = dirname(dir)
    if (parent === dir) break
    tail.unshift(basename(dir))
    dir = parent
  }
  try {
    dir = realpathSync(dir)
  } catch {
    // Tolerate: keep the logical prefix.
  }
  return tail.length > 0 ? join(dir, ...tail) : dir
}

// Resolve the git top-level of the checkout containing `target` (an absolute
// physical path), so edits inside a worktree checkout (e.g.
// .metta/worktrees/<change>/) are judged against that worktree's own active
// change instead of the session cwd's. Write targets often don't exist yet,
// so walk up to the nearest EXISTING ancestor before asking git. Any failure
// (git missing, target outside any repo) falls back to the physical
// process.cwd(), preserving the tolerant philosophy.
async function resolveTargetRoot(target) {
  if (!target) return toPhysicalPath(process.cwd())
  let dir = dirname(target)
  while (!existsSync(dir)) {
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  try {
    const { stdout } = await execAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      timeout: 5000,
    })
    const top = stdout.trim()
    if (top) return top
  } catch {
    // Not a git checkout (or git unavailable) — fall back to the session cwd.
  }
  return toPhysicalPath(process.cwd())
}

// Derive the root for the active-change probe. A metta-managed worktree's
// checkout root is exactly <H>/.metta/worktrees/<name>; in that case probe
// the hosting checkout H instead of the worktree. H's `metta status`
// aggregates worktree-hosted change state (its answer is a strict superset
// of the worktree's own), so one probe at H answers correctly for both the
// canonical topology (state inside the worktree) and the inverted-hosting
// topology (state only in H's spec/changes/). Any other checkout root is
// returned unchanged. Pure string path math — cannot throw.
function deriveProbeRoot(checkoutRoot) {
  const worktreesDir = dirname(checkoutRoot)   // …/<H>/.metta/worktrees
  const mettaDir = dirname(worktreesDir)       // …/<H>/.metta
  const hostRoot = dirname(mettaDir)           // …/<H>
  if (
    basename(worktreesDir) === 'worktrees' &&
    basename(mettaDir) === '.metta' &&
    hostRoot !== mettaDir                      // guard filesystem-root degenerate cases
  ) {
    return hostRoot
  }
  return checkoutRoot
}

const input = await readStdin()
const toolName = input.tool_name || input.toolName || ''

if (!GUARDED.has(toolName)) {
  process.exit(0)
}

// Extract the edit target BEFORE probing: the target decides which checkout
// the guard reasons about, so worktree-hosted targets probe their own
// checkout rather than the session cwd. Relative tool paths are interpreted
// against the session cwd, matching how the tools themselves resolve them.
// Non-string payloads are ignored (never allowed to throw — an uncaught
// throw would exit 1 and fail open).
const filePathCandidate = [
  input?.tool_input?.file_path,
  input?.tool_input?.notebook_path,
].find((p) => typeof p === 'string' && p.length > 0)
const filePath = filePathCandidate ?? ''
const targetPath = filePath ? toPhysicalPath(resolve(process.cwd(), filePath)) : ''
const projectRoot = await resolveTargetRoot(targetPath)
const probeRoot = deriveProbeRoot(projectRoot)

// Query metta status at the target's checkout root; tolerate any failure
// (not a metta project, metta missing, etc.)
let status
try {
  const { stdout } = await execAsync('metta', ['status', '--json'], {
    cwd: probeRoot,
    timeout: 5000,
  })
  status = JSON.parse(stdout)
} catch {
  process.exit(0)
}

// `metta status --json` returns {change: "..."} when there's an active change,
// and {changes: [], message: "..."} when there isn't. Handle both shapes.
const hasActiveChange =
  typeof status?.change === 'string' ||
  (Array.isArray(status?.changes) && status.changes.length > 0)
if (hasActiveChange) {
  process.exit(0)
}

// Init-phase allow-list: permit writes to these specific paths even without an active change
// so metta-discovery can bootstrap the project during /metta-init.
const ALLOW_LIST = [
  'spec/project.md',
  '.metta/config.yaml',
]
// Directory-prefix allow-list (.md only) — lets users enrich
// issue bodies after the CLI creates them without needing
// an active metta change. This directory has dedicated CLI
// commands (`metta issue`, `metta backlog add`) that own creation.
const ALLOW_PREFIXES = [
  'spec/issues/',
]
if (filePath) {
  // Both sides physical: targetPath via toPhysicalPath, projectRoot via git
  // (or toPhysicalPath in the fallback) — so symlinked session paths cannot
  // make an in-root edit look like an outside-root escape.
  const relPath = relative(projectRoot, targetPath)
  // Outside-root early allow: a file outside the resolved checkout root can
  // never be part of that checkout's metta change, so the guard doesn't apply.
  // `..`-prefixed covers ordinary escapes; isAbsolute covers cases relative()
  // can't express as a traversal (e.g. a different drive on Windows).
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    process.exit(0)
  }
  if (ALLOW_LIST.includes(relPath)) {
    process.exit(0)
  }
  if (ALLOW_PREFIXES.some((p) => relPath.startsWith(p) && relPath.endsWith('.md'))) {
    process.exit(0)
  }
}

process.stderr.write(
  [
    `metta-guard: ${toolName} blocked — no active metta change.`,
    `Start one with /metta:quick <description> or metta quick <description>.`,
    `Then retry the edit.`,
    `Emergency bypass: disable this hook in .claude/settings.local.json.`,
  ].join('\n') + '\n',
)
process.exit(2)
