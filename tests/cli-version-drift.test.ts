import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { runCli } from './helpers/cli.js'

// The version stamped into drifted fixtures — can never equal a real release.
const STALE = '0.0.0-drift-test'

const WARNING_MARKER = 'Warning: metta assets were installed by'

interface DoctorCheck {
  check: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

describe('CLI: version drift detection', { timeout: 30000 }, () => {
  let tempDir: string
  let runningVersion: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-drift-'))
    const pkg = JSON.parse(
      await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string }
    runningVersion = pkg.version
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  const configPath = (): string => join(tempDir, '.metta', 'config.yaml')

  async function install(): Promise<void> {
    const { code } = await runCli(['install', '--git-init'], tempDir)
    expect(code).toBe(0)
  }

  /** Overwrite the top-level installed_version stamp in the project config. */
  async function setStamp(version: string): Promise<void> {
    const doc = YAML.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>
    doc.installed_version = version
    await writeFile(configPath(), YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
  }

  /** Remove the stamp entirely — simulates a legacy pre-stamping install. */
  async function removeStamp(): Promise<void> {
    const doc = YAML.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>
    delete doc.installed_version
    await writeFile(configPath(), YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
  }

  /** Duplicate top-level keys — YAML.parse and ConfigLoader both reject this. */
  async function corruptConfig(): Promise<void> {
    await writeFile(
      configPath(),
      'project:\n  name: foo\nproject:\n  name: bar\n',
      'utf8',
    )
  }

  function warningLines(stderr: string): string[] {
    return stderr.split('\n').filter((l) => l.includes(WARNING_MARKER))
  }

  describe('drifted project + metta status', () => {
    it('emits exactly one stderr warning naming both versions; stdout and exit code unchanged', async () => {
      await install()
      const baseline = await runCli(['status'], tempDir)
      expect(warningLines(baseline.stderr)).toHaveLength(0)

      await setStamp(STALE)
      const drifted = await runCli(['status'], tempDir)

      const warnings = warningLines(drifted.stderr)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(STALE)
      expect(warnings[0]).toContain(runningVersion)
      expect(warnings[0]).toContain("run 'metta install' to refresh")

      // stdout unaffected, exit code unchanged from the non-drifted baseline.
      expect(drifted.stdout).toBe(baseline.stdout)
      expect(drifted.stdout).not.toContain(WARNING_MARKER)
      expect(drifted.code).toBe(baseline.code)
    })
  })

  describe('drifted project + --json command', () => {
    it('stdout is a single JSON document carrying template_version_mismatch; warning only on stderr', async () => {
      await install()
      await setStamp(STALE)

      const { stdout, stderr, code } = await runCli(['--json', 'status'], tempDir)
      expect(code).toBe(0)

      // Single well-formed JSON document — JSON.parse would throw on any
      // stray warning text or a second document on stdout.
      const data = JSON.parse(stdout) as Record<string, unknown>
      expect(data.template_version_mismatch).toEqual({
        installed: STALE,
        running: runningVersion,
      })
      // Normal payload keys survive alongside the drift key.
      expect(data.changes).toEqual([])

      expect(stdout).not.toContain(WARNING_MARKER)
      expect(warningLines(stderr)).toHaveLength(1)
    })
  })

  describe('no drift — matching stamp, absent stamp, corrupt config', () => {
    it('matching stamp: no warning, no JSON key, exit 0', async () => {
      await install() // install stamps the running version — an exact match
      const human = await runCli(['status'], tempDir)
      expect(human.code).toBe(0)
      expect(warningLines(human.stderr)).toHaveLength(0)

      const jsonRun = await runCli(['--json', 'status'], tempDir)
      expect(jsonRun.code).toBe(0)
      expect(warningLines(jsonRun.stderr)).toHaveLength(0)
      const data = JSON.parse(jsonRun.stdout) as Record<string, unknown>
      expect('template_version_mismatch' in data).toBe(false)
    })

    it('absent stamp (legacy config): no warning, no JSON key, exit 0', async () => {
      await install()
      await removeStamp()

      const human = await runCli(['status'], tempDir)
      expect(human.code).toBe(0)
      expect(warningLines(human.stderr)).toHaveLength(0)

      const jsonRun = await runCli(['--json', 'status'], tempDir)
      expect(jsonRun.code).toBe(0)
      const data = JSON.parse(jsonRun.stdout) as Record<string, unknown>
      expect('template_version_mismatch' in data).toBe(false)
    })

    it('corrupt config: non-exempt command still fails with the ConfigParseError remedy and no drift warning', async () => {
      await install()
      await corruptConfig()

      const { stdout, stderr, code } = await runCli(['--json', 'status'], tempDir)
      expect(code).toBe(4)
      expect(warningLines(stderr)).toHaveLength(0)
      expect(stdout).not.toContain(WARNING_MARKER)

      const data = JSON.parse(stdout) as {
        error: { code: number; type: string; remedy: string }
      } & Record<string, unknown>
      expect(data.error.type).toBe('config_parse_error')
      expect(data.error.remedy).toBe("Run 'metta doctor --fix' to repair.")
      expect('template_version_mismatch' in data).toBe(false)
    })
  })

  describe('re-stamping clears drift', () => {
    it('metta install on a drifted project: no warning during install, none afterwards', async () => {
      await install()
      await setStamp(STALE)

      // install is drift-exempt — no warning even though the stamp is stale.
      const installRun = await runCli(['install'], tempDir)
      expect(installRun.code).toBe(0)
      expect(warningLines(installRun.stderr)).toHaveLength(0)

      // Re-stamp cleared the drift for subsequent commands.
      const after = await runCli(['status'], tempDir)
      expect(after.code).toBe(0)
      expect(warningLines(after.stderr)).toHaveLength(0)

      const doc = YAML.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>
      expect(doc.installed_version).toBe(runningVersion)
    })

    it('metta init on a stale-stamped project: no warning during init, none afterwards', async () => {
      await install()
      await setStamp(STALE)

      // init is drift-exempt — no warning even though the stamp is stale.
      const initRun = await runCli(['init', '--skip-scan'], tempDir)
      expect(initRun.code).toBe(0)
      expect(warningLines(initRun.stderr)).toHaveLength(0)

      const after = await runCli(['status'], tempDir)
      expect(after.code).toBe(0)
      expect(warningLines(after.stderr)).toHaveLength(0)

      const doc = YAML.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>
      expect(doc.installed_version).toBe(runningVersion)
    })
  })

  describe('drifted project + failing --json command', () => {
    it('the JSON error payload carries template_version_mismatch', async () => {
      await install()
      await setStamp(STALE)

      const { stdout, code } = await runCli(
        ['--json', 'validate-stories', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)

      const data = JSON.parse(stdout) as {
        error: { code: number }
      } & Record<string, unknown>
      expect(data.error.code).toBe(4)
      expect(data.template_version_mismatch).toEqual({
        installed: STALE,
        running: runningVersion,
      })
    })
  })

  describe('doctor: Template freshness', () => {
    async function doctorChecks(): Promise<{ checks: DoctorCheck[]; code: number }> {
      const { stdout, code } = await runCli(['--json', 'doctor'], tempDir)
      const data = JSON.parse(stdout) as { checks: DoctorCheck[] }
      return { checks: data.checks, code }
    }

    function freshness(checks: DoctorCheck[]): DoctorCheck {
      const check = checks.find((c) => c.check === 'Template freshness')
      expect(check).toBeDefined()
      return check as DoctorCheck
    }

    it('passes on a matching stamp, reporting the running version', async () => {
      await install()
      const { checks, code } = await doctorChecks()
      expect(code).toBe(0)
      const check = freshness(checks)
      expect(check.status).toBe('pass')
      expect(check.detail).toBe(runningVersion)
    })

    it('warns on mismatch, naming both versions', async () => {
      await install()
      await setStamp(STALE)
      const { checks, code } = await doctorChecks()
      expect(code).toBe(0)
      const check = freshness(checks)
      expect(check.status).toBe('warn')
      expect(check.detail).toContain(STALE)
      expect(check.detail).toContain(runningVersion)
      expect(check.detail).toContain("run 'metta install'")
    })

    it('warns about a missing stamp on a legacy config; doctor completes with other checks intact', async () => {
      await install()
      await removeStamp()
      const { checks, code } = await doctorChecks()
      expect(code).toBe(0)
      const check = freshness(checks)
      expect(check.status).toBe('warn')
      expect(check.detail).toContain('no installed_version stamp')

      // Other checks unaffected — Framework version still passes.
      const version = checks.find((c) => c.check === 'Framework version')
      expect(version).toBeDefined()
      expect(version?.status).toBe('pass')
      expect(version?.detail).toBe(runningVersion)
      expect(checks.length).toBeGreaterThan(2)
    })

    it('still runs on a corrupt config and freshness warns', async () => {
      await install()
      await corruptConfig()
      const { stdout, stderr, code } = await runCli(['--json', 'doctor'], tempDir)
      expect(code).toBe(0)
      // Doctor owns the repair path — no ConfigParseError remedy, no drift warning.
      expect(warningLines(stderr)).toHaveLength(0)

      const data = JSON.parse(stdout) as { checks: DoctorCheck[] }
      const check = freshness(data.checks)
      expect(check.status).toBe('warn')
      expect(check.detail).toContain('no installed_version stamp')
    })
  })
})
