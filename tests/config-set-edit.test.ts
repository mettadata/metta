import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { coerceValue, resolveEditor } from '../src/cli/commands/config.js'

const execAsync = promisify(execFile)

const REPO_ROOT = join(import.meta.dirname, '..')
const CLI_PATH = join(REPO_ROOT, 'src', 'cli', 'index.ts')

interface CliResult { stdout: string; stderr: string; code: number }

// Like tests/helpers/cli.ts runCli but allows overriding env (for $EDITOR tests).
async function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<CliResult> {
  let mergedEnv: NodeJS.ProcessEnv | undefined
  if (env) {
    mergedEnv = { ...process.env, ...env }
    // An override value of '' / undefined means "unset this var" — delete it so
    // the child does not inherit the host's $EDITOR / $VISUAL.
    for (const [k, v] of Object.entries(env)) {
      if (v === '' || v === undefined) delete mergedEnv[k]
    }
  }
  try {
    const { stdout, stderr } = await execAsync('npx', ['tsx', CLI_PATH, ...args], {
      cwd,
      timeout: 15000,
      env: mergedEnv ?? process.env,
    })
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

const BASE_CONFIG = `# metta project config
project:
  name: "Test App"
defaults:
  workflow: standard
  mode: supervised
verification:
  strategy: tests_only
`

describe('coerceValue', () => {
  it('coerces booleans, integers, and leaves other strings alone', () => {
    expect(coerceValue('true')).toBe(true)
    expect(coerceValue('false')).toBe(false)
    expect(coerceValue('42')).toBe(42)
    expect(coerceValue('-7')).toBe(-7)
    expect(coerceValue('tests_only')).toBe('tests_only')
    expect(coerceValue('1.5')).toBe('1.5')
    expect(coerceValue('')).toBe('')
  })
})

describe('config set / edit', { timeout: 30000 }, () => {
  let tempDir: string
  let configPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-config-set-'))
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    configPath = join(tempDir, '.metta', 'config.yaml')
    await writeFile(configPath, BASE_CONFIG)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function readConfig(): Promise<Record<string, any>> {
    return YAML.parse(await readFile(configPath, 'utf8'))
  }

  describe('config set', () => {
    it('persists a string value to .metta/config.yaml', async () => {
      const res = await runCli(['config', 'set', 'verification.strategy', 'cli_exit_codes'], tempDir)
      expect(res.code).toBe(0)
      expect(res.stdout).toContain('Set verification.strategy = cli_exit_codes')
      const cfg = await readConfig()
      expect(cfg.verification.strategy).toBe('cli_exit_codes')
    })

    it('coerces "true"/"false" to boolean before writing', async () => {
      // auto.ship_on_success is a schema boolean field — a valid place to write a boolean.
      const res = await runCli(['config', 'set', 'auto.ship_on_success', 'true'], tempDir)
      expect(res.code).toBe(0)
      const doc = YAML.parseDocument(await readFile(configPath, 'utf8'))
      expect(doc.getIn(['auto', 'ship_on_success'])).toBe(true)

      const res2 = await runCli(['config', 'set', 'auto.ship_on_success', 'false'], tempDir)
      expect(res2.code).toBe(0)
      const doc2 = YAML.parseDocument(await readFile(configPath, 'utf8'))
      expect(doc2.getIn(['auto', 'ship_on_success'])).toBe(false)
    })

    it('coerces an integer string to number before writing', async () => {
      const res = await runCli(['config', 'set', 'auto.max_cycles', '14'], tempDir)
      expect(res.code).toBe(0)
      const doc = YAML.parseDocument(await readFile(configPath, 'utf8'))
      const val = doc.getIn(['auto', 'max_cycles'])
      expect(val).toBe(14)
      expect(typeof val).toBe('number')
    })

    it('returns ENOENT error when .metta/config.yaml does not exist', async () => {
      await rm(configPath)
      const res = await runCli(['config', 'set', 'verification.strategy', 'tests_only'], tempDir)
      expect(res.code).not.toBe(0)
      expect(res.stderr).toContain('No .metta/config.yaml found')
      expect(existsSync(configPath)).toBe(false)
    })

    it('rejects an invalid value, restores the original file, and exits non-zero', async () => {
      const before = await readFile(configPath, 'utf8')
      const res = await runCli(['config', 'set', 'defaults.mode', 'bogus'], tempDir)
      expect(res.code).not.toBe(0)
      expect(res.stderr).toContain('Rejected')
      expect(res.stderr).toContain('config restored')
      const after = await readFile(configPath, 'utf8')
      expect(after).toBe(before)
    })

    it('--json mode returns { key, value, status: set }', async () => {
      const res = await runCli(['--json', 'config', 'set', 'verification.strategy', 'tests_only'], tempDir)
      expect(res.code).toBe(0)
      const data = JSON.parse(res.stdout)
      expect(data).toEqual({ key: 'verification.strategy', value: 'tests_only', status: 'set' })
    })
  })

  describe('config edit', () => {
    it('invokes $EDITOR with the resolved config path', async () => {
      const marker = join(tempDir, 'editor-ran.txt')
      const script = join(tempDir, 'fake-editor.sh')
      // The editor records that it ran and which file path it received.
      await writeFile(script, `#!/bin/sh\necho "$1" > "${marker}"\n`)
      await chmod(script, 0o755)

      const res = await runCli(['config', 'edit'], tempDir, { EDITOR: script, VISUAL: '' })
      expect(res.code).toBe(0)
      expect(existsSync(marker)).toBe(true)
      const arg = (await readFile(marker, 'utf8')).trim()
      expect(arg).toBe('.metta/config.yaml')
    })

    // NOTE: the no-editor branch cannot be exercised through the `npx tsx`
    // subprocess harness because npm always injects a default $EDITOR (vi) into
    // the child env. We unit-test the pure resolveEditor() resolver instead.
    it('resolveEditor returns undefined when neither $VISUAL nor $EDITOR is set', () => {
      expect(resolveEditor({})).toBeUndefined()
      expect(resolveEditor({ EDITOR: '', VISUAL: '' })).toBeUndefined()
      expect(resolveEditor({ EDITOR: '   ' })).toBeUndefined()
    })

    it('resolveEditor prefers $VISUAL over $EDITOR', () => {
      expect(resolveEditor({ EDITOR: 'nano', VISUAL: 'code' })).toBe('code')
      expect(resolveEditor({ EDITOR: 'nano' })).toBe('nano')
    })

    it('--json mode returns { file } without spawning an editor', async () => {
      const script = join(tempDir, 'should-not-run.sh')
      const marker = join(tempDir, 'should-not-exist.txt')
      await writeFile(script, `#!/bin/sh\ntouch "${marker}"\n`)
      await chmod(script, 0o755)
      const res = await runCli(['--json', 'config', 'edit'], tempDir, { EDITOR: script })
      expect(res.code).toBe(0)
      const data = JSON.parse(res.stdout)
      expect(data).toEqual({ file: '.metta/config.yaml' })
      expect(existsSync(marker)).toBe(false)
    })

    it('resolves constitution target to spec/project.md', async () => {
      const marker = join(tempDir, 'edit-target.txt')
      const script = join(tempDir, 'fake-editor.sh')
      await writeFile(script, `#!/bin/sh\necho "$1" > "${marker}"\n`)
      await chmod(script, 0o755)
      const res = await runCli(['config', 'edit', 'constitution'], tempDir, { EDITOR: script, VISUAL: '' })
      expect(res.code).toBe(0)
      expect((await readFile(marker, 'utf8')).trim()).toBe('spec/project.md')
    })
  })
})
