import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildCheckContract,
  recordVerdict,
} from '../src/constitution/checker.js'
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

describe('constitution checker', () => {
  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
      cleanup = null
    }
  })

  async function makeFixture(spec: string): Promise<{
    projectRoot: string
    changeName: string
  }> {
    const setup = await setupProject(spec)
    cleanup = setup.cleanup
    return { projectRoot: setup.projectRoot, changeName: setup.changeName }
  }

  async function record(
    violations: Violation[],
    spec: string,
  ): Promise<Awaited<ReturnType<typeof recordVerdict>>> {
    const { projectRoot, changeName } = await makeFixture(spec)
    return recordVerdict({ violations }, projectRoot, changeName)
  }

  describe('buildCheckContract', () => {
    it('BCC-1: returns the full check contract for a fixture project', async () => {
      const specBody = '# Spec\n\n## Overview\nContract fixture.\n'
      const { projectRoot, changeName } = await makeFixture(specBody)
      const contract = await buildCheckContract(projectRoot, changeName)

      expect(contract.articles.conventions).toEqual([
        'Always include `.js` extensions in TypeScript import paths',
        'Validate all state and config with Zod schemas',
      ])
      expect(contract.articles.offLimits).toEqual([
        'No singletons',
        'No `--force` pushes',
        'CommonJS',
      ])
      expect(contract.specPath).toBe(
        join(projectRoot, 'spec', 'changes', changeName, 'spec.md'),
      )
      expect(contract.specContent).toBe(specBody)
      expect(contract.instructions.length).toBeGreaterThan(0)
      expect(contract.instructions).toContain('critical')
      expect(contract.instructions).toContain('major')
      expect(contract.instructions).toContain('minor')
      expect(contract.formattedPrompt).toContain('<CONSTITUTION>')
      expect(contract.formattedPrompt).toContain('<SPEC path="')
    })

    it('BCC-2: rejects when the change has no spec.md', async () => {
      const root = await mkdtemp(join(tmpdir(), 'metta-checker-'))
      cleanup = () => rm(root, { recursive: true, force: true })
      await mkdir(join(root, 'spec', 'changes', 'empty-change'), { recursive: true })
      await writeFile(join(root, 'spec', 'project.md'), PROJECT_MD, 'utf8')

      await expect(buildCheckContract(root, 'empty-change')).rejects.toThrow(
        /ENOENT/,
      )
    })
  })

  describe('recordVerdict', () => {
    it('CHK-1: clean spec — empty violations list → blocking false', async () => {
      const result = await record([], '# Spec\n\n## Overview\nClean.\n')
      expect(result.violations).toEqual([])
      expect(result.blocking).toBe(false)
      expect(result.justifiedMap).toEqual({})
    })

    it('CHK-2: minor-only violation → blocking false, advisory only', async () => {
      const result = await record(
        [
          {
            article: 'Always include `.js` extensions in TypeScript import paths',
            severity: 'minor',
            evidence: 'some import without .js',
            suggestion: 'add .js',
          },
        ],
        '# Spec\n',
      )
      expect(result.violations).toHaveLength(1)
      expect(result.blocking).toBe(false)
      expect(result.violations[0]?.justified).toBe(true)
      expect(result.justifiedMap).toEqual({})
    })

    it('CHK-3: single major unjustified → blocking true', async () => {
      const result = await record(
        [
          {
            article: 'No singletons',
            severity: 'major',
            evidence: 'shared singleton instance across modules',
            suggestion: 'inject dependency',
          },
        ],
        '# Spec\n\nNo Complexity Tracking here.\n',
      )
      expect(result.blocking).toBe(true)
      expect(result.violations[0]?.justified).toBe(false)
      expect(result.violations[0]?.severity).toBe('major')
      expect(result.violations[0]?.evidence).toBe(
        'shared singleton instance across modules',
      )
    })

    it('CHK-4: major justified in Complexity Tracking → blocking false, justified true', async () => {
      const spec = [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: registry is process-scoped and immutable after init',
        '',
      ].join('\n')
      const result = await record(
        [
          {
            article: 'No singletons',
            severity: 'major',
            evidence: 'we use one shared instance',
            suggestion: 'consider DI',
          },
        ],
        spec,
      )
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
      const spec = [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No `--force` pushes: needed for this rebase workflow',
        '',
      ].join('\n')
      const result = await record(
        [
          {
            article: 'No `--force` pushes',
            severity: 'critical',
            evidence: 'we push --force to main',
            suggestion: 'remove --force',
          },
        ],
        spec,
      )
      expect(result.blocking).toBe(true)
      expect(result.violations[0]?.justified).toBe(false)
    })

    it('CHK-6: mixed critical + justified major + minor → blocking true (critical)', async () => {
      const spec = [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: scoped registry only',
        '',
      ].join('\n')
      const result = await record(
        [
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
        ],
        spec,
      )
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
      const spec = [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No singleton pattern: paraphrased key, should NOT justify',
        '- Validate all state and config with Zod schemas: schema added in followup',
        '',
      ].join('\n')
      const result = await record(
        [
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
        ],
        spec,
      )
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
  })
})
