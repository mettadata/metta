import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'

describe("CLI: tasks plan", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('metta tasks plan', () => {
    const writeTasksMd = async (change: string, body: string): Promise<string> => {
      const changeDir = join(tempDir, 'spec', 'changes', change)
      await mkdir(changeDir, { recursive: true })
      const path = join(changeDir, 'tasks.md')
      await writeFile(path, body, 'utf8')
      return path
    }

    const SIMPLE_TASKS_MD = `# Tasks for demo

## Batch 1 (no dependencies — fully parallel)

- [ ] **Task 1.1: alpha**
  - **Files**: \`src/a.ts\`
  - **Action**: do stuff
  - **Verify**: npm test
  - **Done**: works

- [ ] **Task 1.2: bravo**
  - **Files**: \`src/b.ts\`
  - **Action**: do more
  - **Verify**: npm test
  - **Done**: works
`

    it('prints human-readable plan with Batch and Wave headers', async () => {
      await writeTasksMd('demo-plan', SIMPLE_TASKS_MD)
      const { stdout, code } = await runCli(
        ['tasks', 'plan', '--change', 'demo-plan'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('--- Batch 1 ---')
      expect(stdout).toContain('Wave 1')
      // No ANSI escape codes in human output.
      // eslint-disable-next-line no-control-regex
      expect(/\x1b\[/.test(stdout)).toBe(false)
    })

    it('prints JSON plan with expected shape when --json is passed', async () => {
      await writeTasksMd('demo-json', SIMPLE_TASKS_MD)
      const { stdout, code } = await runCli(
        ['tasks', 'plan', '--change', 'demo-json', '--json'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('demo-json')
      expect(Array.isArray(data.batches)).toBe(true)
      expect(data.batches.length).toBeGreaterThan(0)
      const batch = data.batches[0]
      expect(batch.batch).toBe(1)
      expect(typeof batch.label).toBe('string')
      expect(Array.isArray(batch.waves)).toBe(true)
      const wave = batch.waves[0]
      expect(typeof wave.wave).toBe('string')
      expect(['parallel', 'sequential']).toContain(wave.mode)
      expect(Array.isArray(wave.tasks)).toBe(true)
    })

    it('exits 4 and writes stderr when tasks.md is missing', async () => {
      const { stderr, code } = await runCli(
        ['tasks', 'plan', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)
      expect(stderr).toContain('not found')
    })

    it('exits 4 with JSON error envelope when tasks.md is missing and --json is set', async () => {
      const { stdout, code } = await runCli(
        ['tasks', 'plan', '--change', 'also-missing', '--json'],
        tempDir,
      )
      expect(code).toBe(4)
      expect(stdout).toContain('"error"')
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
      expect(data.error.message).toContain('not found')
    })

    it('exits 4 when Depends on introduces a dependency cycle', async () => {
      const cyclicTasks = `# Cyclic

## Batch 1

- [ ] **Task 1.1: alpha**
  - **Files**: \`src/a.ts\`
  - **Depends on**: Task 1.2
  - **Action**: stuff
  - **Verify**: npm test
  - **Done**: ok

- [ ] **Task 1.2: bravo**
  - **Files**: \`src/b.ts\`
  - **Depends on**: Task 1.1
  - **Action**: stuff
  - **Verify**: npm test
  - **Done**: ok
`
      await writeTasksMd('cyclic', cyclicTasks)
      const { stderr, code } = await runCli(
        ['tasks', 'plan', '--change', 'cyclic'],
        tempDir,
      )
      expect(code).toBe(4)
      // Cycle error message includes the involved task IDs.
      expect(stderr).toMatch(/1\.1|1\.2/)
    })
  })
})
