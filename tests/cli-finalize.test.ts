import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, disableWorktrees, installFixture } from './helpers/cli.js'

describe('CLI: finalize exit-code ordering', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-finalize-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
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
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'incomplete case'], tempDir)
    // Artifacts left in their initial statuses — none are complete.

    const { stderr, code } = await runCli(['finalize', 'incomplete-case'], tempDir)

    expect(code).toBe(3)
    expect(stderr).toContain('required artifacts are not complete')
    expect(stderr).toContain('intent')
  })
})

describe('CLI: finalize UAT output', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-finalize-uat-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

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

  // Project-local passing stubs override the built-in gates so finalize's
  // Step 4 always passes fast in these fixtures.
  async function stubAllGatesPassing(): Promise<void> {
    await mkdir(join(tempDir, '.metta', 'gates'), { recursive: true })
    const gateNames = ['tests', 'lint', 'typecheck', 'build', 'stories-valid']
    for (const name of gateNames) {
      const yaml = [
        `name: ${name}`,
        `description: passing stub for ${name}`,
        'command: "true"',
        'timeout: 10000',
        'required: true',
        'on_failure: stop',
        '',
      ].join('\n')
      await writeFile(join(tempDir, '.metta', 'gates', `${name}.yaml`), yaml, 'utf8')
    }
  }

  it('success: JSON payload carries uatPath into the archive plus all pre-existing fields; human mode prints the UAT script line', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'uat success json'], tempDir)
    await runCli(['quick', 'uat success human'], tempDir)
    await markAllArtifactsComplete('uat-success-json')
    await markAllArtifactsComplete('uat-success-human')
    await stubAllGatesPassing()

    const jsonRun = await runCli(['--json', 'finalize', 'uat-success-json'], tempDir)
    expect(jsonRun.code).toBe(0)
    const payload = JSON.parse(jsonRun.stdout) as Record<string, unknown>
    // Pre-existing fields unchanged.
    expect(payload.status).toBe('finalized')
    expect(payload.change).toBe('uat-success-json')
    expect(payload.archive).toMatch(/^\d{4}-\d{2}-\d{2}-uat-success-json$/)
    expect(Array.isArray(payload.gates)).toBe(true)
    expect(Array.isArray(payload.merged)).toBe(true)
    // New field: uatPath is a string pointing into the archive.
    expect(typeof payload.uatPath).toBe('string')
    expect(payload.uatPath as string).toBe(
      join(tempDir, 'spec', 'archive', payload.archive as string, 'UAT.md'),
    )
    const uatContent = await readFile(
      join(tempDir, 'spec', 'archive', payload.archive as string, 'UAT.md'),
      'utf8',
    )
    expect(uatContent).toContain('# UAT: uat-success-json')
    // No warning key on a clean run.
    expect('uatWarning' in payload).toBe(false)
    // Tokens report: generated by default alongside UAT.
    expect(typeof payload.tokensPath).toBe('string')
    expect(payload.tokensPath as string).toBe(
      join(tempDir, 'spec', 'archive', payload.archive as string, 'TOKENS.md'),
    )
    expect('tokensWarning' in payload).toBe(false)

    const humanRun = await runCli(['finalize', 'uat-success-human'], tempDir)
    expect(humanRun.code).toBe(0)
    expect(humanRun.stdout).toContain('Finalized:')
    expect(humanRun.stdout).toContain('UAT script: ')
    expect(humanRun.stdout).toContain('Tokens report: ')
    expect(humanRun.stdout).toContain(join('spec', 'archive'))
    expect(humanRun.stderr).not.toContain('Warning: UAT generation failed')
    expect(humanRun.stderr).not.toContain('Warning: tokens report generation failed')
  })

  it('uat.enabled false: uatPath null, no uatWarning key, no human UAT script line', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    const configPath = join(tempDir, '.metta', 'config.yaml')
    const config = await readFile(configPath, 'utf8')
    await writeFile(configPath, `${config}uat:\n  enabled: false\n`, 'utf8')

    await runCli(['quick', 'uat off json'], tempDir)
    await runCli(['quick', 'uat off human'], tempDir)
    await markAllArtifactsComplete('uat-off-json')
    await markAllArtifactsComplete('uat-off-human')
    await stubAllGatesPassing()

    const jsonRun = await runCli(['--json', 'finalize', 'uat-off-json'], tempDir)
    expect(jsonRun.code).toBe(0)
    const payload = JSON.parse(jsonRun.stdout) as Record<string, unknown>
    expect(payload.status).toBe('finalized')
    expect(payload.uatPath).toBeNull()
    expect('uatWarning' in payload).toBe(false)

    const humanRun = await runCli(['finalize', 'uat-off-human'], tempDir)
    expect(humanRun.code).toBe(0)
    expect(humanRun.stdout).toContain('Finalized:')
    expect(humanRun.stdout).not.toContain('UAT script:')
    expect(humanRun.stderr).not.toContain('Warning: UAT generation failed')
  })

  it('degraded: uatWarning present with success shape and exit 0; human warning on stderr', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'uat degraded json'], tempDir)
    await runCli(['quick', 'uat degraded human'], tempDir)
    await markAllArtifactsComplete('uat-degraded-json')
    await markAllArtifactsComplete('uat-degraded-human')
    await stubAllGatesPassing()

    // Deterministic generation-failure injection: a directory squatting on the
    // UAT.md path makes the generator's write step fail (EISDIR) while every
    // other finalize step proceeds — the same write-adjacent degradation path
    // tests/finalizer.test.ts triggers by mocking TemplateEngine.render
    // (in-process mocks cannot reach the CLI subprocess).
    await mkdir(join(tempDir, 'spec', 'changes', 'uat-degraded-json', 'UAT.md'))
    await mkdir(join(tempDir, 'spec', 'changes', 'uat-degraded-human', 'UAT.md'))

    const jsonRun = await runCli(['--json', 'finalize', 'uat-degraded-json'], tempDir)
    expect(jsonRun.code).toBe(0)
    const payload = JSON.parse(jsonRun.stdout) as Record<string, unknown>
    // Success shape preserved.
    expect(payload.status).toBe('finalized')
    expect(payload.change).toBe('uat-degraded-json')
    expect(payload.archive).toMatch(/^\d{4}-\d{2}-\d{2}-uat-degraded-json$/)
    expect(Array.isArray(payload.gates)).toBe(true)
    expect(Array.isArray(payload.merged)).toBe(true)
    // Degradation surfaces as uatWarning with uatPath null.
    expect(payload.uatPath).toBeNull()
    expect(typeof payload.uatWarning).toBe('string')
    expect(payload.uatWarning as string).toContain('EISDIR')

    const humanRun = await runCli(['finalize', 'uat-degraded-human'], tempDir)
    expect(humanRun.code).toBe(0)
    expect(humanRun.stdout).toContain('Finalized:')
    expect(humanRun.stdout).not.toContain('UAT script:')
    expect(humanRun.stderr).toContain('Warning: UAT generation failed')
  })

  it('error payloads unchanged: incomplete artifacts exits 3 with the exact prior shape and no uatPath', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'uat err shape'], tempDir)
    // Artifacts left incomplete on purpose.

    const { stdout, code } = await runCli(['--json', 'finalize', 'uat-err-shape'], tempDir)

    expect(code).toBe(3)
    const payload = JSON.parse(stdout) as Record<string, unknown>
    expect(payload.status).toBe('incomplete_artifacts')
    expect('uatPath' in payload).toBe(false)
    expect('uatWarning' in payload).toBe(false)
    expect('tokensPath' in payload).toBe(false)
    expect('tokensWarning' in payload).toBe(false)
    // Byte-for-byte shape: exactly the pre-existing keys, nothing added.
    expect(Object.keys(payload).sort()).toEqual(['change', 'incomplete', 'message', 'status'])
  })
})

describe('CLI: finalize tokens output', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-finalize-tokens-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

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

  // Project-local stub gates keep finalize's Step 4 fast and deterministic.
  // `failing` marks gates that exit non-zero instead of passing.
  async function stubGates(failing: string[] = []): Promise<void> {
    await mkdir(join(tempDir, '.metta', 'gates'), { recursive: true })
    const gateNames = ['tests', 'lint', 'typecheck', 'build', 'stories-valid']
    for (const name of gateNames) {
      const command = failing.includes(name) ? 'false' : 'true'
      const yaml = [
        `name: ${name}`,
        `description: stub for ${name}`,
        `command: "${command}"`,
        'timeout: 10000',
        'required: true',
        'on_failure: stop',
        '',
      ].join('\n')
      await writeFile(join(tempDir, '.metta', 'gates', `${name}.yaml`), yaml, 'utf8')
    }
  }

  it('tokens.enabled false: tokensPath null, no tokensWarning key, no human tokens line; UAT unaffected', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    const configPath = join(tempDir, '.metta', 'config.yaml')
    const config = await readFile(configPath, 'utf8')
    await writeFile(configPath, `${config}tokens:\n  enabled: false\n`, 'utf8')

    await runCli(['quick', 'tokens off json'], tempDir)
    await runCli(['quick', 'tokens off human'], tempDir)
    await markAllArtifactsComplete('tokens-off-json')
    await markAllArtifactsComplete('tokens-off-human')
    await stubGates()

    const jsonRun = await runCli(['--json', 'finalize', 'tokens-off-json'], tempDir)
    expect(jsonRun.code).toBe(0)
    const payload = JSON.parse(jsonRun.stdout) as Record<string, unknown>
    expect(payload.status).toBe('finalized')
    expect(payload.tokensPath).toBeNull()
    expect('tokensWarning' in payload).toBe(false)
    // UAT is independent of the tokens toggle.
    expect(typeof payload.uatPath).toBe('string')

    const humanRun = await runCli(['finalize', 'tokens-off-human'], tempDir)
    expect(humanRun.code).toBe(0)
    expect(humanRun.stdout).toContain('Finalized:')
    expect(humanRun.stdout).not.toContain('Tokens report:')
    expect(humanRun.stderr).not.toContain('Warning: tokens report generation failed')
  })

  it('degraded: tokensWarning present with success shape and exit 0; UAT unaffected', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'tokens degraded json'], tempDir)
    await runCli(['quick', 'tokens degraded human'], tempDir)
    await markAllArtifactsComplete('tokens-degraded-json')
    await markAllArtifactsComplete('tokens-degraded-human')
    await stubGates()

    // Deterministic generation-failure injection: a directory squatting on the
    // TOKENS.md path makes the report write step fail (EISDIR) while every
    // other finalize step — UAT included — proceeds.
    await mkdir(join(tempDir, 'spec', 'changes', 'tokens-degraded-json', 'TOKENS.md'))
    await mkdir(join(tempDir, 'spec', 'changes', 'tokens-degraded-human', 'TOKENS.md'))

    const jsonRun = await runCli(['--json', 'finalize', 'tokens-degraded-json'], tempDir)
    expect(jsonRun.code).toBe(0)
    const payload = JSON.parse(jsonRun.stdout) as Record<string, unknown>
    // Success shape preserved.
    expect(payload.status).toBe('finalized')
    expect(payload.change).toBe('tokens-degraded-json')
    expect(payload.archive).toMatch(/^\d{4}-\d{2}-\d{2}-tokens-degraded-json$/)
    expect(Array.isArray(payload.gates)).toBe(true)
    expect(Array.isArray(payload.merged)).toBe(true)
    // Degradation surfaces as tokensWarning with tokensPath null.
    expect(payload.tokensPath).toBeNull()
    expect(typeof payload.tokensWarning).toBe('string')
    expect(payload.tokensWarning as string).toContain('EISDIR')
    // UAT generation is independent of tokens degradation.
    expect(typeof payload.uatPath).toBe('string')
    expect('uatWarning' in payload).toBe(false)

    const humanRun = await runCli(['finalize', 'tokens-degraded-human'], tempDir)
    expect(humanRun.code).toBe(0)
    expect(humanRun.stdout).toContain('Finalized:')
    expect(humanRun.stdout).not.toContain('Tokens report:')
    expect(humanRun.stderr).toContain('Warning: tokens report generation failed')
  })

  it('gates_failed payload unchanged: exact prior shape with no tokensPath or tokensWarning keys', async () => {
    await installFixture(tempDir)
    await disableWorktrees(tempDir)
    await runCli(['quick', 'tokens gate shape'], tempDir)
    await markAllArtifactsComplete('tokens-gate-shape')
    await stubGates(['tests'])

    const { stdout, code } = await runCli(['--json', 'finalize', 'tokens-gate-shape'], tempDir)

    expect(code).toBe(1)
    const payload = JSON.parse(stdout) as Record<string, unknown>
    expect(payload.status).toBe('gates_failed')
    expect('tokensPath' in payload).toBe(false)
    expect('tokensWarning' in payload).toBe(false)
    expect('uatPath' in payload).toBe(false)
    // Byte-for-byte shape: exactly the pre-existing keys, nothing added.
    expect(Object.keys(payload).sort()).toEqual(['change', 'gates', 'message', 'status'])
  })
})
