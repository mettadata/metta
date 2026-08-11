#!/usr/bin/env node
import { open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Model-id fallback table (used only when the stdin payload carries no
// context_window.context_window_size). Prefix match against documented
// 1M-window model families; Haiku stays at 200k.
// Source: https://code.claude.com/docs/en/statusline (payload schema) and
// https://platform.claude.com/docs/en/about-claude/models/overview (windows).
const ONE_MILLION_WINDOW_PREFIXES = [
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
]

export function resolveContextWindow(stdinObj) {
  const declared = stdinObj?.context_window?.context_window_size
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    return declared
  }
  const id = stdinObj?.model?.id
  if (typeof id === 'string') {
    if (id.includes('[1m]')) return 1_000_000
    if (id.includes('haiku')) return 200_000
    if (ONE_MILLION_WINDOW_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      return 1_000_000
    }
  }
  return 200_000
}

// Harness-computed percentage from the stdin payload — preferred over any
// transcript arithmetic because it reflects effective context after
// compaction. Returns null when the payload does not carry it.
export function resolveUsedPercent(stdinObj) {
  const pct = stdinObj?.context_window?.used_percentage
  if (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0) {
    return Math.round(pct)
  }
  return null
}

export async function readTranscriptTail(path, bytes = 65_536) {
  try {
    const fd = await open(path, 'r')
    try {
      const { size } = await fd.stat()
      if (size === 0) { await fd.close(); return [] }
      const readSize = Math.min(bytes, size)
      const offset = size - readSize
      const buf = Buffer.alloc(readSize)
      await fd.read(buf, 0, readSize, offset)
      await fd.close()
      const lines = buf.toString('utf8').split('\n').filter(l => l.trim())
      if (offset > 0) lines.shift()
      return lines
    } catch { await fd.close().catch(() => {}); return [] }
  } catch { return [] }
}

export function findLatestAssistantUsage(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const record = JSON.parse(lines[i])
      const usage = record.message?.usage
      if (record.message?.role === 'assistant' && typeof usage?.input_tokens === 'number') {
        const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
        const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
        return usage.input_tokens + cacheRead + cacheCreate
      }
    } catch {
      // skip malformed lines
    }
  }
  return null
}

export function computePercent(used, window) {
  return Math.round(used / window * 100)
}

// Clamp display at 100%: a value above 100 means the denominator is wrong,
// so render a visible overflow marker instead of an absurd number.
export function formatPercent(pct) {
  if (pct > 100) return '>100%!'
  return `${pct}%`
}

export function pickColorForSlug(slug) {
  const palette = [31, 32, 33, 34, 35, 36, 91, 92]
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash += slug.charCodeAt(i)
  return palette[hash % palette.length]
}

export function formatStatusLine({ artifact, slug, ctxPct, workflow }) {
  let label = artifact
  const isActive = artifact !== 'idle' && artifact !== 'unknown'
  if (slug && isActive) {
    const code = pickColorForSlug(slug)
    label = `\x1b[${code}m${artifact}\x1b[0m`
  }
  const hasWorkflow = isActive && typeof workflow === 'string' && workflow.length > 0
  const base = hasWorkflow ? `[metta:${workflow}:${label}]` : `[metta: ${label}]`
  if (ctxPct !== null && ctxPct !== undefined) return `${base} ${formatPercent(ctxPct)}`
  return base
}

// Accepts every shape `metta status --json` emits:
//   single-change: { change, current_artifact, workflow, ... }
//   zero-change:   { changes: [], message }
//   multi-change:  { changes: [{ change, current_artifact, workflow, status }, ...] }
// Returns { artifact, slug, workflow } or null when no active work is found.
export function parseStatusPayload(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null
  const fromEntry = (entry) => {
    if (entry === null || typeof entry !== 'object') return null
    if (typeof entry.current_artifact !== 'string' || entry.current_artifact.length === 0) return null
    return {
      artifact: entry.current_artifact,
      slug: typeof entry.change === 'string' && entry.change.length > 0 ? entry.change : null,
      workflow: typeof entry.workflow === 'string' && entry.workflow.length > 0 ? entry.workflow : null,
    }
  }
  const single = fromEntry(parsed)
  if (single) return single
  if (Array.isArray(parsed.changes)) {
    for (const entry of parsed.changes) {
      if (entry !== null && typeof entry === 'object' && entry.status !== 'active') continue
      const found = fromEntry(entry)
      if (found) return found
    }
  }
  return null
}

// Minimal top-level scalar extraction from a change's .metta.yaml. Anchored
// at column 0 so nested keys (e.g. under `artifacts:`) never match. Not a
// YAML parser — the statusline must stay dependency-free.
export function parseChangeMetadataYaml(text) {
  const grab = (key) => {
    const match = text.match(new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm'))
    return match ? match[1] : null
  }
  return {
    status: grab('status'),
    current_artifact: grab('current_artifact'),
    workflow: grab('workflow'),
  }
}

// Worktree-hosted changes never appear in the root artifact store, so scan
// .metta/worktrees/<slug>/spec/changes/<slug>/.metta.yaml directly. Returns
// { artifact, slug, workflow } for the first active change, else null.
export async function findWorktreeActivity(rootDir) {
  try {
    const worktreesDir = join(rootDir, '.metta', 'worktrees')
    const entries = await readdir(worktreesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const metaPath = join(worktreesDir, entry.name, 'spec', 'changes', entry.name, '.metta.yaml')
        const text = await readFile(metaPath, 'utf8')
        const meta = parseChangeMetadataYaml(text)
        if (meta.status === 'active' && typeof meta.current_artifact === 'string' && meta.current_artifact.length > 0) {
          return {
            artifact: meta.current_artifact,
            slug: entry.name,
            workflow: meta.workflow,
          }
        }
      } catch {
        // unreadable worktree entry — skip
      }
    }
    return null
  } catch {
    return null
  }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

async function main() {
  const stdinObj = await readStdin()

  // Context percent: prefer the harness-computed used_percentage, then fall
  // back to transcript arithmetic against the resolved window size.
  let ctxPct = resolveUsedPercent(stdinObj)
  if (ctxPct === null && typeof stdinObj.transcript_path === 'string') {
    const window = resolveContextWindow(stdinObj)
    const lines = await readTranscriptTail(stdinObj.transcript_path)
    const tokens = findLatestAssistantUsage(lines)
    if (tokens !== null) ctxPct = computePercent(tokens, window)
  }

  let activity = null
  try {
    const { stdout } = await execFileAsync('metta', ['status', '--json'], { timeout: 5000 })
    activity = parseStatusPayload(JSON.parse(stdout))
  } catch {
    activity = null
  }
  if (activity === null) {
    activity = await findWorktreeActivity(process.cwd())
  }

  const { artifact, slug, workflow } = activity ?? { artifact: 'idle', slug: null, workflow: null }
  process.stdout.write(formatStatusLine({ artifact, slug, ctxPct, workflow }) + '\n')
  process.exit(0)
}

main().catch(() => {
  process.stdout.write('[metta: unknown]\n')
  process.exit(0)
})
