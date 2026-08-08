import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

const PROJECT_MD = `# Project

## Conventions

- Validate all state and config with Zod schemas

## Off-Limits

- No singletons
`

const SPEC_MD = `# test-spec

## Requirements

- The system MUST validate input.
`

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

// The check contract's path fields are consumed for filesystem writes and
// reads by the /metta-plan and /metta-check-constitution skills — they must
// be absolute and change-rooted so a main-root-invoked session targets the
// checkout that actually hosts the change (same correctness family as the
// instruction payload's output_path).
describe('metta check-constitution — absolute change-rooted contract paths', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cc-paths-'))
    await mkdir(join(tempDir, 'spec'), { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: cc-paths-test\n',
    )
    await writeFile(join(tempDir, 'spec', 'project.md'), PROJECT_MD)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('emits absolute output_path, spec_path, and change_root for a local change', async () => {
    const store = new ArtifactStore(join(tempDir, 'spec'))
    await store.createChange('local cc', 'standard', ['intent', 'spec'])
    await writeFile(join(tempDir, 'spec', 'changes', 'local-cc', 'spec.md'), SPEC_MD)

    const result = await runCli(
      ['--json', 'check-constitution', '--change', 'local-cc'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const payload = JSON.parse(result.stdout)
    expect(payload.change_root).toBe(tempDir)
    expect(payload.spec_path).toBe(join(tempDir, 'spec', 'changes', 'local-cc', 'spec.md'))
    expect(payload.output_path).toBe(join(tempDir, '.metta', 'scratch', 'local-cc', 'verdict.json'))
    expect(isAbsolute(payload.output_path)).toBe(true)
    expect(isAbsolute(payload.spec_path)).toBe(true)
  })

  it('roots spec_path and change_root in the worktree for a worktree-hosted change invoked from the main root', async () => {
    const worktreeRoot = join(tempDir, '.metta', 'worktrees', 'wt-cc')
    await mkdir(join(worktreeRoot, 'spec'), { recursive: true })
    // The worktree is a full checkout — it carries its own constitution.
    await writeFile(join(worktreeRoot, 'spec', 'project.md'), PROJECT_MD)
    const wtStore = new ArtifactStore(join(worktreeRoot, 'spec'))
    await wtStore.createChange('wt cc', 'standard', ['intent', 'spec'])
    await writeFile(join(worktreeRoot, 'spec', 'changes', 'wt-cc', 'spec.md'), SPEC_MD)

    const result = await runCli(
      ['--json', 'check-constitution', '--change', 'wt-cc'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const payload = JSON.parse(result.stdout)
    expect(payload.change_root).toBe(worktreeRoot)
    expect(payload.spec_path).toBe(join(worktreeRoot, 'spec', 'changes', 'wt-cc', 'spec.md'))
    // The verdict scratch file stays anchored at the INVOKING checkout —
    // transient session state, not a change artifact.
    expect(payload.output_path).toBe(join(tempDir, '.metta', 'scratch', 'wt-cc', 'verdict.json'))
  })

  it('records the verdict and writes violations.md into the worktree checkout', async () => {
    const worktreeRoot = join(tempDir, '.metta', 'worktrees', 'wt-cc-rec')
    await mkdir(join(worktreeRoot, 'spec'), { recursive: true })
    await writeFile(join(worktreeRoot, 'spec', 'project.md'), PROJECT_MD)
    const wtStore = new ArtifactStore(join(worktreeRoot, 'spec'))
    await wtStore.createChange('wt cc rec', 'standard', ['intent', 'spec'])
    await writeFile(join(worktreeRoot, 'spec', 'changes', 'wt-cc-rec', 'spec.md'), SPEC_MD)

    const verdictPath = join(tempDir, 'verdict.json')
    await writeFile(verdictPath, JSON.stringify({ violations: [] }))

    const result = await runCli(
      ['--json', 'check-constitution', '--change', 'wt-cc-rec', '--record', verdictPath],
      tempDir,
    )
    expect(result.code).toBe(0)

    const payload = JSON.parse(result.stdout)
    const expectedViolationsPath = join(worktreeRoot, 'spec', 'changes', 'wt-cc-rec', 'violations.md')
    expect(payload.violations_path).toBe(expectedViolationsPath)
    expect(payload.change_root).toBe(worktreeRoot)
    // The file landed in the worktree, not the main checkout.
    const { readFile } = await import('node:fs/promises')
    const md = await readFile(expectedViolationsPath, 'utf8')
    expect(md).toContain('No violations found.')
  })
})
