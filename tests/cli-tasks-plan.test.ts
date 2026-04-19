import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Integration tests drive the BUILT CLI entry point (dist/cli/index.js). The
// task requires exercising the real compiled bundle so we can be sure the
// registered subcommand, renderer, and error envelope all survive the tsc
// pass. If the dist artifact is missing we run `npm run build` once before
// the suite starts.
const REPO_ROOT = join(import.meta.dirname, '..')
const CLI_PATH = join(REPO_ROOT, 'dist', 'cli', 'index.js')

interface CliResult {
  stdout: string
  stderr: string
  code: number
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, ...args],
      {
        cwd,
        timeout: 15000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

async function writeTasksMd(
  tempDir: string,
  changeName: string,
  content: string,
): Promise<string> {
  const changeDir = join(tempDir, 'spec', 'changes', changeName)
  await mkdir(changeDir, { recursive: true })
  const tasksPath = join(changeDir, 'tasks.md')
  await writeFile(tasksPath, content, 'utf8')
  return tasksPath
}

describe('metta tasks plan (integration)', { timeout: 60000 }, () => {
  let tempDir: string

  beforeAll(async () => {
    // Guarantee the compiled CLI exists. If not, build once.
    if (!existsSync(CLI_PATH)) {
      await execFileAsync('npm', ['run', 'build'], {
        cwd: REPO_ROOT,
        timeout: 120000,
      })
    }
  }, 180000)

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-tasks-plan-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('happy path: disjoint tasks parallelize into one wave', async () => {
    const md = [
      '# Tasks',
      '',
      '## Batch 1 (no dependencies)',
      '',
      '- **Task 1.1: first**',
      '  - **Files**: `src/a.ts`',
      '  - **Action**: do a',
      '',
      '- **Task 1.2: second**',
      '  - **Files**: `src/b.ts`',
      '  - **Action**: do b',
      '',
      '- **Task 1.3: third**',
      '  - **Files**: `src/c.ts`',
      '  - **Action**: do c',
      '',
    ].join('\n')
    await writeTasksMd(tempDir, 'fixture', md)

    const { stdout, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture'],
      tempDir,
    )
    expect(code).toBe(0)
    expect(stdout).toContain('--- Batch 1 ---')
    expect(stdout).toContain('Wave 1')
    expect(stdout).toContain('[parallel]')
    expect(stdout).toContain('Task 1.1')
    expect(stdout).toContain('Task 1.2')
    expect(stdout).toContain('Task 1.3')
  })

  it('happy path: file-overlap serializes the shared tasks', async () => {
    const md = [
      '# Tasks',
      '',
      '## Batch 1 (shared file)',
      '',
      '- **Task 1.1: first**',
      '  - **Files**: `src/shared.ts`',
      '  - **Action**: touch shared',
      '',
      '- **Task 1.2: second**',
      '  - **Files**: `src/shared.ts`',
      '  - **Action**: also touch shared',
      '',
    ].join('\n')
    await writeTasksMd(tempDir, 'fixture', md)

    const { stdout, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture'],
      tempDir,
    )
    expect(code).toBe(0)
    // Both tasks belong to the same file-overlap cluster so each occupies its
    // own sequential wave. The second task's wave is marked [sequential] and
    // the renderer annotates it with the identifier of the prior sibling.
    expect(stdout).toContain('[sequential]')
    expect(stdout).toContain('Task 1.1')
    expect(stdout).toContain('Task 1.2')
    // The renderer names the shared-with prior task ID.
    expect(stdout).toContain('shares files with 1.1')
  })

  it('happy path: --json output parses to the documented schema', async () => {
    const md = [
      '# Tasks',
      '',
      '## Batch 1 (mixed)',
      '',
      '- **Task 1.1: disjoint-a**',
      '  - **Files**: `src/a.ts`',
      '  - **Action**: do a',
      '',
      '- **Task 1.2: disjoint-b**',
      '  - **Files**: `src/b.ts`',
      '  - **Action**: do b',
      '',
      '- **Task 1.3: shares-with-a**',
      '  - **Files**: `src/a.ts`',
      '  - **Action**: also touches a',
      '',
    ].join('\n')
    await writeTasksMd(tempDir, 'fixture', md)

    const { stdout, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture', '--json'],
      tempDir,
    )
    expect(code).toBe(0)

    const parsed = JSON.parse(stdout) as {
      change: string
      batches: Array<{
        batch: number
        label: string
        waves: Array<{ wave: string; mode: string; tasks: string[] }>
      }>
    }
    expect(parsed.change).toBe('fixture')
    expect(Array.isArray(parsed.batches)).toBe(true)
    expect(parsed.batches.length).toBe(1)

    const batch = parsed.batches[0]
    expect(batch.batch).toBe(1)
    expect(typeof batch.label).toBe('string')
    expect(Array.isArray(batch.waves)).toBe(true)
    expect(batch.waves.length).toBeGreaterThanOrEqual(1)

    for (const wave of batch.waves) {
      expect(typeof wave.wave).toBe('string')
      expect(['parallel', 'sequential']).toContain(wave.mode)
      expect(Array.isArray(wave.tasks)).toBe(true)
    }

    // All three task IDs appear exactly once across the plan.
    const allTasks = batch.waves.flatMap((w) => w.tasks).sort()
    expect(allTasks).toEqual(['1.1', '1.2', '1.3'])
  })

  it('missing tasks.md exits 4 with a "not found" stderr message', async () => {
    // Create the change dir but not the tasks.md file so the error path is
    // reached before any parse step.
    await mkdir(join(tempDir, 'spec', 'changes', 'fixture'), {
      recursive: true,
    })

    const { stderr, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture'],
      tempDir,
    )
    expect(code).toBe(4)
    expect(stderr).toContain('not found')
  })

  it('missing tasks.md with --json emits a structured error envelope', async () => {
    await mkdir(join(tempDir, 'spec', 'changes', 'fixture'), {
      recursive: true,
    })

    const { stdout, stderr, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture', '--json'],
      tempDir,
    )
    expect(code).toBe(4)

    // The tasks command prints the error envelope to stdout. Fall back to
    // stderr if the implementation ever moves it.
    const payloadSource = stdout.trim().length > 0 ? stdout : stderr
    const parsed = JSON.parse(payloadSource) as {
      error: { code: number; type: string; message: string }
    }
    expect(parsed.error.code).toBe(4)
    expect(typeof parsed.error.type).toBe('string')
    expect(parsed.error.message).toMatch(/not found/i)
  })

  it('archived real-world tasks.md runs end-to-end without crashing', async () => {
    const source = join(
      REPO_ROOT,
      'spec',
      'archive',
      '2026-04-19-adaptive-workflow-tier-selection-emit-complexity-score-after',
      'tasks.md',
    )
    const dest = await (async () => {
      const changeDir = join(tempDir, 'spec', 'changes', 'fixture')
      await mkdir(changeDir, { recursive: true })
      const path = join(changeDir, 'tasks.md')
      await copyFile(source, path)
      return path
    })()
    expect(existsSync(dest)).toBe(true)

    const { stdout, code } = await runCli(
      ['tasks', 'plan', '--change', 'fixture'],
      tempDir,
    )
    expect(code).toBe(0)
    expect(stdout).toContain('--- Batch 1 ---')
    expect(stdout).toContain('--- Batch 5 ---')
  })
})
