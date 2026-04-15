import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync('npx', ['tsx', CLI_PATH, ...args], { cwd, timeout: 15000 })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

async function bootstrapChange(projectRoot: string, changeName: string): Promise<string> {
  await mkdir(join(projectRoot, 'spec', 'specs'), { recursive: true })
  await writeFile(join(projectRoot, 'spec', 'project.md'), '# Project\n\nTest project.\n')
  const changePath = join(projectRoot, 'spec', 'changes', changeName)
  await mkdir(changePath, { recursive: true })
  return changePath
}

describe('metta context stats', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-ctxstat-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits JSON with per-artifact utilization for an active change', async () => {
    const changePath = await bootstrapChange(tempDir, 'test-change')
    await writeFile(join(changePath, 'intent.md'), '# Intent\n\nA small intent.\n')

    const { stdout, code } = await runCli(['--json', 'context', 'stats', '--change', 'test-change'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.change).toBe('test-change')
    expect(Array.isArray(data.artifacts)).toBe(true)
    const intent = data.artifacts.find((a: { artifact: string }) => a.artifact === 'intent')
    expect(intent).toBeDefined()
    expect(intent.budget).toBe(50_000)
    expect(intent.recommendation).toBe('ok')
    expect(intent.utilization).toBeLessThan(0.8)
  })

  it('recommends fan-out for execution artifact over budget', async () => {
    const changePath = await bootstrapChange(tempDir, 'over-exec')
    // Build tasks.md so large that execution artifact blows its 150K budget.
    // Use short text (<5K tokens → 'full' strategy) — no strategy transform shrinks it.
    // 150K budget = 600K chars. To overflow with full strategy, we need a file <5K tokens but
    // write it via multiple files. Simpler: use 'section' strategy range (5K–20K tokens) with
    // content that has no headings (headingSkeleton would reduce it otherwise). Section strategy
    // doesn't transform by default.
    const oneFile = 'a'.repeat(4 * 18_000) // 18K tokens → 'section' strategy, no transform
    await writeFile(join(changePath, 'tasks.md'), oneFile)
    // execution optional sources won't add much; tasks alone gets 18K tokens — still below 150K.
    // We need 10 x 18K = 180K tokens. tasks.md is the single required source; pad via optionals?
    // research_contracts is a DIRECTORY — readFile fails → silent skip.
    // Simpler: pump a bigger single file using section-strategy bounds. Actually max section
    // strategy = 20K tokens. We need 150K+.
    //
    // New approach: write a file with one heading + huge body. Skeleton keeps heading + first 2
    // paragraph lines, full = all. Full strategy only applies <5K. Section strategy (5K–20K)
    // keeps full content. Skeleton (>20K) reduces it.
    //
    // So for utilization ≥ 1.0 on execution (150K budget), we want section strategy files.
    // 8 x 18_750-token section-strategy files would work, but we have 1 required file.
    // Alternative: override via tokens-per-char — use agent_budget? No, CLI uses default.
    //
    // Simplest: write tasks.md with many headings so skeleton preserves substantial tokens.
    const padLine = 'filler text '.repeat(30) // ~360 chars per line
    const sections: string[] = []
    for (let i = 0; i < 3000; i++) {
      sections.push(`## Section ${i}\n${padLine}\n${padLine}\n`)
    }
    await writeFile(join(changePath, 'tasks.md'), `# Tasks\n\n${sections.join('\n')}`)

    const { stdout, code } = await runCli(['--json', 'context', 'stats', '--change', 'over-exec', '--artifact', 'execution'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.artifacts).toHaveLength(1)
    expect(data.artifacts[0].artifact).toBe('execution')
    expect(data.artifacts[0].recommendation).toBe('fan-out')
    expect(data.artifacts[0].utilization).toBeGreaterThanOrEqual(1.0)
  })

  it('recommends split-phase for non-execution artifact over budget', async () => {
    const changePath = await bootstrapChange(tempDir, 'over-design')
    // design requires research + spec; blow its 100K budget via research.md.
    // Use many sections so skeleton retains meaningful tokens.
    const padLine = 'filler text '.repeat(30) // ~360 chars per line
    const sections: string[] = []
    for (let i = 0; i < 2000; i++) {
      sections.push(`## Section ${i}\n${padLine}\n${padLine}\n`)
    }
    await writeFile(join(changePath, 'research.md'), `# Research\n\n${sections.join('\n')}`)

    const { stdout, code } = await runCli(['--json', 'context', 'stats', '--change', 'over-design', '--artifact', 'design'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.artifacts[0].artifact).toBe('design')
    expect(data.artifacts[0].recommendation).toBe('split-phase')
  })

  it('exits non-zero when --change not provided and no active changes exist', async () => {
    await writeFile(join(tempDir, 'spec-placeholder'), '')
    await mkdir(join(tempDir, 'spec', 'changes'), { recursive: true })
    const { stdout, code } = await runCli(['--json', 'context', 'stats'], tempDir)
    expect(code).not.toBe(0)
    const data = JSON.parse(stdout)
    expect(data.error).toBeDefined()
    expect(String(data.error.message)).toMatch(/no active changes/i)
  })

  it('scopes output to --artifact when provided', async () => {
    await bootstrapChange(tempDir, 'scoped')
    const { stdout, code } = await runCli(['--json', 'context', 'stats', '--change', 'scoped', '--artifact', 'intent'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.artifacts).toHaveLength(1)
    expect(data.artifacts[0].artifact).toBe('intent')
  })

  it('prints a human-readable table in text mode', async () => {
    await bootstrapChange(tempDir, 'text-mode')
    const { stdout, code } = await runCli(['context', 'stats', '--change', 'text-mode'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain('Context stats for change: text-mode')
    expect(stdout).toContain('artifact')
    expect(stdout).toContain('recommendation')
    expect(stdout).toContain('intent')
    expect(stdout).toContain('execution')
  })
})
