import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installMettaStatusline } from '../src/cli/commands/install.js'

let root: string

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

async function makeRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'metta-install-'))
  await mkdir(join(root, '.claude'), { recursive: true })
  return root
}

describe('installMettaStatusline', () => {
  it('fresh install — no settings.json: copies script and creates settings', async () => {
    const r = await makeRoot()

    await installMettaStatusline(r)

    // Script copied
    const scriptPath = join(r, '.claude', 'statusline', 'statusline.mjs')
    const scriptStat = await stat(scriptPath)
    expect(scriptStat.isFile()).toBe(true)

    // Executable bits set
    expect(scriptStat.mode & 0o111).not.toBe(0)

    // settings.json created with correct statusLine
    const settingsPath = join(r, '.claude', 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: '.claude/statusline/statusline.mjs',
      padding: 0,
    })
  })

  it('fresh install — settings.json exists with no statusLine key: preserves existing keys', async () => {
    const r = await makeRoot()
    const settingsPath = join(r, '.claude', 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ mcpServers: {}, hooks: {} }, null, 2) + '\n')

    await installMettaStatusline(r)

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.mcpServers).toEqual({})
    expect(settings.hooks).toEqual({})
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: '.claude/statusline/statusline.mjs',
      padding: 0,
    })
  })

  it('re-run is a no-op: settings.json mtime unchanged on second call', async () => {
    const r = await makeRoot()

    await installMettaStatusline(r)

    const settingsPath = join(r, '.claude', 'settings.json')
    const before = await stat(settingsPath)

    // Small delay to ensure mtime would differ if written
    await new Promise((resolve) => setTimeout(resolve, 50))

    await installMettaStatusline(r)

    const after = await stat(settingsPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('foreign statusLine command: preserves value and warns to stderr', async () => {
    const r = await makeRoot()
    const settingsPath = join(r, '.claude', 'settings.json')
    const foreignSettings = {
      statusLine: { command: '/usr/local/bin/custom.sh' },
    }
    await writeFile(settingsPath, JSON.stringify(foreignSettings, null, 2) + '\n')

    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await installMettaStatusline(r)

    expect(spy).toHaveBeenCalled()
    const call = spy.mock.calls[0]?.[0]
    expect(typeof call === 'string' ? call : '').toContain('statusLine')

    spy.mockRestore()

    // Value unchanged
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.statusLine.command).toBe('/usr/local/bin/custom.sh')
  })

  it('unparseable settings.json: throws with "not valid JSON"', async () => {
    const r = await makeRoot()
    const settingsPath = join(r, '.claude', 'settings.json')
    await writeFile(settingsPath, 'not json {{')

    await expect(installMettaStatusline(r)).rejects.toThrow(/not valid JSON/)
  })

  it('installed file is executable', async () => {
    const r = await makeRoot()

    await installMettaStatusline(r)

    const scriptPath = join(r, '.claude', 'statusline', 'statusline.mjs')
    const scriptStat = await stat(scriptPath)
    expect(scriptStat.mode & 0o111).not.toBe(0)
  })
})
