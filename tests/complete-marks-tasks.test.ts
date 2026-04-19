import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)

// Drive the CLI via tsx, mirroring the pattern used in tests/cli.test.ts so we
// do not depend on a compiled dist/ binary being present for the test run.
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 10000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

// A tasks.md with two unchecked checkboxes covering two batches. The body
// clears the content-sanity floor (200 bytes) enforced by `metta complete`
// when artifactId is not wildcard -- but since `complete implementation`
// skips the content check (implementation generates '**/*'), the short body
// is also fine. We still keep it realistic.
const TASKS_MD = `# Tasks for Mark Tasks Demo

Implementation plan for the mark-tasks-demo change. Two checkboxes span two
batches so we can confirm the orchestrator's complete call ticks every task,
not just the last one authored by the planner.

## Batch 1 (no dependencies)

- [ ] **Task 1.1: first task**
  - **Files**: \`src/a.ts\`
  - **Action**: implement first thing
  - **Verify**: npm test
  - **Done**: works

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: second task**
  - **Files**: \`src/b.ts\`
  - **Depends on**: Task 1.1
  - **Action**: implement second thing
  - **Verify**: npm test
  - **Done**: works
`

describe('metta complete implementation -- ticks tasks.md checkboxes', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-complete-marks-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('marks every Task N.M as complete in tasks.md when implementation is completed', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await runCli(['propose', 'mark tasks demo'], tempDir)

    const changeDir = join(tempDir, 'spec', 'changes', 'mark-tasks-demo')
    const tasksPath = join(changeDir, 'tasks.md')
    await writeFile(tasksPath, TASKS_MD, 'utf8')

    // `complete implementation` does not require any other artifact content
    // since implementation.generates is a wildcard, so the content-sanity
    // floor is skipped. But we do need the artifact id to be in the workflow
    // (it is, under standard).
    const { code } = await runCli(
      ['complete', 'implementation', '--change', 'mark-tasks-demo'],
      tempDir,
    )
    expect(code).toBe(0)

    const after = await readFile(tasksPath, 'utf8')
    expect(after).toContain('- [x] **Task 1.1:')
    expect(after).toContain('- [x] **Task 2.1:')
    // And no stray unchecked boxes remain for those tasks.
    expect(after).not.toContain('- [ ] **Task 1.1:')
    expect(after).not.toContain('- [ ] **Task 2.1:')
  })

  it('does not fail when tasks.md is absent', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await runCli(['propose', 'no tasks md'], tempDir)

    // Deliberately do NOT write tasks.md. The marking block must fail open.
    const { code } = await runCli(
      ['complete', 'implementation', '--change', 'no-tasks-md'],
      tempDir,
    )
    expect(code).toBe(0)
  })

  it('does not fail when tasks.md is malformed (no parseable Task IDs)', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await runCli(['propose', 'malformed tasks md'], tempDir)

    const changeDir = join(tempDir, 'spec', 'changes', 'malformed-tasks-md')
    const tasksPath = join(changeDir, 'tasks.md')
    // A body that does not contain any `- [ ] **Task N.M:` entries.
    const MALFORMED = `# Malformed

This is not a real tasks file -- it has no parseable task ids, which is
exactly the case we want the marking block to handle gracefully.
`
    await writeFile(tasksPath, MALFORMED, 'utf8')

    const { code } = await runCli(
      ['complete', 'implementation', '--change', 'malformed-tasks-md'],
      tempDir,
    )
    expect(code).toBe(0)

    // File must be untouched (we only rewrite when the content changed).
    const after = await readFile(tasksPath, 'utf8')
    expect(after).toBe(MALFORMED)
  })
})
