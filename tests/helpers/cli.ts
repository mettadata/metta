import { join } from 'node:path'
import { appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const execAsync = promisify(execFile)

// Repo root resolved from this helper's location (tests/helpers/cli.ts → ../..).
const REPO_ROOT = join(import.meta.dirname, '..', '..')

// Run the CLI from source: `npx tsx src/cli/index.ts ...`. tsx is a declared
// devDependency installed by `npm ci`, so npx resolves the local binary with
// no registry fetch at test time. Do NOT remove tsx from package.json while
// this helper (or any test) execs it — an undeclared tsx makes cold CI
// runners fetch it per invocation and flake against the exec timeout.
export const CLI_PATH = join(REPO_ROOT, 'src', 'cli', 'index.ts')

/**
 * Opt a test project out of worktree mode (git.worktree.enabled: false) so
 * propose/quick fall back to the historical in-place `git checkout -b` and
 * change state stays under `<root>/spec/changes`. Lifecycle tests that drive
 * follow-up commands from the project root rely on this; worktree mode itself
 * is covered by tests/git-worktree.test.ts and tests/cli-propose-worktree.test.ts.
 *
 * `metta install` writes a config without a `git:` section, so appending one
 * yields valid YAML.
 */
export async function disableWorktrees(dir: string): Promise<void> {
  await appendFile(
    join(dir, '.metta', 'config.yaml'),
    '\ngit:\n  worktree:\n    enabled: false\n',
    'utf8',
  )
}

export async function runCli(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: timeoutMs },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as {
      stdout?: string
      stderr?: string
      code?: number
      killed?: boolean
      signal?: NodeJS.Signals | null
    }
    let stderr = e.stderr ?? ''
    if (e.killed === true || (e.signal !== undefined && e.signal !== null)) {
      // Make timeout kills diagnosable: without this marker, a killed CLI
      // surfaces only as empty stdout (JSON.parse failures) or files it
      // never got to write (ENOENT), which reads like an unrelated flake.
      stderr += `${stderr.endsWith('\n') || stderr === '' ? '' : '\n'}[runCli] subprocess killed (signal=${e.signal ?? 'unknown'}, timeout=${timeoutMs}ms)\n`
    }
    return { stdout: e.stdout ?? '', stderr, code: e.code ?? 1 }
  }
}
