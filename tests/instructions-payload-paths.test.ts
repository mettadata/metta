import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 20000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

// Contract regression coverage for the instruction payload's path fields:
// `output_path` must be absolute and rooted at the checkout hosting the
// change (`change_root`), never cwd-relative — a main-root-invoked session
// driving a worktree-hosted change previously wrote the artifact into the
// main checkout (see spec/changes/fix-instruction-payload-output-path-cwd-relative).
describe('metta instructions — absolute change-rooted payload paths', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-paths-'))
    await mkdir(join(tempDir, 'spec'), { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    // git disabled — the emission auto-commit is covered elsewhere; these
    // tests only exercise payload path semantics.
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-paths-test\ngit:\n  enabled: false\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits absolute output_path and change_root rooted at the project root for a local change', async () => {
    const store = new ArtifactStore(join(tempDir, 'spec'))
    await store.createChange('local paths', 'quick', ['intent', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'local-paths'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const payload = JSON.parse(result.stdout)
    expect(payload.change_root).toBe(tempDir)
    expect(payload.output_path).toBe(
      join(tempDir, 'spec', 'changes', 'local-paths', 'intent.md'),
    )
    expect(isAbsolute(payload.output_path)).toBe(true)
  })

  it('resolves a worktree-hosted change from the main root and roots the payload in the worktree (main-root lookup regression)', async () => {
    // Fixture: the change lives ONLY in a worktree checkout under
    // <main>/.metta/worktrees/<name>/ — nothing under <main>/spec/changes/.
    // Invoking from the main root must (a) resolve the change at all (the
    // live ENOENT repro) and (b) emit paths inside the worktree checkout.
    const worktreeRoot = join(tempDir, '.metta', 'worktrees', 'wt-paths')
    await mkdir(join(worktreeRoot, 'spec'), { recursive: true })
    const wtStore = new ArtifactStore(join(worktreeRoot, 'spec'))
    await wtStore.createChange('wt paths', 'quick', ['intent', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'wt-paths'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const payload = JSON.parse(result.stdout)
    expect(payload.change_root).toBe(worktreeRoot)
    expect(payload.output_path).toBe(
      join(worktreeRoot, 'spec', 'changes', 'wt-paths', 'intent.md'),
    )
    expect(isAbsolute(payload.output_path)).toBe(true)
  })

  it('rejects a traversal-shaped --change value with a slug error before any lookup', async () => {
    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', '../../evil'],
      tempDir,
    )
    expect(result.code).toBe(4)

    const payload = JSON.parse(result.stdout)
    expect(payload.error.type).toBe('instructions_error')
    expect(payload.error.message).toContain('Invalid change name')
  })
})
