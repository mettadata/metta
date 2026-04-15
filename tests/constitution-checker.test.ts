import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import {
  checkConstitution,
  type CheckerOptions,
} from '../src/constitution/checker.js'
import type { AIProvider, GenerateOptions } from '../src/providers/provider.js'
import { ProviderError } from '../src/providers/provider.js'
import type { Violation } from '../src/schemas/violation.js'

const PROJECT_MD = `# Project

## Conventions

- Always include \`.js\` extensions in TypeScript import paths
- Validate all state and config with Zod schemas

## Off-Limits

- No singletons
- No \`--force\` pushes
- CommonJS
`

interface ProviderCall {
  prompt: string
  options?: GenerateOptions
}

function mockProvider(
  violations: Violation[],
  opts?: { throwError?: Error },
): { provider: AIProvider; calls: ProviderCall[] } {
  const calls: ProviderCall[] = []
  const provider: AIProvider = {
    id: 'mock',
    async generateText() {
      throw new Error('not used')
    },
    async generateObject<T>(
      prompt: string,
      _schema: z.ZodSchema<T>,
      options?: GenerateOptions,
    ): Promise<T> {
      calls.push({ prompt, options })
      if (opts?.throwError) throw opts.throwError
      return { violations } as unknown as T
    },
    async *streamText() {
      // empty
    },
  }
  return { provider, calls }
}

async function setupProject(specBody: string): Promise<{
  projectRoot: string
  changeName: string
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'metta-checker-'))
  const changeName = 'test-change'
  await mkdir(join(root, 'spec', 'changes', changeName), { recursive: true })
  await writeFile(join(root, 'spec', 'project.md'), PROJECT_MD, 'utf8')
  await writeFile(
    join(root, 'spec', 'changes', changeName, 'spec.md'),
    specBody,
    'utf8',
  )
  return {
    projectRoot: root,
    changeName,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe('checkConstitution', () => {
  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
      cleanup = null
    }
  })

  async function makeOpts(
    spec: string,
    provider: AIProvider,
  ): Promise<CheckerOptions> {
    const setup = await setupProject(spec)
    cleanup = setup.cleanup
    return {
      provider,
      projectRoot: setup.projectRoot,
      changeName: setup.changeName,
    }
  }

  it('CHK-1: clean spec — empty violations list → blocking false', async () => {
    const { provider } = mockProvider([])
    const opts = await makeOpts('# Spec\n\n## Overview\nClean.\n', provider)
    const result = await checkConstitution(opts)
    expect(result.violations).toEqual([])
    expect(result.blocking).toBe(false)
    expect(result.justifiedMap).toEqual({})
  })

  it('CHK-2: minor-only violation → blocking false, advisory only', async () => {
    const { provider } = mockProvider([
      {
        article: 'Always include `.js` extensions in TypeScript import paths',
        severity: 'minor',
        evidence: 'some import without .js',
        suggestion: 'add .js',
      },
    ])
    const opts = await makeOpts('# Spec\n', provider)
    const result = await checkConstitution(opts)
    expect(result.violations).toHaveLength(1)
    expect(result.blocking).toBe(false)
    expect(result.violations[0]?.justified).toBe(true)
    expect(result.justifiedMap).toEqual({})
  })

  it('CHK-3: single major unjustified → blocking true', async () => {
    const { provider } = mockProvider([
      {
        article: 'No singletons',
        severity: 'major',
        evidence: 'shared singleton instance across modules',
        suggestion: 'inject dependency',
      },
    ])
    const opts = await makeOpts('# Spec\n\nNo Complexity Tracking here.\n', provider)
    const result = await checkConstitution(opts)
    expect(result.blocking).toBe(true)
    expect(result.violations[0]?.justified).toBe(false)
    expect(result.violations[0]?.severity).toBe('major')
    expect(result.violations[0]?.evidence).toBe(
      'shared singleton instance across modules',
    )
  })

  it('CHK-4: major justified in Complexity Tracking → blocking false, justified true', async () => {
    const { provider } = mockProvider([
      {
        article: 'No singletons',
        severity: 'major',
        evidence: 'we use one shared instance',
        suggestion: 'consider DI',
      },
    ])
    const spec = [
      '# Spec',
      '',
      '## Complexity Tracking',
      '',
      '- No singletons: registry is process-scoped and immutable after init',
      '',
    ].join('\n')
    const opts = await makeOpts(spec, provider)
    const result = await checkConstitution(opts)
    expect(result.blocking).toBe(false)
    expect(result.violations[0]?.justified).toBe(true)
    expect(result.violations[0]?.justification).toBe(
      'registry is process-scoped and immutable after init',
    )
    expect(result.justifiedMap['No singletons']).toBe(
      'registry is process-scoped and immutable after init',
    )
  })

  it('CHK-5: critical always blocking, even with Complexity Tracking entry', async () => {
    const { provider } = mockProvider([
      {
        article: 'No `--force` pushes',
        severity: 'critical',
        evidence: 'we push --force to main',
        suggestion: 'remove --force',
      },
    ])
    const spec = [
      '# Spec',
      '',
      '## Complexity Tracking',
      '',
      '- No `--force` pushes: needed for this rebase workflow',
      '',
    ].join('\n')
    const opts = await makeOpts(spec, provider)
    const result = await checkConstitution(opts)
    expect(result.blocking).toBe(true)
    expect(result.violations[0]?.justified).toBe(false)
  })

  it('CHK-6: mixed critical + justified major + minor → blocking true (critical)', async () => {
    const { provider } = mockProvider([
      {
        article: 'No `--force` pushes',
        severity: 'critical',
        evidence: 'force push to main',
        suggestion: 'no force',
      },
      {
        article: 'No singletons',
        severity: 'major',
        evidence: 'singleton X',
        suggestion: 'DI',
      },
      {
        article: 'Always include `.js` extensions in TypeScript import paths',
        severity: 'minor',
        evidence: 'missing .js',
        suggestion: 'add .js',
      },
    ])
    const spec = [
      '# Spec',
      '',
      '## Complexity Tracking',
      '',
      '- No singletons: scoped registry only',
      '',
    ].join('\n')
    const opts = await makeOpts(spec, provider)
    const result = await checkConstitution(opts)
    expect(result.blocking).toBe(true)
    expect(result.violations).toHaveLength(3)
    const critical = result.violations.find(v => v.severity === 'critical')
    const major = result.violations.find(v => v.severity === 'major')
    const minor = result.violations.find(v => v.severity === 'minor')
    expect(critical?.justified).toBe(false)
    expect(major?.justified).toBe(true)
    expect(minor?.justified).toBe(true)
    expect(result.justifiedMap['No singletons']).toBe('scoped registry only')
  })

  it('CHK-7: multiple majors, only some justified → blocking true; paraphrased key does not justify', async () => {
    const { provider } = mockProvider([
      {
        article: 'No singletons',
        severity: 'major',
        evidence: 'singleton A',
        suggestion: 'DI',
      },
      {
        article: 'Validate all state and config with Zod schemas',
        severity: 'major',
        evidence: 'raw JSON.parse without validation',
        suggestion: 'add Zod schema',
      },
    ])
    const spec = [
      '# Spec',
      '',
      '## Complexity Tracking',
      '',
      '- No singleton pattern: paraphrased key, should NOT justify',
      '- Validate all state and config with Zod schemas: schema added in followup',
      '',
    ].join('\n')
    const opts = await makeOpts(spec, provider)
    const result = await checkConstitution(opts)
    expect(result.blocking).toBe(true)
    const singleton = result.violations.find(v => v.article === 'No singletons')
    const zod = result.violations.find(
      v => v.article === 'Validate all state and config with Zod schemas',
    )
    expect(singleton?.justified).toBe(false)
    expect(zod?.justified).toBe(true)
    expect(result.justifiedMap).toEqual({
      'Validate all state and config with Zod schemas': 'schema added in followup',
    })
  })

  it('CHK-8: provider throws → checker re-throws unchanged', async () => {
    const err = new ProviderError('API down', 'mock', 503)
    const { provider } = mockProvider([], { throwError: err })
    const opts = await makeOpts('# Spec\n', provider)
    await expect(checkConstitution(opts)).rejects.toBe(err)
  })
})
