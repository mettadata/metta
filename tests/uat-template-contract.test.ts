import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { TemplateEngine } from '../src/templates/template-engine.js'

const REPO_ROOT = join(import.meta.dirname, '..')
const ARTIFACTS_TEMPLATE_DIR = join(REPO_ROOT, 'src/templates/artifacts')
const SRC_DIR = join(REPO_ROOT, 'src')

const PLACEHOLDERS = ['{change_name}', '{generated_date}', '{source_tier}', '{uat_steps}'] as const

describe('uat.md template contract', () => {
  it('contains all four single-brace placeholders', async () => {
    const template = await readFile(join(ARTIFACTS_TEMPLATE_DIR, 'uat.md'), 'utf8')
    for (const placeholder of PLACEHOLDERS) {
      expect(template).toContain(placeholder)
    }
  })

  it('contains the Reporting failures section with the log-a-metta-issue instruction', async () => {
    const template = await readFile(join(ARTIFACTS_TEMPLATE_DIR, 'uat.md'), 'utf8')
    expect(template).toContain('## Reporting failures')
    expect(template).toContain('log a metta issue')
    expect(template).toContain('/metta-issue <description>')
    expect(template).toContain('sanctioned UAT runner (`/metta-uat`)')
    expect(template).toContain('Never fabricate a pass')
    expect(template).toContain('never check a box for behavior that was not actually observed')
  })

  it('places the Acceptance steps heading above the {uat_steps} placeholder', async () => {
    const template = await readFile(join(ARTIFACTS_TEMPLATE_DIR, 'uat.md'), 'utf8')
    const headingIndex = template.indexOf('## Acceptance steps')
    const stepsIndex = template.indexOf('{uat_steps}')
    expect(headingIndex).toBeGreaterThan(-1)
    expect(stepsIndex).toBeGreaterThan(headingIndex)
  })

  it('contains no double-brace tokens', async () => {
    const template = await readFile(join(ARTIFACTS_TEMPLATE_DIR, 'uat.md'), 'utf8')
    expect(template).not.toContain('{{')
  })

  it('full substitution via TemplateEngine.render leaves none of the four placeholders', async () => {
    const engine = new TemplateEngine([ARTIFACTS_TEMPLATE_DIR])
    const rendered = await engine.render('uat.md', {
      change_name: 'example-change',
      generated_date: '2026-07-21',
      source_tier: 'user stories (stories.md)',
      uat_steps: '### US-1: Example\n\n#### Step 1.1: Example step\n- [ ] Pass',
    })
    for (const placeholder of PLACEHOLDERS) {
      expect(rendered).not.toContain(placeholder)
    }
    expect(rendered).toContain('# UAT: example-change')
    expect(rendered).toContain('- **Generated**: 2026-07-21')
    expect(rendered).toContain('- **Source**: user stories (stories.md)')
    expect(rendered).toContain('#### Step 1.1: Example step')
  })

  it('no src/**/*.ts file contains the template sentinel "## Reporting failures"', async () => {
    const entries = await readdir(SRC_DIR, { recursive: true, withFileTypes: true })
    const tsFiles = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
      .map(entry => join(entry.parentPath, entry.name))
    expect(tsFiles.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of tsFiles) {
      const content = await readFile(file, 'utf8')
      if (content.includes('## Reporting failures')) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
