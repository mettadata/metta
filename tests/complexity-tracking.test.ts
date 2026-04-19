import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { parseComplexityTracking } from '../src/constitution/complexity-tracking.js'

const execFileAsync = promisify(execFile)

// Resolve the CLI entry script the same way `tests/cli.test.ts` does so this
// integration suite drives the exact same binary via `npx tsx`.
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

interface CliResult {
  stdout: string
  stderr: string
  code: number
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      {
        cwd,
        timeout: 10000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

interface ComplexityScore {
  score: number
  signals: { file_count: number }
  recommended_workflow: 'trivial' | 'quick' | 'standard' | 'full'
}

interface ChangeMetadata {
  workflow: string
  artifacts: Record<string, string>
  complexity_score?: ComplexityScore
  actual_complexity_score?: ComplexityScore
  auto_accept_recommendation?: boolean
  workflow_locked?: boolean
}

async function readMetadata(
  tempDir: string,
  changeName: string,
): Promise<ChangeMetadata> {
  const raw = await readFile(
    join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
    'utf8',
  )
  return YAML.parse(raw) as ChangeMetadata
}

// Build an intent.md body containing an `## Impact` section with `fileCount`
// distinct inline-code file entries. Body padded above the 200-byte content
// sanity floor so the complete command does not reject the artifact before
// the adaptive scorer observes it.
function buildImpactMd(title: string, fileCount: number): string {
  const files = Array.from({ length: fileCount }, (_, i) => {
    const letter = String.fromCharCode('a'.charCodeAt(0) + i)
    return `- \`src/${letter}.ts\``
  })
  return [
    `# ${title}`,
    '',
    '## Problem',
    '',
    'Padding body for the adaptive-tier integration fixture. The body is long',
    'enough to clear the 200-byte content sanity floor that `metta complete`',
    'enforces on intent.md before the adaptive scoring block runs, so the',
    'scorer receives a real document rather than a rejected stub.',
    '',
    '## Impact',
    '',
    ...files,
    '',
  ].join('\n')
}

// Build a summary.md body containing a `## Files` section with `fileCount`
// distinct inline-code file entries. Body padded above the 100-byte summary
// sanity floor.
function buildSummaryMd(title: string, fileCount: number): string {
  const files = Array.from({ length: fileCount }, (_, i) => {
    const letter = String.fromCharCode('a'.charCodeAt(0) + i)
    return `- \`src/${letter}.ts\``
  })
  return [
    `# ${title}`,
    '',
    '## Overview',
    '',
    'Post-implementation summary body for the adaptive-tier integration',
    'fixture. Padded above the 100-byte summary sanity floor so the adaptive',
    'scorer running inside `metta complete implementation` sees a real doc.',
    '',
    '## Files',
    '',
    ...files,
    '',
  ].join('\n')
}

describe('parseComplexityTracking', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-complexity-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function writeSpec(content: string): Promise<string> {
    const path = join(tempDir, 'spec.md')
    await writeFile(path, content, 'utf8')
    return path
  }

  it('CT-1: returns a populated map from a well-formed Complexity Tracking section', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Overview',
        '',
        'Some text.',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: required for plugin registry to share state across modules',
        '- No string literal templates: YAML embed needs interpolation at runtime',
        '',
        '## Requirements',
        '',
        '- REQ-1',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(2)
    expect(result.get('No singletons')).toBe(
      'required for plugin registry to share state across modules',
    )
    expect(result.get('No string literal templates')).toBe(
      'YAML embed needs interpolation at runtime',
    )
  })

  it('CT-2: returns an empty map when the section is absent', async () => {
    const path = await writeSpec(
      ['# Spec', '', '## Overview', '', 'No tracking here.', ''].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(0)
  })

  it('CT-3: returns an empty map when the section is present but empty', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '## Next Section',
        '',
        '- not a tracking entry',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(0)
  })

  it('CT-4: parses entries whose article contains backticks/colons by splitting on the first ": " only', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- `metta install`: justification for shipping a separate install command',
        '',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.size).toBe(1)
    expect(result.get('`metta install`')).toBe(
      'justification for shipping a separate install command',
    )
  })

  it('CT-5: preserves inline backticks inside the rationale', async () => {
    const path = await writeSpec(
      [
        '# Spec',
        '',
        '## Complexity Tracking',
        '',
        '- No singletons: needed because `GlobalRegistry` must dedupe across `import` boundaries',
        '',
      ].join('\n'),
    )

    const result = await parseComplexityTracking(path)
    expect(result.get('No singletons')).toBe(
      'needed because `GlobalRegistry` must dedupe across `import` boundaries',
    )
  })
})

// --------------------------------------------------------------------------
// Integration tests for adaptive-workflow-tier-selection
// (tasks 5.1 - 5.4). These exercise the real CLI via `npx tsx` and assert
// end-to-end mutation of `.metta.yaml` across the three prompt sites:
// intent-downscale, intent-upscale, post-implementation upscale.
// --------------------------------------------------------------------------

describe('adaptive-workflow integration', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-adaptive-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  // Task 5.1 -- propose then downscale-accept path
  describe('Task 5.1: propose-then-downscale-accept', () => {
    it('standard + 1-file impact with --auto downscales to trivial and drops planning artifacts', async () => {
      await runCli(['install', '--git-init'], tempDir)

      const proposeRes = await runCli(
        ['propose', 'downscale accept', '--workflow', 'standard', '--auto'],
        tempDir,
      )
      expect(proposeRes.code).toBe(0)

      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-accept')
      await writeFile(
        join(changeDir, 'intent.md'),
        buildImpactMd('Downscale Accept', 1),
        'utf8',
      )

      const { code, stderr } = await runCli(
        ['complete', 'intent', '--change', 'downscale-accept'],
        tempDir,
      )
      expect(code).toBe(0)
      // Auto-accept banner means the yes path was taken without a prompt.
      expect(stderr).toContain('Auto-accepting recommendation')

      const meta = await readMetadata(tempDir, 'downscale-accept')
      // workflow mutated to trivial.
      expect(meta.workflow).toBe('trivial')
      // complexity_score persisted with the scorer's recommendation.
      expect(meta.complexity_score).toBeDefined()
      expect(meta.complexity_score?.recommended_workflow).toBe('trivial')
      expect(meta.complexity_score?.signals.file_count).toBe(1)
      // Unstarted planning artifacts removed from the artifact list.
      expect(meta.artifacts).not.toHaveProperty('stories')
      expect(meta.artifacts).not.toHaveProperty('spec')
      expect(meta.artifacts).not.toHaveProperty('research')
      expect(meta.artifacts).not.toHaveProperty('design')
      expect(meta.artifacts).not.toHaveProperty('tasks')
      // Trivial workflow still has intent/implementation/verification, and
      // the intent status from before the rebuild is preserved as complete.
      expect(meta.artifacts).toHaveProperty('intent')
      expect(meta.artifacts.intent).toBe('complete')
      expect(meta.artifacts).toHaveProperty('implementation')
      expect(meta.artifacts).toHaveProperty('verification')
    })
  })

  // Task 5.2 -- quick then upscale-accept at intent time
  describe('Task 5.2: quick-then-upscale-accept at intent time', () => {
    it('quick + 5-file impact with --auto upscales to standard and inserts planning artifacts', async () => {
      await runCli(['install', '--git-init'], tempDir)

      const quickRes = await runCli(
        ['quick', 'upscale accept', '--auto'],
        tempDir,
      )
      expect(quickRes.code).toBe(0)

      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-accept')
      await writeFile(
        join(changeDir, 'intent.md'),
        buildImpactMd('Upscale Accept', 5),
        'utf8',
      )

      const { code, stderr } = await runCli(
        ['complete', 'intent', '--change', 'upscale-accept'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation')

      const meta = await readMetadata(tempDir, 'upscale-accept')
      // Workflow promoted to standard.
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted with standard recommendation.
      expect(meta.complexity_score).toBeDefined()
      expect(meta.complexity_score?.recommended_workflow).toBe('standard')
      expect(meta.complexity_score?.signals.file_count).toBe(5)
      // Planning artifacts inserted as pending (or ready for the next one).
      expect(meta.artifacts).toHaveProperty('stories')
      expect(['pending', 'ready']).toContain(meta.artifacts.stories)
      expect(meta.artifacts.spec).toBe('pending')
      expect(meta.artifacts.research).toBe('pending')
      expect(meta.artifacts.design).toBe('pending')
      expect(meta.artifacts.tasks).toBe('pending')
      // intent preserved as complete.
      expect(meta.artifacts.intent).toBe('complete')
    })
  })

  // Task 5.3 -- post-impl upscale accept AND decline paths
  describe('Task 5.3: post-impl upscale accept + decline', () => {
    it('quick + 5-file summary with --auto: actual_complexity_score persisted, workflow promoted, directive on stdout', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'post impl accept', '--auto'], tempDir)

      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-accept')
      await writeFile(
        join(changeDir, 'summary.md'),
        buildSummaryMd('Post Impl Accept', 5),
        'utf8',
      )

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-accept'],
        tempDir,
      )
      expect(code).toBe(0)
      // Auto-accept banner + directive on stdout.
      expect(stderr).toContain('Auto-accepting recommendation')
      expect(stdout).toContain('Post-impl upscale accepted.')

      const meta = await readMetadata(tempDir, 'post-impl-accept')
      // Workflow promoted.
      expect(meta.workflow).toBe('standard')
      // actual_complexity_score persisted with standard recommendation.
      expect(meta.actual_complexity_score).toBeDefined()
      expect(meta.actual_complexity_score?.recommended_workflow).toBe('standard')
      expect(meta.actual_complexity_score?.signals.file_count).toBe(5)
      // stories and spec marked pending (or ready for the next one) by the
      // upscale; implementation preserved as complete.
      expect(['pending', 'ready']).toContain(meta.artifacts.stories)
      expect(['pending', 'ready']).toContain(meta.artifacts.spec)
      expect(meta.artifacts.implementation).toBe('complete')
    })

    it('quick + 5-file summary WITHOUT --auto (non-TTY decline): score persisted, workflow unchanged, warning on stderr, no retro artifacts', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // No --auto flag; execFile gives non-TTY stdin so askYesNo returns
      // its default (false) -> the no path fires.
      await runCli(['quick', 'post impl decline'], tempDir)

      const changeDir = join(tempDir, 'spec', 'changes', 'post-impl-decline')
      await writeFile(
        join(changeDir, 'summary.md'),
        buildSummaryMd('Post Impl Decline', 5),
        'utf8',
      )

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'post-impl-decline'],
        tempDir,
      )
      expect(code).toBe(0)
      // Warning string per the spec (task 3.3).
      expect(stderr).toContain('Warning: this change touched 5 files')
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stdout).not.toContain('Post-impl upscale accepted')

      const meta = await readMetadata(tempDir, 'post-impl-decline')
      // Workflow unchanged.
      expect(meta.workflow).toBe('quick')
      // actual_complexity_score still persisted on the no path.
      expect(meta.actual_complexity_score).toBeDefined()
      expect(meta.actual_complexity_score?.recommended_workflow).toBe('standard')
      expect(meta.actual_complexity_score?.signals.file_count).toBe(5)
      // stories/spec not inserted on the no path.
      expect(meta.artifacts).not.toHaveProperty('stories')
      expect(meta.artifacts).not.toHaveProperty('spec')
    })
  })

  // Task 5.4 -- --auto flag across all three prompt sites,
  // plus --accept-recommended alias parity.
  describe('Task 5.4: --auto propagates across all three prompt sites', () => {
    it('sub-a: --auto intent downscale site emits auto-accept banner and mutates workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(
        ['propose', 'auto site downscale', '--workflow', 'standard', '--auto'],
        tempDir,
      )

      const changeDir = join(tempDir, 'spec', 'changes', 'auto-site-downscale')
      await writeFile(
        join(changeDir, 'intent.md'),
        buildImpactMd('Auto Site Downscale', 1),
        'utf8',
      )

      const { code, stderr } = await runCli(
        ['complete', 'intent', '--change', 'auto-site-downscale'],
        tempDir,
      )
      expect(code).toBe(0)
      // Auto-accept banner present.
      expect(stderr).toContain('Auto-accepting recommendation:')
      expect(stderr).toContain('downscale')
      // No interactive y/N prompt text leaked onto stderr/stdout.
      expect(stderr).not.toMatch(/\[y\/N\]/)

      const meta = await readMetadata(tempDir, 'auto-site-downscale')
      expect(meta.workflow).toBe('trivial')
    })

    it('sub-b: --auto intent upscale site emits auto-accept banner and mutates workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'auto site upscale', '--auto'], tempDir)

      const changeDir = join(tempDir, 'spec', 'changes', 'auto-site-upscale')
      await writeFile(
        join(changeDir, 'intent.md'),
        buildImpactMd('Auto Site Upscale', 5),
        'utf8',
      )

      const { code, stderr } = await runCli(
        ['complete', 'intent', '--change', 'auto-site-upscale'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation:')
      expect(stderr).toContain('upscale')
      expect(stderr).not.toMatch(/\[y\/N\]/)

      const meta = await readMetadata(tempDir, 'auto-site-upscale')
      expect(meta.workflow).toBe('standard')
    })

    it('sub-c: --auto post-impl upscale site emits auto-accept banner and mutates workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'auto site postimpl', '--auto'], tempDir)

      const changeDir = join(tempDir, 'spec', 'changes', 'auto-site-postimpl')
      await writeFile(
        join(changeDir, 'summary.md'),
        buildSummaryMd('Auto Site Postimpl', 5),
        'utf8',
      )

      const { stdout, stderr, code } = await runCli(
        ['complete', 'implementation', '--change', 'auto-site-postimpl'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation:')
      expect(stderr).toContain('post-impl upscale')
      expect(stdout).toContain('Post-impl upscale accepted.')
      expect(stderr).not.toMatch(/\[y\/N\]/)

      const meta = await readMetadata(tempDir, 'auto-site-postimpl')
      expect(meta.workflow).toBe('standard')
    })

    it('sub-d: --accept-recommended alias matches --auto behavior on the intent downscale site', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(
        [
          'propose',
          'alias site downscale',
          '--workflow',
          'standard',
          '--accept-recommended',
        ],
        tempDir,
      )

      const changeDir = join(tempDir, 'spec', 'changes', 'alias-site-downscale')
      await writeFile(
        join(changeDir, 'intent.md'),
        buildImpactMd('Alias Site Downscale', 1),
        'utf8',
      )

      const { code, stderr } = await runCli(
        ['complete', 'intent', '--change', 'alias-site-downscale'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation:')
      expect(stderr).toContain('downscale')

      const meta = await readMetadata(tempDir, 'alias-site-downscale')
      expect(meta.workflow).toBe('trivial')
      // The alias persisted the same auto_accept_recommendation field as --auto.
      expect(meta.auto_accept_recommendation).toBe(true)
    })
  })
})
