import { join } from 'node:path'
import { appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const execAsync = promisify(execFile)

// Repo root resolved from this helper's location (tests/helpers/cli.ts → ../..).
const REPO_ROOT = join(import.meta.dirname, '..', '..')

// Run the CLI binary the same way the original tests/cli.test.ts did:
// `npx tsx src/cli/index.ts ...`. Behavior is identical — do NOT switch to dist.
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
