import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setProjectField } from './config-writer.js'

describe('setProjectField', () => {
  let tmpDir: string
  let configPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'metta-writer-'))
    mkdirSync(join(tmpDir, '.metta'), { recursive: true })
    configPath = join(tmpDir, '.metta', 'config.yaml')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('is idempotent: re-writing the same value produces byte-identical output', async () => {
    writeFileSync(configPath, 'project:\n  name: test\n  stacks: ["js"]\n', 'utf8')

    await setProjectField(tmpDir, ['project', 'stacks'], ['js'])
    const first = readFileSync(configPath, 'utf8')

    await setProjectField(tmpDir, ['project', 'stacks'], ['js'])
    const second = readFileSync(configPath, 'utf8')

    expect(second).toBe(first)
  })

  it('preserves comments in the config file', async () => {
    const seed = '# comment above project\nproject:\n  name: test\n  stacks: ["js"]\n'
    writeFileSync(configPath, seed, 'utf8')

    await setProjectField(tmpDir, ['project', 'stacks'], ['js', 'ts'])

    const output = readFileSync(configPath, 'utf8')
    expect(output).toContain('# comment above project')
  })

  it('preserves flow-style sequences when updating arrays', async () => {
    writeFileSync(configPath, 'project:\n  name: test\n  stacks: ["rust"]\n', 'utf8')

    await setProjectField(tmpDir, ['project', 'stacks'], ['rust', 'py'])

    const output = readFileSync(configPath, 'utf8')
    expect(output).toContain('stacks: [')
    expect(output).not.toMatch(/^\s*- rust\s*$/m)
  })

  it('propagates ENOENT when config file is missing', async () => {
    let thrown: unknown = null
    try {
      await setProjectField(tmpDir, ['project', 'stacks'], ['js'])
    } catch (err) {
      thrown = err
    }
    expect(thrown).not.toBeNull()
    const code = (thrown as NodeJS.ErrnoException).code
    const message = (thrown as Error).message ?? ''
    expect(code === 'ENOENT' || message.includes('ENOENT')).toBe(true)
  })
})
