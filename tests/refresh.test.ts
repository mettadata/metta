import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseConstitution,
  countRequirements,
  buildProjectSection,
  buildConventionsSection,
  buildSpecsSection,
  buildWorkflowSection,
  buildReferenceSection,
  replaceMarkerContent,
  runRefresh,
} from '../src/cli/commands/refresh.js'

describe('refresh', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-refresh-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('parseConstitution', () => {
    it('extracts sections by heading', () => {
      const text = `# Title
## Project
A composable framework.

## Stack
- TypeScript
- Node.js

## Conventions
- Use classes
- Use interfaces

## Off-Limits
- No CommonJS
`
      const sections = parseConstitution(text)
      expect(sections.get('project')).toBe('A composable framework.')
      expect(sections.get('stack')).toContain('TypeScript')
      expect(sections.get('conventions')).toContain('Use classes')
      expect(sections.get('off-limits')).toContain('No CommonJS')
    })

    it('handles empty text', () => {
      const sections = parseConstitution('')
      expect(sections.size).toBe(0)
    })
  })

  describe('countRequirements', () => {
    it('counts MUST and SHALL keywords', () => {
      const text = `The engine MUST load workflows. It SHALL validate. It MUST NOT skip.`
      expect(countRequirements(text)).toBe(3)
    })

    it('returns 0 for no requirements', () => {
      expect(countRequirements('No requirements here.')).toBe(0)
    })
  })

  describe('buildProjectSection', () => {
    it('formats project and stack', () => {
      const constitution = new Map<string, string>()
      constitution.set('project', 'A test project.')
      constitution.set('stack', '- TypeScript\n- Node.js')
      const result = buildProjectSection(constitution)
      expect(result).toContain('**metta**')
      expect(result).toContain('A test project.')
      expect(result).toContain('Stack: TypeScript, Node.js')
    })
  })

  describe('buildConventionsSection', () => {
    it('merges conventions and off-limits', () => {
      const constitution = new Map<string, string>()
      constitution.set('conventions', '- Use classes\n- Use interfaces')
      constitution.set('off-limits', '- No CommonJS')
      const result = buildConventionsSection(constitution)
      expect(result).toContain('- Use classes')
      expect(result).toContain('- Use interfaces')
      expect(result).toContain('- No CommonJS')
    })
  })

  describe('buildSpecsSection', () => {
    it('generates a markdown table', () => {
      const specs = [
        { capability: 'workflow-engine', requirements: 63 },
        { capability: 'state-store', requirements: 67 },
      ]
      const result = buildSpecsSection(specs)
      expect(result).toContain('| workflow-engine | 63 |')
      expect(result).toContain('| state-store | 67 |')
      expect(result).toContain('| Capability | Requirements |')
    })
  })

  describe('buildWorkflowSection', () => {
    it('includes all command categories', () => {
      const result = buildWorkflowSection()
      expect(result).toContain('### Lifecycle')
      expect(result).toContain('### Status')
      expect(result).toContain('### Specs & Docs')
      expect(result).toContain('### Organization')
      expect(result).toContain('### System')
    })

    it('includes all commands', () => {
      const result = buildWorkflowSection()
      const commands = [
        'metta propose', 'metta quick', 'metta auto',
        'metta plan', 'metta execute', 'metta verify',
        'metta finalize', 'metta ship',
        'metta status', 'metta progress', 'metta next',
        'metta complete', 'metta specs list',
        'metta docs generate', 'metta import',
        'metta gaps list', 'metta fix-gap',
        'metta issue',
        'metta changes list', 'metta backlog list',
        'metta doctor', 'metta config get',
        'metta gate run', 'metta refresh', 'metta update',
      ]
      for (const cmd of commands) {
        expect(result).toContain(cmd)
      }
    })
  })

  describe('buildReferenceSection', () => {
    it('includes reference links', () => {
      const result = buildReferenceSection()
      expect(result).toContain('[Constitution](spec/project.md)')
      expect(result).toContain('[Active Specs](spec/specs/)')
    })
  })

  describe('replaceMarkerContent', () => {
    it('replaces content between existing markers', () => {
      const file = `# Title
<!-- metta:project-start source:spec/project.md -->
old content
<!-- metta:project-end -->
footer`
      const result = replaceMarkerContent(file, [{
        startTag: '<!-- metta:project-start source:spec/project.md -->',
        endTag: '<!-- metta:project-end -->',
        content: 'new content',
      }])
      expect(result).toContain('new content')
      expect(result).not.toContain('old content')
      expect(result).toContain('footer')
      expect(result).toContain('# Title')
    })

    it('appends section when markers are missing', () => {
      const file = '# Title\nsome text'
      const result = replaceMarkerContent(file, [{
        startTag: '<!-- metta:specs-start source:spec/specs/ -->',
        endTag: '<!-- metta:specs-end -->',
        content: 'specs here',
      }])
      expect(result).toContain('# Title')
      expect(result).toContain('specs here')
      expect(result).toContain('<!-- metta:specs-start')
      expect(result).toContain('<!-- metta:specs-end -->')
    })

    it('handles multiple marker sections', () => {
      const file = `<!-- metta:project-start source:spec/project.md -->
old project
<!-- metta:project-end -->

<!-- metta:workflow-start -->
old workflow
<!-- metta:workflow-end -->`
      const result = replaceMarkerContent(file, [
        {
          startTag: '<!-- metta:project-start source:spec/project.md -->',
          endTag: '<!-- metta:project-end -->',
          content: 'new project',
        },
        {
          startTag: '<!-- metta:workflow-start -->',
          endTag: '<!-- metta:workflow-end -->',
          content: 'new workflow',
        },
      ])
      expect(result).toContain('new project')
      expect(result).toContain('new workflow')
      expect(result).not.toContain('old project')
      expect(result).not.toContain('old workflow')
    })
  })

  describe('runRefresh', () => {
    it('creates CLAUDE.md from scratch when missing', async () => {
      // Set up minimal constitution
      await mkdir(join(tempDir, 'spec'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# Constitution
## Project
A test framework.

## Stack
- TypeScript
- Vitest

## Conventions
- Use classes

## Off-Limits
- No CommonJS
`)

      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(true)

      const content = await readFile(join(tempDir, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('<!-- metta:project-start')
      expect(content).toContain('A test framework.')
      expect(content).toContain('<!-- metta:conventions-start')
      expect(content).toContain('- Use classes')
      expect(content).toContain('- No CommonJS')
      expect(content).toContain('<!-- metta:workflow-start')
      expect(content).toContain('metta propose')
    })

    it('updates existing CLAUDE.md preserving non-marker content', async () => {
      await mkdir(join(tempDir, 'spec'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# Constitution
## Project
Updated project.

## Stack
- Go
`)
      // Existing file with custom content outside markers
      await writeFile(join(tempDir, 'CLAUDE.md'), `# metta

Custom user content here.

<!-- metta:project-start source:spec/project.md -->
old project info
<!-- metta:project-end -->

More custom content.
`)

      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(true)

      const content = await readFile(join(tempDir, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('Custom user content here.')
      expect(content).toContain('More custom content.')
      expect(content).toContain('Updated project.')
      expect(content).not.toContain('old project info')
    })

    it('dry run does not write file', async () => {
      await mkdir(join(tempDir, 'spec'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# C
## Project
Test.
`)

      const result = await runRefresh(tempDir, true)
      expect(result.written).toBe(false)
      // CLAUDE.md should not exist since it was created fresh
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false)
    })

    it('scans spec directories and counts requirements', async () => {
      await mkdir(join(tempDir, 'spec', 'specs', 'test-engine'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# C
## Project
Test.
`)
      await writeFile(join(tempDir, 'spec', 'specs', 'test-engine', 'spec.md'),
        'The engine MUST do X. It MUST do Y. It SHALL do Z.')

      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(true)

      const content = await readFile(join(tempDir, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('| test-engine | 3 |')
    })

    it('reports no changes when content is identical', async () => {
      await mkdir(join(tempDir, 'spec'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# C
## Project
Test.
`)

      // First run to create
      await runRefresh(tempDir, false)
      // Second run should detect no changes
      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(false)
      expect(result.diff).toBe('No changes.')
    })

    it('includes reference section', async () => {
      await mkdir(join(tempDir, 'spec'), { recursive: true })
      await writeFile(join(tempDir, 'spec', 'project.md'), `# C
## Project
Test.
`)

      await runRefresh(tempDir, false)
      const content = await readFile(join(tempDir, 'CLAUDE.md'), 'utf-8')
      expect(content).toContain('<!-- metta:reference-start -->')
      expect(content).toContain('[Constitution](spec/project.md)')
      expect(content).toContain('<!-- metta:reference-end -->')
    })
  })
})
