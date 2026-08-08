#!/usr/bin/env node
// Metta PreToolUse guard: block Edit/Write/NotebookEdit/MultiEdit outside an active metta change.
// Philosophy: nudge toward `metta quick <description>`; tolerate missing metta / not-a-project
// (don't block bootstrap or non-metta repos).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const execAsync = promisify(execFile)
const GUARDED = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// Resolve the git top-level of the checkout containing `target` (an absolute
// path), so edits inside a worktree checkout (e.g. .metta/worktrees/<change>/)
// are judged against that worktree's own active change instead of the session
// cwd's. Write targets often don't exist yet, so walk up to the nearest
// EXISTING ancestor before asking git. Any failure (git missing, target
// outside any repo) falls back to process.cwd(), preserving the tolerant
// philosophy.
async function resolveTargetRoot(target) {
  if (!target) return process.cwd()
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
  return process.cwd()
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
const filePath =
  input?.tool_input?.file_path ||
  input?.tool_input?.notebook_path ||
  ''
const targetPath = filePath ? resolve(process.cwd(), filePath) : ''
const projectRoot = await resolveTargetRoot(targetPath)

// Query metta status at the target's checkout root; tolerate any failure
// (not a metta project, metta missing, etc.)
let status
try {
  const { stdout } = await execAsync('metta', ['status', '--json'], {
    cwd: projectRoot,
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
// issue/backlog bodies after the CLI creates them without needing
// an active metta change. These directories have dedicated CLI
// commands (`metta issue`, `metta backlog add`) that own creation.
const ALLOW_PREFIXES = [
  'spec/issues/',
  'spec/backlog/',
]
if (filePath) {
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
