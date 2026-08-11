import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  runCli,
  runCliOrThrow,
  installFixture,
  verifyInstallWrote,
  CliSetupError,
} from './cli.js'

/**
 * Await a promise expected to reject with CliSetupError and return the error
 * for field-level assertions. Fails the test if the promise resolves.
 */
async function rejectionOf(p: Promise<unknown>): Promise<CliSetupError> {
  try {
    await p
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(CliSetupError)
    return err as CliSetupError
  }
  throw new Error('expected promise to reject with CliSetupError, but it resolved')
}

describe('helpers/cli: fail-fast setup helpers', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-helpers-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('runCliOrThrow', () => {
    it('non-zero exit rejects with CliSetupError carrying full diagnostics', async () => {
      const args = ['definitely-not-a-command']
      const err = await rejectionOf(runCliOrThrow(args, tempDir))

      expect(err.name).toBe('CliSetupError')
      expect(err.code).not.toBe(0)
      expect(err.code).not.toBeNull()
      expect(err.args).toEqual(args)
      expect(err.cwd).toBe(tempDir)
      expect(err.stderr.length).toBeGreaterThan(0)
      // Message names the argv, the exit code, and includes the stderr content.
      expect(err.message).toContain('metta definitely-not-a-command')
      expect(err.message).toContain(`code=${err.code}`)
      expect(err.message).toContain(err.stderr)
    })

    it('signal kill rejects with CliSetupError naming the signal and timeout budget', async () => {
      // Any real invocation takes far longer than 25ms to spawn npx+tsx, so
      // the kill is deterministic; the exact signal (SIGTERM vs escalation)
      // is deliberately not pinned.
      const err = await rejectionOf(runCliOrThrow(['--version'], tempDir, 25))

      expect(err.signal).not.toBeNull()
      expect(err.message).toContain(`signal=${err.signal}`)
      expect(err.message).toContain('timeout budget 25ms')
    })

    it('successful invocation resolves { stdout, stderr } without throwing', async () => {
      const result = await runCliOrThrow(['--version'], tempDir)

      expect(typeof result.stdout).toBe('string')
      expect(typeof result.stderr).toBe('string')
      expect(result.stdout.length).toBeGreaterThan(0)
    })
  })

  describe('verifyInstallWrote / installFixture', () => {
    it('zero exit but missing config throws CliSetupError naming the missing path', async () => {
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const result = { stdout: 'install said ok', stderr: '' }

      const err = await rejectionOf(verifyInstallWrote(tempDir, result))

      expect(err.code).toBe(0)
      expect(err.signal).toBeNull()
      expect(err.cwd).toBe(tempDir)
      expect(err.stdout).toBe('install said ok')
      expect(err.message).toContain(`missing: ${configPath}`)
    })

    it('installFixture writes .metta/config.yaml and does not throw', async () => {
      await installFixture(tempDir)

      expect(existsSync(join(tempDir, '.metta', 'config.yaml'))).toBe(true)
    })
  })

  describe('runCli contract regression', () => {
    it('resolves (not throws) on a failing command with populated result', async () => {
      const result = await runCli(['definitely-not-a-command'], tempDir)

      expect(result.code).not.toBe(0)
      expect(typeof result.stdout).toBe('string')
      expect(typeof result.stderr).toBe('string')
      expect(result.stderr.length).toBeGreaterThan(0)
    })

    it('timeout kill appends the exact subprocess-killed stderr marker', async () => {
      const result = await runCli(['--version'], tempDir, 25)

      expect(result.stderr).toContain('[runCli] subprocess killed (signal=')
      expect(result.stderr).toContain('timeout=25ms)')
    })
  })
})
