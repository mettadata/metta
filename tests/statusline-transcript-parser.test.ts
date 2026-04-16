import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTranscriptTail, findLatestAssistantUsage } from '../src/templates/statusline/statusline.mjs'

let tempDir: string

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe('readTranscriptTail', () => {
  it('returns all lines when file is smaller than tail size', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-test-'))
    const filePath = join(tempDir, 'small.jsonl')
    const lines = [
      JSON.stringify({ message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 100 } } }),
      JSON.stringify({ message: { role: 'user', content: 'bye' } }),
    ]
    await writeFile(filePath, lines.join('\n') + '\n')
    const result = await readTranscriptTail(filePath)
    expect(result).toHaveLength(3)
  })

  it('returns tail lines when file is larger than 65536 bytes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-test-'))
    const filePath = join(tempDir, 'large.jsonl')

    // Build a file well over 65536 bytes
    const paddingLine = JSON.stringify({ message: { role: 'user', content: 'x'.repeat(500) } })
    const lineCount = Math.ceil(70_000 / (paddingLine.length + 1)) + 5
    const allLines: string[] = []
    for (let i = 0; i < lineCount; i++) {
      allLines.push(paddingLine)
    }
    const tailRecord = JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 999 } } })
    allLines.push(tailRecord)
    await writeFile(filePath, allLines.join('\n') + '\n')

    const result = await readTranscriptTail(filePath)
    // The tail record should be present
    expect(result[result.length - 1]).toBe(tailRecord)
    // First partial line should have been dropped (offset > 0)
    // so result[0] should be valid JSON
    expect(() => JSON.parse(result[0])).not.toThrow()
  })

  it('returns empty array for non-existent path', async () => {
    const result = await readTranscriptTail('/tmp/does-not-exist-' + Date.now() + '.jsonl')
    expect(result).toEqual([])
  })

  it('returns empty array for empty file', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-test-'))
    const filePath = join(tempDir, 'empty.jsonl')
    await writeFile(filePath, '')
    const result = await readTranscriptTail(filePath)
    expect(result).toEqual([])
  })

  it('drops first partial line when offset > 0', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-test-'))
    const filePath = join(tempDir, 'offset.jsonl')

    // Create a file of ~70k bytes
    const record = JSON.stringify({ message: { role: 'user', content: 'a'.repeat(200) } })
    const lineCount = Math.ceil(70_000 / (record.length + 1)) + 2
    const allLines: string[] = []
    for (let i = 0; i < lineCount; i++) {
      allLines.push(record)
    }
    await writeFile(filePath, allLines.join('\n') + '\n')

    const result = await readTranscriptTail(filePath)
    // First element should be parseable JSON (not a fragment)
    expect(result.length).toBeGreaterThan(0)
    expect(() => JSON.parse(result[0])).not.toThrow()
  })
})

describe('findLatestAssistantUsage', () => {
  it('returns input_tokens from valid last assistant record', () => {
    const lines = [
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 83412 } } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBe(83412)
  })

  it('returns tokens from the later of two assistant records', () => {
    const lines = [
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 10000 } } }),
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 50000 } } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBe(50000)
  })

  it('returns null when only user-role records exist', () => {
    const lines = [
      JSON.stringify({ message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ message: { role: 'user', content: 'world' } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBeNull()
  })

  it('returns null when assistant has no usage block', () => {
    const lines = [
      JSON.stringify({ message: { role: 'assistant', content: 'hi there' } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBeNull()
  })

  it('returns null when input_tokens is a string instead of number', () => {
    const lines = [
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: '100000' } } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBeNull()
  })

  it('returns tokens from valid line when one line is malformed', () => {
    const lines = [
      'not valid json {{{',
      JSON.stringify({ message: { role: 'assistant', usage: { input_tokens: 42000 } } }),
    ]
    expect(findLatestAssistantUsage(lines)).toBe(42000)
  })

  it('returns null for empty array', () => {
    expect(findLatestAssistantUsage([])).toBeNull()
  })
})
