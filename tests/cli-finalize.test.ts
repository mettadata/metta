import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli } from './helpers/cli.js'

describe('CLI: finalize exit-code ordering', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-finalize-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  // Mark every artifact in the change's .metta.yaml complete so the
  // finalizer's completeness gate passes and later pipeline steps run.
  async function markAllArtifactsComplete(changeName: string): Promise<void> {
    const YAML = (await import('yaml')).default
    const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
    const raw = await readFile(path, 'utf8')
    const doc = YAML.parse(raw) as Record<string, unknown>
    const artifacts = doc.artifacts as Record<string, string>
    for (const id of Object.keys(artifacts)) {
      artifacts[id] = 'complete'
    }
    await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
  }

  it('spec-merge conflict exits 2 with conflict output, never a gate-failure report', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await runCli(['quick', 'conflict case'], tempDir)
    await markAllArtifactsComplete('conflict-case')

    // MODIFIED delta targeting a capability that does not exist — a real
    // merge conflict detected by the pre-gate dry-run merge.
    const deltaContent = `# ghostcap (Delta)

## MODIFIED: Requirement: Ghost Req

The system MUST do ghostly things.

### Scenario: Ghostly
- GIVEN a ghost
- WHEN invoked
- THEN it haunts
`
    await writeFile(
      join(tempDir, 'spec', 'changes', 'conflict-case', 'spec.md'),
      deltaContent,
      'utf8',
    )

    const { stderr, code } = await runCli(['finalize', 'conflict-case'], tempDir)

    expect(code).toBe(2)
    expect(stderr).toContain('Spec merge conflicts detected')
    // The latent bug misreported conflicts (which force gatesPassed: false)
    // as a gate failure with an empty gate list — locked out here.
    expect(stderr).not.toContain('Quality gates failed')
  })

  it('incomplete artifact exits 3 and lists the incomplete artifact by name', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await runCli(['quick', 'incomplete case'], tempDir)
    // Artifacts left in their initial statuses — none are complete.

    const { stderr, code } = await runCli(['finalize', 'incomplete-case'], tempDir)

    expect(code).toBe(3)
    expect(stderr).toContain('required artifacts are not complete')
    expect(stderr).toContain('intent')
  })
})
