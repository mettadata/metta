import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TemplateEngine } from '../src/templates/template-engine.js'

describe('TemplateEngine', () => {
  let tempDir: string
  let engine: TemplateEngine

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-tmpl-'))
    engine = new TemplateEngine([tempDir])
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('loads a template from search path', async () => {
    await writeFile(join(tempDir, 'test.md'), '# {change_name}\n\nContent here.')
    const content = await engine.load('test.md')
    expect(content).toContain('{change_name}')
  })

  it('renders a template with context substitution', async () => {
    await writeFile(join(tempDir, 'intent.md'), '# {change_name}\n\n## Problem\n{description}')
    const result = await engine.render('intent.md', {
      change_name: 'add-user-profiles',
      description: 'Users need profiles.',
    })
    expect(result).toContain('# add-user-profiles')
    expect(result).toContain('Users need profiles.')
  })

  it('preserves unmatched placeholders', async () => {
    await writeFile(join(tempDir, 'test.md'), '{known} and {unknown}')
    const result = await engine.render('test.md', { known: 'hello' })
    expect(result).toBe('hello and {unknown}')
  })

  it('searches multiple paths in order', async () => {
    const secondDir = join(tempDir, 'second')
    await mkdir(secondDir, { recursive: true })
    await writeFile(join(secondDir, 'found.md'), 'from second')

    const multiEngine = new TemplateEngine([tempDir, secondDir])
    const content = await multiEngine.load('found.md')
    expect(content).toBe('from second')
  })

  it('first path takes priority', async () => {
    const secondDir = join(tempDir, 'second')
    await mkdir(secondDir, { recursive: true })
    await writeFile(join(tempDir, 'shared.md'), 'from first')
    await writeFile(join(secondDir, 'shared.md'), 'from second')

    const multiEngine = new TemplateEngine([tempDir, secondDir])
    const content = await multiEngine.load('shared.md')
    expect(content).toBe('from first')
  })

  it('throws for missing template', async () => {
    await expect(engine.load('nonexistent.md')).rejects.toThrow()
  })

  it('loads built-in artifact templates', async () => {
    const builtinPath = new URL('../src/templates/artifacts', import.meta.url).pathname
    const builtinEngine = new TemplateEngine([builtinPath])

    const intent = await builtinEngine.load('intent.md')
    expect(intent).toContain('Problem')
    expect(intent).toContain('Proposal')

    const spec = await builtinEngine.load('spec.md')
    expect(spec).toContain('Requirement')
    expect(spec).toContain('Scenario')
  })
})
