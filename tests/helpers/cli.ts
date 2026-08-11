import { join } from 'node:path'
import { access, appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Buffer } from 'node:buffer'

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

/**
 * Raw result of a CLI exec: exit code, signal, and killed-flag preserved as
 * first-class data. `signal` is NOT coerced into `code`; `code` is null when
 * the child died without a numeric exit code (signal kills).
 */
interface RawResult {
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
  killed: boolean
}

/**
 * Sole owner of the try/catch around `execAsync`. Never throws; resolves a
 * RawResult with the exec error's fields preserved on failure and
 * `code: 0, signal: null, killed: false` on success.
 */
async function execCliRaw(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<RawResult> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: timeoutMs },
    )
    return { stdout, stderr, code: 0, signal: null, killed: false }
  } catch (err: unknown) {
    const e = err as {
      stdout?: string
      stderr?: string
      code?: number | string
      killed?: boolean
      signal?: NodeJS.Signals | null
    }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : null,
      signal: e.signal ?? null,
      killed: e.killed === true,
    }
  }
}

/**
 * Resolve-always CLI runner for assertion-phase calls (including deliberate
 * failures). Contract unchanged from the pre-execCliRaw implementation:
 * resolves `{ stdout, stderr, code }` with the legacy `e.code ?? 1` coercion,
 * and appends the timeout-kill stderr marker when the subprocess was killed.
 */
export async function runCli(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const raw = await execCliRaw(args, cwd, timeoutMs)
  if (raw.code === 0 && raw.signal === null && raw.killed === false) {
    return { stdout: raw.stdout, stderr: raw.stderr, code: 0 }
  }
  let stderr = raw.stderr
  if (raw.killed === true || raw.signal !== null) {
    // Make timeout kills diagnosable: without this marker, a killed CLI
    // surfaces only as empty stdout (JSON.parse failures) or files it
    // never got to write (ENOENT), which reads like an unrelated flake.
    stderr += `${stderr.endsWith('\n') || stderr === '' ? '' : '\n'}[runCli] subprocess killed (signal=${raw.signal ?? 'unknown'}, timeout=${timeoutMs}ms)\n`
  }
  return { stdout: raw.stdout, stderr, code: raw.code ?? 1 }
}

/**
 * Thrown by the fail-fast setup helpers. Carries the full captured streams and
 * the true exit code/signal (no coercion); the message tails are truncated to
 * the last 8192 bytes per stream.
 */
export class CliSetupError extends Error {
  override readonly name = 'CliSetupError'

  constructor(
    message: string,
    readonly args: string[],
    readonly cwd: string,
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message)
  }
}

const TAIL_BYTES = 8192

function tail(stream: string): string {
  const buf = Buffer.from(stream, 'utf8')
  return buf.length <= TAIL_BYTES
    ? stream
    : buf.subarray(buf.length - TAIL_BYTES).toString('utf8')
}

function formatDiagnosticBlock(
  args: string[],
  cwd: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  killed: boolean,
  timeoutMs: number,
  stdout: string,
  stderr: string,
): string {
  return [
    `  command: metta ${args.join(' ')}`,
    `  cwd:     ${cwd}`,
    `  exit:    code=${code} signal=${signal ?? 'none'} (killed=${killed}, timeout budget ${timeoutMs}ms)`,
    `  --- stderr (last ${TAIL_BYTES} bytes) ---`,
    tail(stderr),
    `  --- stdout (last ${TAIL_BYTES} bytes) ---`,
    tail(stdout),
  ].join('\n')
}

/**
 * Fail-fast CLI runner for setup-phase calls: throws CliSetupError on any
 * non-success (non-zero exit, signal kill, or timeout kill) with full
 * diagnostics; resolves `{ stdout, stderr }` on success. Does NOT append the
 * runCli stderr marker — the same facts are first-class on the error.
 */
export async function runCliOrThrow(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string }> {
  const raw = await execCliRaw(args, cwd, timeoutMs)
  if (raw.code !== 0 || raw.signal !== null || raw.killed === true) {
    throw new CliSetupError(
      `[runCliOrThrow] CLI setup command failed\n${formatDiagnosticBlock(args, cwd, raw.code, raw.signal, raw.killed, timeoutMs, raw.stdout, raw.stderr)}`,
      args,
      cwd,
      raw.code,
      raw.signal,
      raw.stdout,
      raw.stderr,
    )
  }
  return { stdout: raw.stdout, stderr: raw.stderr }
}

/**
 * Post-check for installFixture, exported so the zero-exit-missing-config
 * scenario is directly unit-testable: throws CliSetupError (code: 0,
 * signal: null) when `${dir}/.metta/config.yaml` does not exist.
 */
export async function verifyInstallWrote(
  dir: string,
  result: { stdout: string; stderr: string },
  args: string[] = ['install', '--git-init'],
  timeoutMs = 10000,
): Promise<void> {
  const configPath = join(dir, '.metta', 'config.yaml')
  try {
    await access(configPath)
  } catch {
    throw new CliSetupError(
      `[installFixture] install exited 0 but wrote no .metta/config.yaml\n  missing: ${configPath}\n${formatDiagnosticBlock(args, dir, 0, null, false, timeoutMs, result.stdout, result.stderr)}`,
      args,
      dir,
      0,
      null,
      result.stdout,
      result.stderr,
    )
  }
}

/**
 * Set up a metta-installed fixture dir, loudly. Runs `metta install`
 * (`--git-init` unless opts.gitInit is false) via the fail-fast path, then
 * verifies the install actually wrote `.metta/config.yaml`. Does NOT call
 * disableWorktrees — pair explicitly where the test needs it.
 */
export async function installFixture(
  dir: string,
  opts: { gitInit?: boolean } = {},
): Promise<void> {
  const args = opts.gitInit !== false ? ['install', '--git-init'] : ['install']
  const result = await runCliOrThrow(args, dir)
  await verifyInstallWrote(dir, result, args)
}
