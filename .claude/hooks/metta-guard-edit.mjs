#!/usr/bin/env node
// Metta PreToolUse guard: block Edit/Write/NotebookEdit/MultiEdit outside an active metta change.
// Philosophy: nudge toward `metta quick <description>`; tolerate missing metta / not-a-project
// (don't block bootstrap or non-metta repos).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)
const GUARDED = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

const input = await readStdin()
const toolName = input.tool_name || input.toolName || ''

if (!GUARDED.has(toolName)) {
  process.exit(0)
}

// Query metta status; tolerate any failure (not a metta project, metta missing, etc.)
let status
try {
  const { stdout } = await execAsync('metta', ['status', '--json'], {
    cwd: process.cwd(),
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
const filePath =
  input?.tool_input?.file_path ||
  input?.tool_input?.notebook_path ||
  ''
if (filePath) {
  const projectRoot = process.cwd()
  const { relative, resolve } = await import('node:path')
  const relPath = relative(projectRoot, resolve(projectRoot, filePath))
  if (ALLOW_LIST.includes(relPath)) {
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
