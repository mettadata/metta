#!/usr/bin/env node
import { open } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function resolveContextWindow(stdinObj) {
  const id = stdinObj?.model?.id
  if (typeof id === 'string' && id.includes('[1m]')) return 1_000_000
  return 200_000
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
      if (
        record.message?.role === 'assistant' &&
        typeof record.message?.usage?.input_tokens === 'number'
      ) {
        return record.message.usage.input_tokens
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

export function pickColorForSlug(slug) {
  const palette = [31, 32, 33, 34, 35, 36, 91, 92]
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash += slug.charCodeAt(i)
  return palette[hash % palette.length]
}

export function formatStatusLine({ artifact, slug, ctxPct }) {
  let label = artifact
  if (slug && artifact !== 'idle' && artifact !== 'unknown') {
    const code = pickColorForSlug(slug)
    label = `\x1b[${code}m${artifact}\x1b[0m`
  }
  const base = `[metta: ${label}]`
  if (ctxPct !== null && ctxPct !== undefined) return `${base} ${ctxPct}%`
  return base
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
  const window = resolveContextWindow(stdinObj)

  let ctxPct = null
  if (typeof stdinObj.transcript_path === 'string') {
    const lines = await readTranscriptTail(stdinObj.transcript_path)
    const tokens = findLatestAssistantUsage(lines)
    if (tokens !== null) ctxPct = computePercent(tokens, window)
  }

  let artifact = 'idle'
  let slug = null
  try {
    const { stdout } = await execFileAsync('metta', ['status', '--json'], { timeout: 5000 })
    const parsed = JSON.parse(stdout)
    if (typeof parsed.current_artifact === 'string' && parsed.current_artifact.length > 0) {
      artifact = parsed.current_artifact
    }
    if (typeof parsed.change === 'string' && parsed.change.length > 0) {
      slug = parsed.change
    }
  } catch {
    artifact = 'idle'
  }

  process.stdout.write(formatStatusLine({ artifact, slug, ctxPct }) + '\n')
  process.exit(0)
}

main().catch(() => {
  process.stdout.write('[metta: unknown]\n')
  process.exit(0)
})
